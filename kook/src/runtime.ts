import type { Context } from '@pluxel/hmr'
import type { Config } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { middlewares, WretchPlugin } from 'pluxel-plugin-wretch'
import type { WebSocketPlugin } from 'pluxel-plugin-websocket'
import { BotManager, type KookBotPublic } from './bot-manager'
import { KookBotRegistry, type CreateBotInput, type UpdateBotInput } from './runtime/bot-registry'
import { createCommandBus } from './cmd'
import { createCommandKit } from './cmd/kit'
import type { MessageSession } from './types'
import type { KookConfigType } from './config'
import { KookSseBridge, type KookSnapshot } from './runtime/sse'
import type { KookChannel } from './events'

type CMDCTX = MessageSession

/**
 * KOOK 插件运行时：集中管理 Bot 生命周期、RPC/SSE、指令流水线。
 */
export class KookRuntime {
	/** 共享实例：其他插件直接用它 */
	public baseClient!: HttpClient
	private readonly bus = createCommandBus<CMDCTX>({})
	public readonly cmd = createCommandKit<CMDCTX>(this.bus)

	private ctx!: Context
	private config!: Config<KookConfigType>
	private repo!: KookBotRegistry
	public manager!: BotManager
	public events!: KookChannel
	private sseBridge: KookSseBridge | null = null

	constructor(
		private readonly wretch: WretchPlugin,
		private readonly websocket: WebSocketPlugin,
	) {}

	async bootstrap(ctx: Context, config: Config<KookConfigType>) {
		this.ctx = ctx
		this.config = config

		await this.setupClients()
		this.repo = new KookBotRegistry(this.ctx)
		await this.repo.init()
		this.manager = new BotManager(this.ctx, this.repo, this.websocket, this.baseClient)
		this.events = this.manager.events
		this.sseBridge = new KookSseBridge(this.repo, this.manager)

		this.registerWebhook()
		this.registerMessagePipeline()
		await this.autoConnectBots()
	}

	async teardown() {
		if (this.manager) {
			await this.manager.disconnectAll()
		}
	}

	/* ======================== Public API（供 RPC/外部调用） ======================== */

	getOverview() {
		return this.manager.getOverview()
	}

	getBotStatuses() {
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

	snapshot(): KookSnapshot {
		return this.sseBridge?.snapshot() ?? { bots: [], overview: this.manager.getOverview(), updatedAt: Date.now() }
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

	private registerMessagePipeline() {
		this.events.message.on((session, next) => {
			const msg = session.data.content
			if (!msg || msg[0] !== this.config.common.cmdPrefix) return next(session)

			this.bus
				.dispatch(msg.slice(1), session)
				.catch((e) => this.ctx.logger.error(e, `执行 ${msg} 遇到以下问题：`))

			return next(session)
		})
	}

	private async autoConnectBots() {
		if (this.config.autoConnect === false) return
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
}

export type { KookSnapshot }
