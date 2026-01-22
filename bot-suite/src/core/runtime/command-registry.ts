import type { Context } from '@pluxel/hmr'

import { createRouter, isMcpExecutable, isTextExecutable } from '@pluxel/cmd'
import type { ExecCtx, Executable, McpMeta, McpExecutable, Router, TextExecutable } from '@pluxel/cmd'

export type RegisteredCommandInfo = {
	/** Primary trigger shown in UI (without prefix). */
	name: string
	/** Other triggers. */
	aliases: string[]
	/** Optional usage string (not parsed). */
	usage?: string
	/** Optional human description. */
	description?: string
	/** Optional group label for UI. */
	group?: string
	/** Optional permission node string for UI/debug. */
	permNode?: string
}

export class CommandRegistry<C extends ExecCtx> {
	public readonly router: Router<C>

	private readonly commandKits = new WeakMap<Context, unknown>()
	private readonly idsByOwner = new Map<string, Set<string>>()
	private readonly ownerCtxById = new Map<string, Context>()
	private readonly infoById = new Map<string, RegisteredCommandInfo>()
	private readonly mcpById = new Map<string, McpMeta>()

	constructor(options?: { caseInsensitive?: boolean }) {
		this.router = createRouter<C>({ caseInsensitive: options?.caseInsensitive ?? true })
	}

	getOrCreateKit<TKit>(caller: Context, factory: (ctx: Context) => TKit): TKit {
		const ownerKey = caller.pluginInfo?.id
		if (!ownerKey) throw new Error('[chatbots] cmd registration requires caller context')

		const prevCtx = this.ownerCtxById.get(ownerKey)
		if (prevCtx && prevCtx !== caller) {
			this.cleanupCommandsForOwner(ownerKey)
		}
		this.ownerCtxById.set(ownerKey, caller)

		const cached = this.commandKits.get(caller) as TKit | undefined
		if (cached) return cached

		const kit = factory(caller)
		this.commandKits.set(caller, kit)
		return kit
	}

	registerTextCommand(exec: TextExecutable<any, any>, owner: Context): void {
		const ownerKey = owner.pluginInfo?.id
		if (!ownerKey) throw new Error('[chatbots] command registration requires caller context')

		// Hot-reload safety: treat re-register as replace.
		this.unregister(exec.id)
		this.router.add(exec as any)

		this.track(ownerKey, exec.id)
		owner.scope.collectEffect(() => {
			try {
				this.unregister(exec.id)
			} catch {
				// ignore
			} finally {
				this.untrack(ownerKey, exec.id)
			}
		})

		// Optional MCP opt-in: keep data-only metadata in registry.
		if (isMcpExecutable(exec)) this.mcpById.set(exec.id, exec.mcp)
	}

	registerOp(exec: Executable<any, any>, owner: Context): void {
		const ownerKey = owner.pluginInfo?.id
		if (!ownerKey) throw new Error('[chatbots] command registration requires caller context')

		this.unregister(exec.id)
		this.track(ownerKey, exec.id)
		owner.scope.collectEffect(() => {
			try {
				this.unregister(exec.id)
			} catch {
				// ignore
			} finally {
				this.untrack(ownerKey, exec.id)
			}
		})

		// Optional MCP opt-in: ops can be MCP tools too.
		if (isMcpExecutable(exec)) this.mcpById.set(exec.id, exec.mcp)
	}

	registerMcpTool(exec: McpExecutable<any, any>, owner: Context): void {
		const ownerKey = owner.pluginInfo?.id
		if (!ownerKey) throw new Error('[chatbots] command registration requires caller context')

		this.unregister(exec.id)
		this.track(ownerKey, exec.id)
		this.mcpById.set(exec.id, exec.mcp)

		owner.scope.collectEffect(() => {
			try {
				this.unregister(exec.id)
			} catch {
				// ignore
			} finally {
				this.untrack(ownerKey, exec.id)
			}
		})
	}

	/**
	 * Convenience: accept a wide `Executable` and route it to the right registries.
	 *
	 * Prefer the strongly-typed APIs (`registerTextCommand` / `registerMcpTool`) when available.
	 */
	register(exec: Executable<any, any>, owner: Context): void {
		if (isTextExecutable(exec)) this.registerTextCommand(exec, owner)
		else if (isMcpExecutable(exec)) this.registerMcpTool(exec, owner)
		else this.registerOp(exec, owner)
	}

	setInfo(id: string, info: RegisteredCommandInfo): void {
		this.infoById.set(id, info)
	}

	getInfo(id: string): RegisteredCommandInfo | undefined {
		return this.infoById.get(id)
	}

	list(): Array<{ id: string; info: RegisteredCommandInfo }> {
		return Array.from(this.infoById.entries()).map(([id, info]) => ({ id, info }))
	}

	listMcpTools(): Array<{ id: string; mcp: McpMeta }> {
		return Array.from(this.mcpById.entries()).map(([id, mcp]) => ({ id, mcp }))
	}

	unregister(id: string): void {
		this.infoById.delete(id)
		this.mcpById.delete(id)
		try {
			this.router.remove(id)
		} catch {
			// ignore
		}
	}

	cleanupCommandsForOwner(ownerKey: string): void {
		const bucket = this.idsByOwner.get(ownerKey)
		if (!bucket || bucket.size === 0) return
		for (const id of Array.from(bucket)) {
			this.unregister(id)
			this.untrack(ownerKey, id)
		}
	}

	private track(ownerKey: string, id: string): void {
		let bucket = this.idsByOwner.get(ownerKey)
		if (!bucket) {
			bucket = new Set()
			this.idsByOwner.set(ownerKey, bucket)
		}
		bucket.add(id)
	}

	private untrack(ownerKey: string, id: string): void {
		const bucket = this.idsByOwner.get(ownerKey)
		if (!bucket) return
		bucket.delete(id)
		if (bucket.size === 0) this.idsByOwner.delete(ownerKey)
	}
}
