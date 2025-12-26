import { BasePlugin, Config, Plugin } from '@pluxel/hmr'
import { BotLayerConfigSchema, type BotLayerConfig } from './config'
import { BotLayerRuntime } from './runtime'

/**
 * 轻量跨平台消息层：统一 KOOK/Telegram 的消息抽象。
 * 平台特有功能通过 msg.bot 访问原生 API。
 */
@Plugin({ name: 'bot-layer', type: 'service' })
export class BotLayer extends BasePlugin {
	@Config(BotLayerConfigSchema)
	private config!: Config<typeof BotLayerConfigSchema> & BotLayerConfig

	public runtime!: BotLayerRuntime

	async init(_abort: AbortSignal): Promise<void> {
		this.runtime = new BotLayerRuntime(this.ctx, {
			bridges: this.config.bridges,
			debug: this.config.debug,
		})
		this.runtime.bootstrap()

		this.ctx.logger.info('BotLayer initialized')
	}

	async stop(_abort: AbortSignal): Promise<void> {
		this.runtime?.teardown()
		this.ctx.logger.info('BotLayer stopped')
	}

	/** 事件通道 */
	get events() {
		return this.runtime.events
	}

	/** 桥接状态（可用于前端展示） */
	get bridgeStatus() {
		return this.runtime.status.snapshot()
	}

	get bridgeStatusEvents() {
		return this.runtime.status.channel
	}

	/** 适配器注册表 */
	get adapters() {
		return this.runtime.adapters
	}

	/** 桥接管理器 */
	get bridges() {
		return this.runtime.bridges
	}
}

export default BotLayer

export * from './types'
export * from '@pluxel/parts'
export * from './avatars'
export * from './platforms/base'
export * from './attachments'
export * from './media'
export { getAdapter, listAdapters, registerAdapter, getCapabilities, createAdapterRegistry } from './platforms/registry'
export { registerBridgeDefinition, createBridgeManager } from './bridge'
