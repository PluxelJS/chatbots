import { BasePlugin, Config, Plugin, getPluginInfo } from '@pluxel/hmr'
import { MikroOrm } from 'pluxel-plugin-mikro-orm'

import { BotLayer } from '@pluxel/bot-layer'
import { ChatbotsConfigSchema, type ChatbotsConfig } from './config'
import { ChatbotsRuntime } from './runtime'
import { createPermissionFacade, type ChatbotsPermissionFacade } from '../permissions/permission'
import { ChatbotsSandbox, ChatbotsSandboxRpc } from './sandbox'

@Plugin({ name: 'chatbots', type: 'service' })
export class Chatbots extends BasePlugin {
	@Config(ChatbotsConfigSchema)
	private config!: Config<typeof ChatbotsConfigSchema> & ChatbotsConfig

	public runtime!: ChatbotsRuntime
	private sandbox!: ChatbotsSandbox

	constructor(
		private readonly botLayer: BotLayer,
		private readonly mikro: MikroOrm,
	) {
		super()
	}

	async init(_abort: AbortSignal): Promise<void> {
		this.runtime = await ChatbotsRuntime.create(this.ctx, this.botLayer, this.mikro, {
			cmdPrefix: this.config.cmdPrefix,
			debug: this.config.debug,
			devCommands: this.config.devCommands,
			userCacheTtlMs: this.config.userCacheTtlMs,
			userCacheMax: this.config.userCacheMax,
			linkTokenTtlSeconds: this.config.linkTokenTtlSeconds,
			registerUserCommands: this.config.registerUserCommands,
		})
		this.runtime.bootstrap()
		this.sandbox = new ChatbotsSandbox(this.runtime, { cmdPrefix: this.config.cmdPrefix })
		this.ctx.ext.ui.register({ entryPath: './ui/index.tsx' })
		this.ctx.ext.rpc.registerExtension(() => new ChatbotsSandboxRpc(this.sandbox, this.runtime.permissions, this.runtime.users))
		if (this.ctx.ext.sse) {
			this.ctx.ext.sse.registerExtension(() => this.sandbox.createSseHandler())
		}
		this.registerCatalogUnloadTracking()
		this.ctx.logger.info('Chatbots initialized')
	}

	async stop(_abort: AbortSignal): Promise<void> {
		await this.runtime?.teardown()
		this.ctx.logger.info('Chatbots stopped')
	}

	get cmd() {
		return this.runtime.getCommandKit(this.ctx.caller ?? this.ctx)
	}

	get users() {
		return this.runtime.users
	}

	get permissions() {
		return this.runtime.permissions
	}

	private permissionFacade: ChatbotsPermissionFacade | undefined

	get permission(): ChatbotsPermissionFacade {
		if (this.permissionFacade) return this.permissionFacade
		this.permissionFacade = createPermissionFacade(this.runtime.permissions, (method) => this.requireCallerNamespaceKey(method))
		return this.permissionFacade
	}

	private requireCallerNamespaceKey(method: string): string {
		const nsKey = this.ctx.caller?.pluginInfo?.id
		if (!nsKey) {
			throw new Error(`[Chatbots] ${method}() requires caller context (call it inside a plugin)`)
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
				this.runtime.permissions.removeNamespace(nsKey)
				this.runtime.cleanupCommandsForOwner(nsKey)
			}
		})
		this.ctx.scope.collectEffect(off)
	}
}

export default Chatbots

export * from './types'
export * from './db/schemas'
export * from './db/user-directory'
export * from '../permissions/permission'
export * from '../permissions/index'
export * from './cmd/perms'

function pluginIdToString(id: unknown): string | null {
	if (typeof id === 'string') return id
	if (typeof id === 'function') return getPluginInfo(id as any).id
	return null
}
