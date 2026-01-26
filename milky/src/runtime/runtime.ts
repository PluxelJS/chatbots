import type { Context } from '@pluxel/hmr'
import type { Config } from '@pluxel/hmr'
import type { HttpClient } from '@pluxel/wretch'
import { middlewares, WretchPlugin } from '@pluxel/wretch'
import type { MilkyConfigType } from '../config'
import { MilkyBotManager, type MilkyBotPublic } from './bot-manager'
import { MilkyBotRegistry, type CreateBotInput, type UpdateBotInput } from './bot-registry'
import { MilkySseBridge, type MilkySnapshot } from './sse'
import type { MilkyChannel } from '../events'

export class MilkyRuntime {
	public readonly baseClient: HttpClient
	public events!: MilkyChannel

	private ctx!: Context
	private logger!: ReturnType<Context['logger']['with']>
	private config!: Config<MilkyConfigType>
	private repo!: MilkyBotRegistry
	private manager!: MilkyBotManager
	private sseBridge: MilkySseBridge | null = null
	private autoConnectScheduled = false
	private abort?: AbortSignal

	constructor(wretch: WretchPlugin) {
		this.baseClient = wretch
			.createClient({ throwHttpErrors: true })
			.middlewares([middlewares.retry({ maxAttempts: 2, retryOnNetworkError: true })])
	}

	async bootstrap(ctx: Context, config: Config<MilkyConfigType>, abort?: AbortSignal) {
		this.ctx = ctx
		this.logger = ctx.logger.with({ platform: 'milky' })
		this.config = config
		this.abort = abort
		const inHmr = Boolean((this.ctx as unknown as { env?: { isHmrRuntime?: boolean } }).env?.isHmrRuntime)

		this.repo = new MilkyBotRegistry(this.ctx)
		await this.repo.init()

		this.manager = new MilkyBotManager(
			this.ctx,
			this.repo,
			this.baseClient,
			inHmr ? { statusDebounceMs: 250 } : { enableStatusPersistence: false },
		)
		this.events = this.manager.events
		this.sseBridge = inHmr ? new MilkySseBridge(this.repo, this.manager) : null

		if (this.abort?.aborted) return
		this.scheduleAutoConnect()
	}

	async teardown() {
		if (this.manager) {
			await this.manager.disconnectAll()
		}
	}

	async getOverview() {
		await this.repo.whenReady()
		return this.manager.getOverview()
	}

	async getBotStatuses() {
		await this.repo.whenReady()
		return this.manager.getPublicBots()
	}

	async createBot(input: CreateBotInput): Promise<MilkyBotPublic> {
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

	async snapshot(): Promise<MilkySnapshot> {
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
			throw new Error('[Milky] SSE bridge not initialized')
		}
		return this.sseBridge.createHandler()
	}

	private async autoConnectBots() {
		if (this.abort?.aborted) return
		if (this.config.autoConnect === false) return
		await this.repo.whenReady()
		if (this.abort?.aborted) return
		const bots = this.repo.list(128).filter((b) => b.secure !== false)
		if (bots.length === 0) return
		await Promise.allSettled(
			bots.map(async (b) => {
				try {
					await this.manager.connectBot(b.id)
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e))
					if (error.message.includes('token 缺失') || error.message.includes('vault 中未找到')) {
						this.logger.info('autoConnect skipped (missing token) for {id}', { id: b.id })
						return
					}
					this.logger.warn('autoConnect failed for {id}', { id: b.id, error })
				}
			}),
		)
	}

	private scheduleAutoConnect() {
		if (this.autoConnectScheduled) return
		this.autoConnectScheduled = true

		setTimeout(() => {
			if (this.abort?.aborted) return
			void this.autoConnectBots().catch((e) => {
				const error = e instanceof Error ? e : new Error(String(e))
				this.logger.warn('autoConnect failed', { error })
			})
		}, 0)
	}
}

export type { MilkySnapshot }
