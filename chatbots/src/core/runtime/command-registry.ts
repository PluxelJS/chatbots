import type { Context } from '@pluxel/hmr'

import { createCommandBus } from '@pluxel/bot-layer'
import type { Command } from '@pluxel/bot-layer'

export type CommandBus<C> = ReturnType<typeof createCommandBus<C>>

export class CommandRegistry<C> {
	public readonly bus: CommandBus<C>

	private readonly commandKits = new WeakMap<Context, unknown>()
	private readonly commandsByOwner = new Map<string, Set<Command<any, any, C, any>>>()
	private readonly commandOwners = new WeakMap<Command<any, any, C, any>, string>()
	private readonly ownerCtxById = new Map<string, Context>()

	constructor(options?: { caseInsensitive?: boolean }) {
		this.bus = createCommandBus<C>({ caseInsensitive: options?.caseInsensitive ?? true })
	}

	getOrCreateKit<TKit>(caller: Context, factory: (ctx: Context) => TKit): TKit {
		const ownerKey = caller.pluginInfo?.id
		if (!ownerKey) {
			throw new Error('[chatbots] cmd registration requires caller context')
		}

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

	registerCommandCleanup(cmd: Command<any, any, C, any>, owner: Context) {
		const ownerKey = owner.pluginInfo?.id
		if (!ownerKey) {
			throw new Error('[chatbots] command registration requires caller context')
		}

		this.trackCommand(ownerKey, cmd)

		owner.scope.collectEffect(() => {
			try {
				this.bus.unregister(cmd)
			} catch {
				// ignore
			} finally {
				this.untrackCommand(cmd, ownerKey)
			}
		})
	}

	cleanupCommandsForOwner(ownerKey: string) {
		const bucket = this.commandsByOwner.get(ownerKey)
		if (!bucket || bucket.size === 0) return
		for (const cmd of Array.from(bucket)) {
			try {
				this.bus.unregister(cmd)
			} catch {
				// ignore
			} finally {
				this.untrackCommand(cmd, ownerKey)
			}
		}
	}

	private trackCommand(ownerKey: string, cmd: Command<any, any, C, any>) {
		let bucket = this.commandsByOwner.get(ownerKey)
		if (!bucket) {
			bucket = new Set()
			this.commandsByOwner.set(ownerKey, bucket)
		}
		bucket.add(cmd)
		this.commandOwners.set(cmd, ownerKey)
	}

	private untrackCommand(cmd: Command<any, any, C, any>, ownerKey?: string) {
		const key = ownerKey ?? this.commandOwners.get(cmd)
		if (!key) return
		const bucket = this.commandsByOwner.get(key)
		if (bucket) {
			bucket.delete(cmd)
			if (bucket.size === 0) this.commandsByOwner.delete(key)
		}
		this.commandOwners.delete(cmd)
	}
}

