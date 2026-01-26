import type { Context } from '@pluxel/hmr'
import type { SseChannel } from '@pluxel/hmr/services'
import type { HttpClient } from '@pluxel/wretch'
import type { WebhookOptions } from '../bot'
import { Bot } from '../bot'
import { createTelegramChannel, type TelegramChannel } from '../events'
import type { BotConfig } from '../bot'
import {
	TelegramBotRegistry,
	type BotState,
	type CreateBotInput,
	type TelegramBotPublic,
	type TelegramBotRecord,
	type UpdateBotInput,
} from './bot-registry'

export class TelegramBotManager {
	public readonly botsById = new Map<string, Bot>()
	private readonly botsByToken = new Map<string, Bot>()
	private readonly webhookBotsByToken = new Map<string, Bot>()
	public readonly events: TelegramChannel
	private readonly logger: ReturnType<Context['logger']['with']>

	constructor(
		private readonly ctx: Context,
		private readonly repo: TelegramBotRegistry,
		private baseClient: HttpClient,
		private readonly apiBase: string,
	) {
		this.logger = ctx.logger.with({ platform: 'telegram' })
		this.events = createTelegramChannel(ctx)
	}

	setBaseClient(client: HttpClient) {
		this.baseClient = client
	}

	getOverview() {
		const statuses = this.repo.list()
		const runningStates = new Set(['polling', 'webhook'])
		const active = statuses.filter((status) => runningStates.has(status.state)).length
		const configured = statuses.length
		return {
			name: this.ctx.pluginInfo.displayName,
			configuredBots: configured,
			activeBots: active,
			totalBots: statuses.length,
			modeBreakdown: {
				polling: statuses.filter((s) => s.mode === 'polling').length,
				webhook: statuses.filter((s) => s.mode === 'webhook').length,
				api: statuses.filter((s) => s.mode === 'api').length,
			},
			lastUpdatedAt: Date.now(),
		}
	}

	getPublicBots(limit = 64) {
		return this.repo.list(limit)
	}

	getBot(token: string) {
		return this.botsByToken.get(token) ?? this.botsById.get(token)
	}

	getFirstBot() {
		return this.botsById.values().next().value
	}

	getConnectedBots() {
		return Array.from(this.botsById.values())
	}

	registerSseChannel(channel: SseChannel, limit = 64) {
		const sendSnapshot = () => channel.emit('cursor', { type: 'cursor', ...this.getCursorPayload() })
		channel.emit('ready', { type: 'ready', now: Date.now(), ...this.getCursorPayload() })
		const dispose = this.repo.observe(limit, sendSnapshot)
		channel.onAbort(() => dispose())
		return dispose
	}

	async createBot(input: CreateBotInput): Promise<TelegramBotPublic> {
		return this.repo.create(input)
	}

	async deleteBot(id: string) {
		await this.disconnectBot(id).catch(() => {})
		return { ok: await this.repo.delete(id) }
	}

	async updateBot(id: string, patch: UpdateBotInput) {
		const updated = await this.repo.updateBot(id, patch)
		if (!updated) return { ok: false }

		const wasRunning = this.botsById.has(id)
		if (wasRunning) {
			await this.disconnectBot(id)
			await this.connectBot(id).catch((e) => {
				const error = e instanceof Error ? e : new Error(String(e))
				this.logger.warn('bot 重连失败 ({id})', { id, error })
			})
		}
		return { ok: true, bot: updated }
	}

	async connectBot(id: string) {
		const doc = this.repo.findOne(id)
		if (!doc) throw new Error('Bot 未找到')
		if (this.botsById.has(id)) {
			return { id, status: doc.state }
		}

		let token: string
		try {
			token = await this.repo.getToken(id)
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			await this.repo.update(id, {
				state: 'error',
				stateMessage: 'Token 缺失（请重新添加 bot）',
				lastError: message,
				connectedAt: undefined,
				secure: false,
			})
			throw e
		}

		await this.repo.update(id, { state: 'authenticating', stateMessage: '正在启动', lastError: undefined, secure: true })
		const config = this.toBotConfig(doc, token)

		if (doc.mode === 'webhook' && !config.webhook?.url) {
			throw new Error('Webhook 模式需要 webhookUrl')
		}

		const bot = new Bot(this.baseClient, config, this.ctx, this.events, (status) =>
			this.onBotStatus(id, status),
		)

		this.botsById.set(id, bot)
		this.botsByToken.set(token, bot)
		if (doc.mode === 'webhook') {
			this.webhookBotsByToken.set(token, bot)
		}

		try {
			await bot.start()
			await this.repo.update(id, {
				state: bot.getStatusSnapshot().state,
				stateMessage: '已连接',
				username: bot.selfInfo?.username,
				displayName: bot.selfInfo?.first_name ?? bot.selfInfo?.username,
				connectedAt: Date.now(),
			})
			this.logger.info('bot started', { bot: bot.selfInfo?.username, mode: doc.mode })
			return { id, status: 'connected' }
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			await this.repo.update(id, { state: 'error', lastError: message, stateMessage: '启动失败' })
			this.botsById.delete(id)
			this.botsByToken.delete(token)
			this.webhookBotsByToken.delete(token)
			const error = e instanceof Error ? e : new Error(String(e))
			this.logger.error('bot 启动失败', { error })
			throw e
		}
	}

	async disconnectBot(id: string) {
		const bot = this.botsById.get(id)
		const doc = this.repo.findOne(id)
		if (!bot) {
			if (doc) await this.repo.update(id, { state: 'stopped', stateMessage: '已断开' })
			return { id, status: 'stopped' }
		}
		await bot.stop().catch((e) => {
			const error = e instanceof Error ? e : new Error(String(e))
			this.logger.warn('bot 停止失败 ({id})', { id, error })
		})
		this.botsById.delete(id)
		this.removeTokenMappings(bot)
		if (doc) {
			await this.repo.update(id, { state: 'stopped', stateMessage: '已断开', connectedAt: undefined })
		}
		return { id, status: 'stopped' }
	}

	disconnectAll() {
		return Promise.allSettled(Array.from(this.botsById.keys()).map((id) => this.disconnectBot(id)))
	}

	handleWebhook(token: string, update: unknown, secretToken?: string): boolean {
		const bot = this.webhookBotsByToken.get(token)
		if (!bot) return false
		return bot.handleWebhookUpdate(update, secretToken)
	}

	snapshot() {
		return this.getCursorPayload()
	}

	private getCursorPayload() {
		const bots = this.repo.list(64)
		return { bots, overview: this.getOverview() }
	}

	private toBotConfig(doc: TelegramBotRecord, token: string): BotConfig {
		const webhook: WebhookOptions | undefined =
			doc.mode === 'webhook'
				? {
						url: doc.webhookUrl ?? '',
						secretToken: doc.webhookSecretToken,
						maxConnections: undefined,
						dropPendingUpdates: undefined,
						allowedUpdates: undefined,
					}
				: undefined

		return {
			token,
			apiBase: this.apiBase,
			mode: doc.mode,
			polling: doc.mode === 'polling' ? {} : undefined,
			webhook,
		}
	}

	private onBotStatus(id: string, status: BotState) {
		void this.repo.update(id, {
			state: status.state,
			stateMessage: status.stateMessage,
			lastError: status.lastError,
			username: status.username,
			displayName: status.displayName,
			lastUpdateAt: status.lastUpdateAt,
			lastUpdateId: status.lastUpdateId,
			pollingOffset: status.polling?.offset,
			pollingBackoff: status.polling?.backoffIndex,
			webhookUrl: status.webhook?.url,
			webhookSecretToken: status.webhook?.secretToken,
		}).catch((e) => {
			const error = e instanceof Error ? e : new Error(String(e))
			this.logger.warn('bot 状态更新失败 ({id})', { id, error })
		})
	}

	private removeTokenMappings(bot: Bot) {
		for (const [token, value] of this.botsByToken) {
			if (value === bot) this.botsByToken.delete(token)
		}
		for (const [token, value] of this.webhookBotsByToken) {
			if (value === bot) this.webhookBotsByToken.delete(token)
		}
	}
}

export type { TelegramBotPublic, TelegramBotRecord }
