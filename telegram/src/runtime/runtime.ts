import type { Context } from '@pluxel/hmr'
import type { Config } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { middlewares, WretchPlugin } from 'pluxel-plugin-wretch'
import type { TelegramConfigType } from '../config'
import { TelegramBotManager, type TelegramBotPublic } from './bot-manager'
import { TelegramBotRegistry, type CreateBotInput, type UpdateBotInput } from './bot-registry'
import type { TelegramChannel } from '../events'
import { TelegramSseBridge, type TelegramSnapshot } from './sse'

/**
 * 将 Telegram 插件运行时（SSE、RPC、Bot 管理）集中到一个可测试的 orchestrator。
 * 便于前端/插件侧共享单一的数据源与生命周期。
 */
export class TelegramRuntime {
	/** 共享 HTTP 客户端，供 API/子模块重用 */
	public readonly baseClient: HttpClient

	/** 事件通道 */
	public events!: TelegramChannel

	private ctx!: Context
	private config!: Config<TelegramConfigType>
	private manager!: TelegramBotManager
	private repo!: TelegramBotRegistry
	private sseBridge: TelegramSseBridge | null = null
	private autoConnectScheduled = false
	private abort?: AbortSignal

	constructor(wretch: WretchPlugin) {
		this.baseClient = wretch
			.createClient({
				throwHttpErrors: true,
			})
			.middlewares([
				middlewares.retry({
					maxAttempts: 2,
					retryOnNetworkError: true,
				}),
			])
	}

	async bootstrap(ctx: Context, config: Config<TelegramConfigType>, abort?: AbortSignal) {
		this.ctx = ctx
		this.config = config
		this.abort = abort

		await this.setupRepoAndManager()
		if (this.abort?.aborted) return
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

	getBot(token: string) {
		return this.manager.getBot(token)
	}

	getFirstBot() {
		return this.manager.getFirstBot()
	}

	handleWebhook(token: string, update: unknown, secretToken?: string): boolean {
		return this.manager.handleWebhook(token, update, secretToken)
	}

	async createBot(input: CreateBotInput): Promise<TelegramBotPublic> {
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

	async snapshot(): Promise<TelegramSnapshot> {
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
			throw new Error('[Telegram] SSE bridge not initialized')
		}
		return this.sseBridge.createHandler()
	}

	/* ======================== Internal wiring ======================== */

	private async setupRepoAndManager() {
		this.repo = new TelegramBotRegistry(this.ctx)
		await this.repo.init()
		this.manager = new TelegramBotManager(this.ctx, this.repo, this.baseClient, this.config.apiBase)
		this.events = this.manager.events
		this.sseBridge = new TelegramSseBridge(this.repo, this.manager)
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
					this.ctx.logger.warn(e, `telegram autoConnect failed for ${b.id}`)
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
			void this.autoConnectBots().catch((e) => this.ctx.logger.warn(e, '[Telegram] autoConnect failed'))
		}, 0)
	}

}

export type { TelegramSnapshot }
