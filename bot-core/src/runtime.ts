import type { Context } from '@pluxel/hmr'

import { registerAllBridges, createBridgeManager, type BridgeConfig } from './bridge'
import { createBotEventChannel, dispatchMessage, type BotEventChannel } from './events'
import { createAdapterRegistry } from './adapter'
import { createStatusTracker, type BridgeStatusTracker } from './status'
import type { AnyMessage } from './types'

/**
 * BotCoreRuntime 负责事件通道、桥接以及状态跟踪。
 * BotCore 插件只做生命周期代理，保持 API 稳定。
 */
export interface BotCoreRuntimeOptions {
	bridges?: BridgeConfig
	debug?: boolean
}

export class BotCoreRuntime {
	public readonly events: BotEventChannel
	public readonly status: BridgeStatusTracker
	public readonly bridges = createBridgeManager()
	public readonly adapters = createAdapterRegistry()

	constructor(private readonly ctx: Context, private readonly options: BotCoreRuntimeOptions) {
		this.events = createBotEventChannel(ctx)
		this.status = createStatusTracker(ctx)
	}

	bootstrap() {
		const debug = Boolean(this.options.debug)
		const dispatch = (msg: AnyMessage) =>
			dispatchMessage(this.events, this.ctx, msg, debug, this.status.markMessage)

		const unregisterBridges = registerAllBridges(
			this.ctx,
			dispatch,
			this.options.bridges,
			this.status,
		)
		this.ctx.effects.defer(unregisterBridges)
	}

	teardown() {
	}
}
