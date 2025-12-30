import type { Context } from '@pluxel/hmr'
import type { Config } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { middlewares, WretchPlugin } from 'pluxel-plugin-wretch'
import type { WebSocketPlugin } from 'pluxel-plugin-websocket'
import { KookBotManager, type KookBotPublic } from './bot-manager'
import { KookBotRegistry, type CreateBotInput, type UpdateBotInput } from './bot-registry'
import type { KookConfigType } from '../config'
import { KookSseBridge, type KookSnapshot } from './sse'
import type { KookChannel } from '../events'

/**
 * KOOK 插件运行时：集中管理 Bot 生命周期、RPC/SSE。
 */
export class KookRuntime {
	/** 共享实例：其他插件直接用它 */
	public baseClient!: HttpClient

	private ctx!: Context
	private config!: Config<KookConfigType>
	private repo!: KookBotRegistry
	public manager!: KookBotManager
	public events!: KookChannel
	private sseBridge: KookSseBridge | null = null
	private autoConnectScheduled = false
	private abort?: AbortSignal

	constructor(
		private readonly wretch: WretchPlugin,
		private readonly websocket: WebSocketPlugin,
	) {}

	async bootstrap(ctx: Context, config: Config<KookConfigType>, abort?: AbortSignal) {
		this.ctx = ctx
		this.config = config
		this.abort = abort

		await this.setupClients()
		this.repo = new KookBotRegistry(this.ctx)
		await this.repo.init()
		this.manager = new KookBotManager(this.ctx, this.repo, this.websocket, this.baseClient)
		this.events = this.manager.events
		this.sseBridge = new KookSseBridge(this.repo, this.manager)

		if (this.abort?.aborted) return

		this.registerWebhook()
		this.scheduleAutoConnect()
	}

	async teardown() {
		if (this.manager) {
			await this.manager.disconnectAll()
		}
	}

	/* ======================== Public API（供 RPC/外部调用） ======================== */

	async getOverview() {
		await this.repo.whenReady()
		return this.manager.getOverview()
	}

	async getBotStatuses() {
		await this.repo.whenReady()
		return this.manager.getPublicBots()
	}

	async createBot(input: CreateBotInput): Promise<KookBotPublic> {
		return this.manager.createBot(input)
	}

	async deleteBot(id: string) {
		return this.manager.deleteBot(id)
	}

	async updateBot(id: string, patch: UpdateBotInput) {
		return this.manager.updateBot(id, patch)
	}

	async connectBot(id: string) {
		return this.manager.connectBot(id)
	}

	async disconnectBot(id: string) {
		return this.manager.disconnectBot(id)
	}

	async snapshot(): Promise<KookSnapshot> {
		await this.repo.whenReady()
		return (
			(await this.sseBridge?.snapshot()) ?? {
				bots: [],
				overview: this.manager.getOverview(),
				updatedAt: Date.now(),
			}
		)
	}

	createSseHandler() {
		if (!this.sseBridge) {
			throw new Error('[KOOK] SSE bridge not initialized')
		}
		return this.sseBridge.createHandler()
	}

	/* ======================== Internal wiring ======================== */

	private async setupClients() {
		const base = this.wretch.createClient({
			baseUrl: this.config.common.apiBase,
			throwHttpErrors: true,
		})
		this.baseClient = base.middlewares([
			middlewares.retry({
				maxAttempts: 2,
				retryOnNetworkError: true,
			}),
		])
	}

	private registerWebhook() {
		const path = this.config.common.path ?? '/kook/webhook'
		this.manager.registerWebhook(path)
	}

	private async autoConnectBots() {
		if (this.abort?.aborted) return
		if (this.config.autoConnect === false) return
		await this.repo.whenReady()
		if (this.abort?.aborted) return
		const bots = this.repo.list(128)
		if (bots.length === 0) return
		await Promise.allSettled(
			bots.map(async (b) => {
				try {
					await this.manager.connectBot(b.id)
				} catch (e) {
					this.ctx.logger.warn(e, `KOOK autoConnect failed for ${b.id}`)
				}
			}),
		)
	}

	private scheduleAutoConnect() {
		if (this.autoConnectScheduled) return
		this.autoConnectScheduled = true

		// Do not block plugin start: lifecycle start timeout is short (1500ms).
		setTimeout(() => {
			if (this.abort?.aborted) return
			void this.autoConnectBots().catch((e) => this.ctx.logger.warn(e, '[KOOK] autoConnect failed'))
		}, 0)
	}
}

export type { KookSnapshot }
