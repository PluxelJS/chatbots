import type { Context } from '@pluxel/hmr'
import { Bot } from '../bot'
import type { WebSocketPlugin } from 'pluxel-plugin-websocket'
import type { HttpClient } from 'pluxel-plugin-wretch'
import type { SseChannel } from '@pluxel/hmr/services'
import {
	KookBotRegistry,
	type BotState,
	type CreateBotInput,
	type KookBotPublic,
	type KookBotRecord,
	type UpdateBotInput,
} from './bot-registry'
import { createKookChannel, type KookChannel } from '../events'
import { dispatchKookEvent } from '../events/dispatcher'

export class KookBotManager {
	public readonly bots: Record<string, Bot> = {}
	private readonly botInstances = new Map<string, Bot>()
	private readonly botsByVerify = new Map<string, Bot>()
	public readonly events: KookChannel

	constructor(
		private readonly ctx: Context,
		private readonly repo: KookBotRegistry,
		private readonly websocket: WebSocketPlugin,
		private baseClient: HttpClient,
	) {
		this.events = createKookChannel(this.ctx)
	}

	setBaseClient(client: HttpClient) {
		this.baseClient = client
	}

	getOverview() {
		const snapshot = this.repo.list()
		const healthyStates = new Set(['online', 'weak', 'handshaking', 'connecting', 'resuming'])
		const active = snapshot.filter((status) => healthyStates.has(status.state)).length
		const configured = snapshot.length
		return {
			name: this.ctx.pluginInfo.id,
			configuredBots: configured,
			activeBots: active,
			totalBots: snapshot.length,
			lastUpdatedAt: Date.now(),
		}
	}

	async createBot(input: CreateBotInput) {
		return this.repo.create(input)
	}

	async deleteBot(id: string) {
		await this.disconnectBot(id).catch(() => {})
		return { ok: await this.repo.delete(id) }
	}

	async updateBot(id: string, patch: UpdateBotInput) {
		const updated = await this.repo.updateBot(id, patch)
		if (!updated) return { ok: false }

		const running = this.botInstances.has(id)
		if (running) {
			await this.disconnectBot(id)
			await this.connectBot(id).catch((e) => {
				this.ctx.logger.warn(e, 'KOOK bot 重连失败')
			})
		}
		return { ok: true, bot: updated }
	}

	async connectBot(id: string) {
		const doc = this.repo.findOne(id)
		if (!doc) throw new Error('Bot 未找到')
		if (this.botInstances.has(id)) {
			return { status: doc.state, id }
		}

		await this.repo.update(id, { state: 'connecting', stateMessage: '正在启动', lastError: undefined })
		const token = this.repo.decryptToken(doc)

		const client = new Bot(
			this.baseClient.headers({ Authorization: `Bot ${token}` }),
			this.ctx,
			this.events,
			this.websocket,
			doc.mode,
			(status) => this.onBotStatus(id, status),
		)

		this.botInstances.set(id, client)
		const verifyKey = doc.verifyToken ?? token
		if (verifyKey) this.botsByVerify.set(verifyKey, client)

		try {
			const remoteId = await client.start()
			await this.repo.update(id, {
				botId: remoteId,
				instanceId: client.instanceId,
				state: 'online',
				stateMessage: '已连接',
				connectedAt: Date.now(),
			})
			this.bots[id] = client
			return { status: 'online', id }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			await this.repo.update(id, { state: 'error', lastError: message, stateMessage: '启动失败' })
			this.botInstances.delete(id)
			if (doc.verifyToken) this.botsByVerify.delete(doc.verifyToken)
			throw error
		}
	}

	async disconnectBot(id: string) {
		const bot = this.botInstances.get(id)
		const doc = this.repo.findOne(id)
		if (doc) {
			const verifyKey = doc.verifyToken ?? (doc ? this.repo.decryptToken(doc) : undefined)
			if (verifyKey) this.botsByVerify.delete(verifyKey)
		}
		if (!bot) {
			if (doc) {
				await this.repo.update(id, { state: 'stopped', stateMessage: '已断开', connectedAt: undefined })
			}
			return { status: 'stopped', id }
		}
		await bot.stop().catch((e) => this.ctx.logger.warn(e, 'KOOK bot 停止失败'))
		this.botInstances.delete(id)
		delete this.bots[id]
		if (doc) {
			await this.repo.update(id, { state: 'stopped', stateMessage: '已断开', connectedAt: undefined })
		}
		return { status: 'stopped', id }
	}

	getPublicBots(limit = 64) {
		return this.repo.list(limit)
	}

	getCursorPayload() {
		const bots = this.repo.list(64)
		return { bots, overview: this.getOverview() }
	}

	disconnectAll() {
		return Promise.allSettled(
			Array.from(this.botInstances.keys()).map((id) =>
				this.disconnectBot(id).catch((error) => {
					this.ctx.logger.warn({ id, error }, '断开 KOOK bot 失败')
				}),
			),
		)
	}

	registerWebhook(path: string) {
		this.ctx.honoService.modifyApp((app) => {
			app.post(path, async (c) => {
				let payload: any | undefined
				try {
					payload = await c.req.json()
				} catch (e) {
					this.ctx.logger.warn(e, 'KOOK webhook: 解析 JSON 失败')
					return c.json({ error: 'invalid json' }, 400)
				}
				const data = payload?.d
				const token = data?.verify_token
				if (!token) return c.json({ error: 'missing verify_token' }, 400)

				const bot = this.botsByVerify.get(token)
				if (!bot) return c.json({ error: 'unknown bot' }, 403)

				if (data.channel_type === 'WEBHOOK_CHALLENGE') {
					return c.json({ challenge: data.challenge })
				}

				void Promise.resolve().then(() => dispatchKookEvent(this.events, this.ctx, bot, data))
				return c.json({ ok: true })
			})
		})
		this.ctx.logger.info({ path }, 'KOOK webhook 路由已注册')
	}

	registerSseChannel(channel: SseChannel, limit = 64) {
		const sendSnapshot = () => channel.emit('cursor', { type: 'cursor', ...this.getCursorPayload() })
		channel.emit('ready', { type: 'ready', now: Date.now(), ...this.getCursorPayload() })
		const dispose = this.repo.observe(limit, sendSnapshot)
		channel.onAbort(() => dispose())
		return dispose
	}

	onBotStatus(id: string, status: BotState) {
		void this.repo.update(id, {
			state: status.state,
			stateMessage: status.stateMessage,
			lastError: status.lastError,
			username: status.username,
			displayName: status.displayName,
			botId: status.botId,
			instanceId: status.instanceId,
			gatewayState: status.gateway?.state ?? status.state,
			gateway: status.gateway,
			lastEventAt: status.lastEventAt,
			lastSequence: status.lastSequence,
		}).catch((error) => this.ctx.logger.warn(error, 'KOOK bot 状态更新失败'))
	}
}

export type { KookBotPublic, KookBotRecord }
