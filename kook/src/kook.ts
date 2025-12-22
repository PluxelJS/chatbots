import { BasePlugin, Plugin } from '@pluxel/core'
import { Config as UseConfig, type Config as InferConfig } from '@pluxel/hmr'
import { WretchPlugin } from 'pluxel-plugin-wretch'
import { WebSocketPlugin } from 'pluxel-plugin-websocket'
import { KookConfig, type KookConfigType } from './config'
import { KookRuntime, type KookSnapshot } from './runtime'
import { BotManager } from './bot-manager'
import { KOOKBotRpc } from './runtime/rpc'

export * from './types'
export type { KookSnapshot }
export { BotManager }

@Plugin({ name: 'KOOK', type: 'service', startTimeoutMs: 10_000 })
export class KOOK extends BasePlugin {
	@UseConfig(KookConfig) private config!: InferConfig<KookConfigType>

	public readonly runtime: KookRuntime

	constructor(wretch: WretchPlugin, websocket: WebSocketPlugin) {
		super()
		this.runtime = new KookRuntime(wretch, websocket)
	}

	override async init(abort: AbortSignal): Promise<void> {
		await this.runtime.bootstrap(this.ctx, this.config, abort)
		if (abort.aborted) return
		this.ctx.extensionService.register({ entryPath: './ui/index.tsx' })
		this.ctx.rpc.registerExtension(() => new KOOKBotRpc(this.runtime))
		if (this.ctx.sse) {
			this.ctx.sse.registerExtension(() => this.runtime.createSseHandler())
		}
	}

	override async stop(): Promise<void> {
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

	get manager() {
		return this.runtime.manager
	}

	get events() {
		return this.runtime.events
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
