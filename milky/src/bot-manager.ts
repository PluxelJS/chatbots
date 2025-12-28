import type { Context } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import type { SseChannel } from '@pluxel/hmr/services'
import { MilkyBot } from './bot'
import { createMilkyChannel, type MilkyChannel } from './events'
import type { MilkyEventTransport } from './config'
import {
	MilkyBotRegistry,
	type BotState,
	type CreateBotInput,
	type MilkyBotPublic,
	type MilkyBotRecord,
	type UpdateBotInput,
} from './runtime/bot-registry'

export class MilkyBotManager {
	private readonly botInstances = new Map<string, MilkyBot>()
	public readonly events: MilkyChannel

	constructor(
		private readonly ctx: Context,
		private readonly repo: MilkyBotRegistry,
		private readonly baseClient: HttpClient,
		private readonly defaultTransport: MilkyEventTransport,
	) {
		this.events = createMilkyChannel(ctx)
	}

	getOverview() {
		const snapshot = this.repo.list()
		const healthyStates = new Set(['online', 'connecting'])
		const active = snapshot.filter((s) => healthyStates.has(s.state)).length
		const configured = snapshot.length
		return {
			name: this.ctx.pluginInfo.id,
			configuredBots: configured,
			activeBots: active,
			totalBots: snapshot.length,
			lastUpdatedAt: Date.now(),
		}
	}

	getPublicBots(limit = 64) {
		return this.repo.list(limit)
	}

	async createBot(input: Omit<CreateBotInput, 'transport'> & { transport?: MilkyEventTransport }): Promise<MilkyBotPublic> {
		return this.repo.create({
			...input,
			transport: input.transport ?? this.defaultTransport,
		})
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
				this.ctx.logger.warn(e, '[Milky] bot 重连失败')
			})
		}
		return { ok: true, bot: updated }
	}

	async connectBot(id: string) {
		const doc = this.repo.findOne(id)
		if (!doc) throw new Error('Bot 未找到')
		if (this.botInstances.has(id)) return { id, status: doc.state }

		await this.repo.update(id, { state: 'connecting', stateMessage: '正在启动', lastError: undefined })

		const accessToken = this.repo.decryptAccessToken(doc)
		const bot = new MilkyBot(
			this.baseClient,
			{ baseUrl: doc.baseUrl, accessToken: accessToken || undefined, transport: doc.transport },
			this.ctx,
			this.events,
			(status) => this.onBotStatus(id, status),
		)

		this.botInstances.set(id, bot)

		try {
			await bot.start()
			await this.repo.update(id, { state: 'online', stateMessage: '已连接', connectedAt: Date.now() })
			return { id, status: 'online' }
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			await this.repo.update(id, { state: 'error', lastError: message, stateMessage: '启动失败' })
			this.botInstances.delete(id)
			this.ctx.logger.error(e, '[Milky] bot 启动失败')
			throw e
		}
	}

	async disconnectBot(id: string) {
		const bot = this.botInstances.get(id)
		const doc = this.repo.findOne(id)
		if (!bot) {
			if (doc) await this.repo.update(id, { state: 'stopped', stateMessage: '已断开', connectedAt: undefined })
			return { id, status: 'stopped' }
		}
		await bot.stop().catch((e) => this.ctx.logger.warn(e, '[Milky] bot 停止失败'))
		this.botInstances.delete(id)
		if (doc) {
			await this.repo.update(id, { state: 'stopped', stateMessage: '已断开', connectedAt: undefined })
		}
		return { id, status: 'stopped' }
	}

	disconnectAll() {
		return Promise.allSettled(Array.from(this.botInstances.keys()).map((id) => this.disconnectBot(id)))
	}

	registerSseChannel(channel: SseChannel, limit = 64) {
		const sendSnapshot = () => channel.emit('cursor', { type: 'cursor', ...this.getCursorPayload() })
		channel.emit('ready', { type: 'ready', now: Date.now(), ...this.getCursorPayload() })
		const dispose = this.repo.observe(limit, sendSnapshot)
		channel.onAbort(() => dispose())
		return dispose
	}

	private getCursorPayload() {
		const bots = this.repo.list(64)
		return { bots, overview: this.getOverview() }
	}

	private onBotStatus(id: string, status: BotState) {
		void this.repo
			.update(id, {
				state: status.state,
				stateMessage: status.stateMessage,
				lastError: status.lastError,
				selfId: status.selfId,
				nickname: status.nickname,
				implName: status.implName,
				implVersion: status.implVersion,
				milkyVersion: status.milkyVersion,
				qqProtocolType: status.qqProtocolType,
				qqProtocolVersion: status.qqProtocolVersion,
				lastEventAt: status.lastEventAt,
				connectedAt: status.connectedAt,
			} satisfies Partial<MilkyBotRecord>)
			.catch((error) => this.ctx.logger.warn(error, '[Milky] bot 状态更新失败'))
	}
}

export type { MilkyBotPublic, MilkyBotRecord }
