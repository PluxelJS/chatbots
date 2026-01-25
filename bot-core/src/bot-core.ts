import { BasePlugin, Plugin } from '@pluxel/hmr'
import { BotCoreConfigSchema, type BotCoreConfig } from './config'
import { BotCoreRuntime } from './runtime'

/**
 * 轻量跨平台消息层：统一 KOOK/Telegram 的消息抽象。
 * 平台特有功能通过 msg.bot 访问原生 API。
 */
@Plugin({ name: 'bot-core', type: 'service' })
export class BotCore extends BasePlugin {
	private config: BotCoreConfig = this.configs.use(BotCoreConfigSchema)

	public runtime!: BotCoreRuntime

	async init(_abort: AbortSignal): Promise<void> {
		this.runtime = new BotCoreRuntime(this.ctx, {
			bridges: this.config.bridges,
			debug: this.config.debug,
		})
		this.runtime.bootstrap()

		this.ctx.logger.info('BotCore initialized')
	}

	async stop(_abort: AbortSignal): Promise<void> {
		this.runtime?.teardown()
		this.ctx.logger.info('BotCore stopped')
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

export default BotCore

export * from './types'
export * from '../parts'
export * from './adapter'
export * from './media'
export { registerBridgeDefinition, createBridgeManager } from './bridge'
