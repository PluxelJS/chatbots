import type { Context } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { MilkyBot } from '../bot'
import { createMilkyChannel, type MilkyChannel } from '../events'
import {
	MilkyBotRegistry,
	type BotState,
	type CreateBotInput,
	type MilkyBotPublic,
	type MilkyBotRecord,
	type UpdateBotInput,
} from './bot-registry'

export class MilkyBotManager {
	private readonly botInstances = new Map<string, MilkyBot>()
	public readonly events: MilkyChannel
	private readonly enableStatusPersistence: boolean
	private readonly statusDebounceMs: number
	private readonly logger: ReturnType<Context['logger']['with']>
	private readonly pendingStatus = new Map<
		string,
		{ timer: ReturnType<typeof setTimeout> | null; patch: Partial<MilkyBotRecord> }
	>()

	constructor(
		private readonly ctx: Context,
		private readonly repo: MilkyBotRegistry,
		private readonly baseClient: HttpClient,
		options?: { enableStatusPersistence?: boolean; statusDebounceMs?: number },
	) {
		this.logger = ctx.logger.with({ platform: 'milky' })
		this.events = createMilkyChannel(ctx)
		this.enableStatusPersistence = options?.enableStatusPersistence ?? true
		this.statusDebounceMs = Math.max(0, options?.statusDebounceMs ?? 250)
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

	async createBot(input: CreateBotInput): Promise<MilkyBotPublic> {
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
				const error = e instanceof Error ? e : new Error(String(e))
				this.logger.warn('bot 重连失败 ({id})', { id, error })
			})
		}
		return { ok: true, bot: updated }
	}

	async connectBot(id: string) {
		const doc = this.repo.findOne(id)
		if (!doc) throw new Error('Bot 未找到')
		if (this.botInstances.has(id)) return { id, status: doc.state }

		if (this.enableStatusPersistence) {
			await this.repo.update(id, { state: 'connecting', stateMessage: '正在启动', lastError: undefined })
		}

		const accessToken = await this.repo.getAccessToken(id)
		if (doc.secure && !accessToken) {
			if (this.enableStatusPersistence) {
				await this.repo.update(id, {
					state: 'error',
					stateMessage: 'Token 缺失（请重新添加 bot）',
					lastError: 'Milky bot accessToken 缺失（vault 中未找到）',
					connectedAt: undefined,
					secure: false,
					tokenPreview: '—',
				})
			}
			throw new Error('Milky bot accessToken 缺失（vault 中未找到），请重新添加 bot')
		}
		const bot = new MilkyBot(
			this.baseClient,
			{ baseUrl: doc.baseUrl, accessToken: accessToken || undefined },
			this.ctx,
			this.events,
			this.enableStatusPersistence ? (status) => this.onBotStatus(id, status) : undefined,
		)

		this.botInstances.set(id, bot)

		try {
			await bot.$control.start()
			if (this.enableStatusPersistence) {
				await this.repo.update(id, { state: 'online', stateMessage: '已连接', connectedAt: Date.now() })
			}
			return { id, status: 'online' }
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e)
			if (this.enableStatusPersistence) {
				await this.repo.update(id, { state: 'error', lastError: message, stateMessage: '启动失败' })
			}
			this.botInstances.delete(id)
			const error = e instanceof Error ? e : new Error(String(e))
			this.logger.error('bot 启动失败 ({id})', { id, error })
			throw e
		}
	}

	async disconnectBot(id: string) {
		const bot = this.botInstances.get(id)
		const doc = this.repo.findOne(id)
		if (!bot) {
			if (doc && this.enableStatusPersistence) {
				await this.repo.update(id, { state: 'stopped', stateMessage: '已断开', connectedAt: undefined })
			}
			return { id, status: 'stopped' }
		}
		this.cancelPendingStatusUpdate(id)
		await bot.$control.stop().catch((e) => {
			const error = e instanceof Error ? e : new Error(String(e))
			this.logger.warn('bot 停止失败 ({id})', { id, error })
		})
		this.botInstances.delete(id)
		if (doc && this.enableStatusPersistence) {
			await this.repo.update(id, { state: 'stopped', stateMessage: '已断开', connectedAt: undefined })
		}
		return { id, status: 'stopped' }
	}

	disconnectAll() {
		return Promise.allSettled(Array.from(this.botInstances.keys()).map((id) => this.disconnectBot(id)))
	}

	private onBotStatus(id: string, status: BotState) {
		if (!this.enableStatusPersistence) return
		const patch = {
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
			lastEventType: status.lastEventType,
			connectedAt: status.connectedAt,
		} satisfies Partial<MilkyBotRecord>

		this.queueStatusUpdate(id, patch)
	}

	private queueStatusUpdate(id: string, patch: Partial<MilkyBotRecord>) {
		const entry = this.pendingStatus.get(id) ?? { timer: null, patch: {} }
		Object.assign(entry.patch, patch)
		this.pendingStatus.set(id, entry)

		if (this.statusDebounceMs === 0) {
			this.flushStatusUpdate(id)
			return
		}

		if (entry.timer) return
		entry.timer = setTimeout(() => {
			entry.timer = null
			this.flushStatusUpdate(id)
		}, this.statusDebounceMs)
	}

	private flushStatusUpdate(id: string) {
		const entry = this.pendingStatus.get(id)
		if (!entry) return
		const patch = entry.patch
		entry.patch = {}

		void this.repo
			.update(id, patch)
			.catch((e) => {
				const error = e instanceof Error ? e : new Error(String(e))
				this.logger.warn('bot 状态更新失败 ({id})', { id, error })
			})
	}

	private cancelPendingStatusUpdate(id: string) {
		const entry = this.pendingStatus.get(id)
		if (!entry) return
		if (entry.timer) clearTimeout(entry.timer)
		this.pendingStatus.delete(id)
	}
}

export type { MilkyBotPublic, MilkyBotRecord }
