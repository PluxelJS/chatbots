import { BasePlugin, Plugin } from '@pluxel/core'
import { Config as UseConfig, type Config as InferConfig } from '@pluxel/hmr'
import { WretchPlugin } from 'pluxel-plugin-wretch'
import { TelegramConfig, type TelegramConfigType } from './config'
import { TelegramRuntime, type TelegramSnapshot } from './runtime'
import { registerTelegramExtensions } from './extensions'
import type { TelegramBotRpc } from './runtime/rpc'

export * from './types'
export * from './bot'
export * from './events'
export type { TelegramSnapshot }

/* ======================== Plugin ======================== */

@Plugin({ name: 'Telegram', type: 'service', startTimeoutMs: 10_000 })
export class TelegramPlugin extends BasePlugin {
	@UseConfig(TelegramConfig) private config!: InferConfig<TelegramConfigType>

	public readonly runtime: TelegramRuntime

	constructor(wretch: WretchPlugin) {
		super()
		this.runtime = new TelegramRuntime(wretch)
	}

	override async init(abort: AbortSignal): Promise<void> {
		await this.runtime.bootstrap(this.ctx, this.config, abort)
		if (abort.aborted) return
		registerTelegramExtensions({ ctx: this.ctx, runtime: this.runtime })
		this.ctx.events.emit('telegram:ready', this)
	}

	override async stop(): Promise<void> {
		await this.runtime.teardown()
	}

	getBot(token: string) {
		return this.runtime.getBot(token)
	}

	getFirstBot() {
		return this.runtime.getFirstBot()
	}

	handleWebhook(token: string, update: unknown, secretToken?: string): boolean {
		return this.runtime.handleWebhook(token, update, secretToken)
	}
}

declare module '@pluxel/hmr/web' {
	namespace UI {
	interface rpc {
		Telegram: TelegramBotRpc
	}
	interface sse {
		Telegram: TelegramSnapshot
	}
	}

}

declare module '@pluxel/core/services' {
	interface Events {
		'telegram:ready': [TelegramPlugin]
	}
}
