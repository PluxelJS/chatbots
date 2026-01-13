import { BasePlugin, Plugin, getPluginInfo } from '@pluxel/hmr'
import { MikroOrm } from 'pluxel-plugin-mikro-orm'

import { createPermissionFacade, type ChatbotsPermissionFacade } from '../permission'
import { PermissionService } from '../service'

@Plugin({ name: 'permissions-host', type: 'service' })
export class PermissionsHost extends BasePlugin {
	public readonly permissions: PermissionService

	private permissionFacade: ChatbotsPermissionFacade | undefined

	constructor(private readonly mikro: MikroOrm) {
		super()
		this.permissions = undefined as any
	}

	async init(_abort: AbortSignal): Promise<void> {
		const svc = await PermissionService.create(this.mikro)
		;(this as any).permissions = svc
		this.registerCatalogUnloadTracking()
	}

	async stop(_abort: AbortSignal): Promise<void> {
		await this.permissions?.dispose()
	}

	/**
	 * Test-facing facade that mimics `chatbots.permission.*`:
	 * - infers nsKey from `ctx.caller.pluginInfo.id`
	 * - returns `PermRef` from `declareExact()/perm()`
	 */
	get permission(): ChatbotsPermissionFacade {
		if (this.permissionFacade) return this.permissionFacade
		this.permissionFacade = createPermissionFacade(this.permissions, (method) => this.requireCallerNamespaceKey(method))
		return this.permissionFacade
	}

	private requireCallerNamespaceKey(method: string): string {
		const nsKey = this.ctx.caller?.pluginInfo?.id
		if (!nsKey) {
			throw new Error(`[PermissionsHost] ${method}() requires caller context (call it inside a plugin)`)
		}
		return nsKey
	}

	private registerCatalogUnloadTracking() {
		const off = this.ctx.root.events.on('afterCommit', (summary) => {
			const active = new Set<string>()
			for (const id of summary.container?.services?.keys?.() ?? []) {
				const key = pluginIdToString(id)
				if (key) active.add(key)
			}
			const ids = [...summary.removed, ...summary.replaced]
			for (const id of ids) {
				const nsKey = pluginIdToString(id)
				if (!nsKey) continue
				if (active.has(nsKey)) continue
				this.permissions.removeNamespace(nsKey)
			}
		})
		this.ctx.scope.collectEffect(off)
	}
}

function pluginIdToString(id: unknown): string | null {
	if (typeof id === 'string') return id
	if (typeof id === 'function') return getPluginInfo(id as any).id
	return null
}
