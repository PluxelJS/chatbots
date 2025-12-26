import { BasePlugin, Plugin } from '@pluxel/core'
import { Config as UseConfig, type Config as InferConfig } from '@pluxel/hmr'
import { WretchPlugin } from 'pluxel-plugin-wretch'
import { TelegramConfig, type TelegramConfigType } from './config'
import { TelegramRuntime, type TelegramSnapshot } from './runtime/runtime'
import { registerTelegramExtensions } from './extensions'
import type { TelegramBotRpc } from './runtime/rpc'

export * from './types'
export * from './bot'
export * from './events'
export * from './cmd'
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
		registerTelegramExtensions(this)
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

declare module '@pluxel/hmr/services' {
	interface RpcExtensions {
		Telegram: TelegramBotRpc
	}
	interface SseEvents {
		Telegram: TelegramSnapshot
	}
}
