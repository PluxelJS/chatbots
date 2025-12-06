import { BasePlugin, Config, Plugin } from '@pluxel/hmr'
import { WretchPlugin } from 'pluxel-plugin-wretch'
import { WebSocketPlugin } from 'pluxel-plugin-websocket'
import { KookConfig, type KookConfigType } from './config'
import { KookRuntime, type KookSnapshot } from './runtime/runtime'
import type { KOOKBotRpc } from './runtime/rpc'

export * from './types'
export type { KookSnapshot }

@Plugin({ name: 'KOOK' })
export class KOOK extends BasePlugin {
	@Config(KookConfig) private config!: Config<KookConfigType>

	public readonly runtime: KookRuntime

	constructor(wretch: WretchPlugin, websocket: WebSocketPlugin) {
		super()
		this.runtime = new KookRuntime(wretch, websocket)
	}

	async init(_abort: AbortSignal): Promise<void> {
		await this.runtime.bootstrap(this.ctx, this.config)
	}

	async stop(_abort: AbortSignal): Promise<void> {
		await this.runtime.teardown()
	}

	get baseClient() {
		return this.runtime.baseClient
	}

	get cmd() {
		return this.runtime.cmd
	}

	getOverview() {
		return this.runtime.getOverview()
	}

	getBotStatuses() {
		return this.runtime.getBotStatuses()
	}

	createBot(...args: Parameters<KookRuntime['createBot']>) {
		return this.runtime.createBot(...args)
	}

	connectBot(...args: Parameters<KookRuntime['connectBot']>) {
		return this.runtime.connectBot(...args)
	}

	disconnectBot(...args: Parameters<KookRuntime['disconnectBot']>) {
		return this.runtime.disconnectBot(...args)
	}

	deleteBot(...args: Parameters<KookRuntime['deleteBot']>) {
		return this.runtime.deleteBot(...args)
	}

	snapshot() {
		return this.runtime.snapshot()
	}
}

declare module '@pluxel/hmr/services' {
	interface RpcExtensions {
		KOOK: KOOKBotRpc
	}
	interface SseEvents {
		KOOK: KookSnapshot
	}
}
