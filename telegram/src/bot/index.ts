import type { Context } from '@pluxel/hmr'
import type { HttpClient } from '@pluxel/wretch'
import type { UserFromGetMe } from '@grammyjs/types'
import type { Update } from '@grammyjs/types'
import type { TelegramChannel } from '../events'
import type { UpdateMeta } from '../types'
import { AbstractBot } from './api'
import { dispatchUpdate } from '../events/dispatcher'
import { createInitialStatus, type TelegramBotStatus } from '../shared/status'

export type TelegramBotControl = {
	info: {
		instanceId: string
		apiBase: string
		mode: 'polling' | 'webhook' | 'api'
		tokenSuffix: string
	}
	start(): Promise<void>
	stop(): Promise<void>
	getStatusSnapshot(): TelegramBotStatus
}

export interface PollingOptions {
	/** 超时时间（毫秒），默认 25000 */
	timeoutMs: number
	/** 每次获取的更新数量限制，默认 50 */
	limit: number
	/** 无更新时的空闲延迟（毫秒），默认 300 */
	idleDelayMs: number
	/** 错误退避时间数组（毫秒），默认 [1000, 2000, 4000, 8000] */
	backoffMs: number[]
	/** 允许的更新类型，不设置则接收所有 */
	allowedUpdates?: string[]
}

export interface WebhookOptions {
	/** Webhook URL */
	url: string
	/** 自签名证书（可选） */
	certificate?: string
	/** 服务器 IP 地址（可选） */
	ipAddress?: string
	/** 最大连接数，默认 40 */
	maxConnections?: number
	/** 允许的更新类型 */
	allowedUpdates?: string[]
	/** 是否丢弃待处理更新 */
	dropPendingUpdates?: boolean
	/** 密钥 Token（用于验证 Webhook 请求） */
	secretToken?: string
}

export interface BotConfig {
	/** Bot Token */
	token: string
	/** API 基础 URL，默认 https://api.telegram.org */
	apiBase: string
	/** 更新模式：polling / webhook / api */
	mode: 'polling' | 'webhook' | 'api'
	/** Polling 配置（mode 为 polling 时使用） */
	polling?: Partial<PollingOptions>
	/** Webhook 配置（mode 为 webhook 时使用） */
	webhook?: WebhookOptions
}

const DEFAULT_POLLING: PollingOptions = {
	timeoutMs: 25000,
	limit: 50,
	idleDelayMs: 300,
	backoffMs: [1000, 2000, 4000, 8000],
}

export class Bot extends AbstractBot {
	public readonly $control: TelegramBotControl
	public selfInfo?: UserFromGetMe
	public readonly token: string
	public readonly apiBase: string
	public readonly mode: 'polling' | 'webhook' | 'api'

	private readonly logger: ReturnType<Context['logger']['with']>
	private running = false
	private offset = 0
	private abort?: AbortController
	private backoffIndex = 0
	private readonly pollingOptions: PollingOptions
	public readonly instanceId: string
	private status: TelegramBotStatus
	private readonly onStatusChange?: (status: TelegramBotStatus) => void
	private stopRequested = false
	private readonly isAbortError = (err: unknown) => {
		if (!err) return false
		if (err instanceof DOMException && err.name === 'AbortError') return true
		if (err instanceof Error && /aborted/i.test(err.message)) return true
		return false
	}

	private static seq = 0

	constructor(
		public readonly http: HttpClient,
		private readonly config: BotConfig,
		private readonly ctx: Context,
		private readonly events: TelegramChannel,
		onStatusChange?: (status: TelegramBotStatus) => void,
	) {
		super(http, { apiBase: config.apiBase, token: config.token })
		this.token = config.token
		this.apiBase = config.apiBase
		this.mode = config.mode
		this.pollingOptions = {
			...DEFAULT_POLLING,
			...config.polling,
		}
		this.instanceId = `tg-bot-${++Bot.seq}`
		this.status = createInitialStatus(this.instanceId, this.mode, this.token)
		this.logger = ctx.logger.with({ platform: 'telegram', instanceId: this.instanceId })
		this.onStatusChange = onStatusChange
		this.$control = {
			info: {
				instanceId: this.instanceId,
				apiBase: this.apiBase,
				mode: this.mode,
				tokenSuffix: this.status.tokenSuffix,
			},
			start: () => this.start(),
			stop: () => this.stop(),
			getStatusSnapshot: () => this.getStatusSnapshot(),
		}
	}

	private updateStatus(patch: Partial<TelegramBotStatus>) {
		this.status = {
			...this.status,
			...patch,
			polling: patch.polling
				? { ...this.status.polling, ...patch.polling }
				: this.status.polling,
			webhook: patch.webhook
				? { ...this.status.webhook, ...patch.webhook }
				: this.status.webhook,
			updatedAt: Date.now(),
		}
		this.onStatusChange?.(this.status)
	}

	getStatusSnapshot(): TelegramBotStatus {
		return { ...this.status }
	}

	/** 启动 Bot */
	async start(): Promise<void> {
		this.stopRequested = false
		this.updateStatus({
			state: 'authenticating',
			stateMessage: '正在验证 Bot Token',
			webhook: this.config.webhook,
		})
		// 获取 Bot 信息
		const me = await this.$raw.request<UserFromGetMe>('GET', 'getMe')
		if (!me.ok) {
			this.updateStatus({
				state: 'error',
				stateMessage: '获取 Bot 信息失败',
				lastError: me.message,
			})
			throw new Error(`Failed to get bot info: ${me.message}`)
		}
		this.selfInfo = me.data
		this.updateStatus({
			username: me.data.username,
			displayName: me.data.first_name ?? me.data.username,
		})
		this.logger.info('Telegram bot authenticated', { bot: this.selfInfo.username })

		if (this.mode === 'polling') {
			await this.startPolling()
		} else if (this.mode === 'webhook') {
			await this.setupWebhook()
		} else {
			this.updateStatus({
				state: 'api',
				stateMessage: 'API 模式（不接收更新）',
			})
		}
	}

	/** 停止 Bot */
	async stop(): Promise<void> {
		this.stopRequested = true
		this.running = false
		this.abort?.abort()
		this.abort = undefined
		this.updateStatus({ state: 'stopped', stateMessage: 'stop() called' })

		if (this.mode === 'webhook') {
			// 删除 Webhook
			await this.$raw.call('deleteWebhook', { drop_pending_updates: false }).catch(() => {})
		}

		this.logger.info('Telegram bot stopped', { bot: this.selfInfo?.username })
	}

	/** 启动 Polling */
	private async startPolling(): Promise<void> {
		if (this.running) return
		this.running = true
		this.abort = new AbortController()
		this.updateStatus({
			state: 'polling',
			stateMessage: '长轮询启动',
			polling: { offset: this.offset, backoffIndex: this.backoffIndex },
			lastError: undefined,
		})

		// 先删除可能存在的 Webhook（便于在 polling/webhook 间切换）
		await this.$raw.call('deleteWebhook', { drop_pending_updates: false }).catch(() => {})

		// 注册清理效果
		const cleanup = () => this.stop().catch(() => {})
		this.ctx.effects.defer(cleanup)

		this.pollingLoop().catch((e) => {
			this.updateStatus({
				lastError: e instanceof Error ? e.message : String(e),
				stateMessage: '轮询循环异常',
			})
			this.emitError(e)
			this.stop().catch(() => {})
		})
	}

	/** Polling 循环 */
	private async pollingLoop(): Promise<void> {
		while (this.running) {
			this.events.pollCycle.emit()

			try {
				const updates = await this.fetchUpdates()
				this.backoffIndex = 0
				this.updateStatus({
					polling: { offset: this.offset, backoffIndex: this.backoffIndex },
					stateMessage: updates.length ? '收到新更新' : '等待新更新',
					lastError: undefined,
				})

				for (const update of updates) {
					this.offset = Math.max(this.offset, update.update_id + 1)
					this.recordUpdate(update.update_id)
					dispatchUpdate(this.events, this.ctx, this, update)
				}

				if (updates.length === 0) {
					await this.sleep(this.pollingOptions.idleDelayMs)
				}
			} catch (e) {
				// 主动 abort（stop/teardown）导致的中断不视为错误；意外 abort 则当作一次失败继续重试
				if (this.isAbortError(e)) {
					if (this.stopRequested || this.abort?.signal.aborted) {
						this.updateStatus({
							state: 'stopped',
							stateMessage: '轮询已中止',
							lastError: undefined,
						})
						this.running = false
						break
					}
					// 非预期的 abort，当作无事件处理，进入轻微等待即可
					this.updateStatus({
						stateMessage: '连接抖动，等待恢复',
						lastError: undefined,
					})
					await this.sleep(this.pollingOptions.idleDelayMs)
					continue
				} else {
					this.emitError(e)
				}

				const delay =
					this.pollingOptions.backoffMs[
						Math.min(this.backoffIndex, this.pollingOptions.backoffMs.length - 1)
					]
				this.backoffIndex = Math.min(
					this.backoffIndex + 1,
					this.pollingOptions.backoffMs.length - 1,
				)
				this.updateStatus({
					polling: { offset: this.offset, backoffIndex: this.backoffIndex },
					stateMessage: `轮询失败，${delay}ms 后重试`,
				})
				await this.sleep(delay)
			}
		}
	}

	/** 获取更新 */
	private async fetchUpdates() {
		const result = await this.$raw.request<Update[]>('GET', 'getUpdates', {
			offset: this.offset,
			timeout: Math.ceil(this.pollingOptions.timeoutMs / 1000),
			limit: this.pollingOptions.limit,
			allowed_updates: this.pollingOptions.allowedUpdates as any,
		})

		if (!result.ok) {
			const message = result.message || 'getUpdates failed'
			if (/aborted/i.test(message)) {
				// 远端关闭或网络抖动导致的 Abort 视为一次空轮询，直接返回空数组
				return []
			}
			const error = new Error(message)
			this.logger.warn('getUpdates failed', {
				code: result.code,
				offset: this.offset,
				bot: this.selfInfo?.username,
				error,
			})
			throw error
		}

		return (result.data ?? []).filter((u: Update) => typeof u?.update_id === 'number')
	}

	/** 设置 Webhook */
	private async setupWebhook(): Promise<void> {
		const webhook = this.config.webhook
		if (!webhook?.url) {
			throw new Error('Webhook URL is required for webhook mode')
		}
		this.updateStatus({
			state: 'webhook',
			stateMessage: '正在配置 Webhook',
			webhook: { url: webhook.url, secretToken: webhook.secretToken },
		})

		const result = await this.$raw.call('setWebhook', {
			url: webhook.url,
			certificate: webhook.certificate,
			ip_address: webhook.ipAddress,
			max_connections: webhook.maxConnections,
			allowed_updates: webhook.allowedUpdates as any,
			drop_pending_updates: webhook.dropPendingUpdates,
			secret_token: webhook.secretToken,
		})

		if (!result.ok) {
			this.updateStatus({
				state: 'error',
				lastError: result.message,
				stateMessage: 'Webhook 配置失败',
			})
			throw new Error(`Failed to set webhook: ${result.message}`)
		}

		this.running = true
		this.updateStatus({
			state: 'webhook',
			stateMessage: 'Webhook 已就绪',
			lastError: undefined,
		})
		const origin = safeUrlOrigin(webhook.url)
		this.logger.info`webhook set (${origin})`
	}

	/** 处理 Webhook 请求（由外部路由调用） */
	handleWebhookUpdate(update: unknown, secretToken?: string): boolean {
		if (!this.running || this.mode !== 'webhook') {
			return false
		}

		// 验证 secret token
		if (this.config.webhook?.secretToken && secretToken !== this.config.webhook.secretToken) {
			return false
		}

		if (!update || typeof update !== 'object' || !('update_id' in update)) {
			return false
		}

		const id = Number((update as any).update_id)
		if (!Number.isNaN(id)) {
			this.recordUpdate(id)
		}
		this.updateStatus({ state: 'webhook', stateMessage: '收到 Webhook 更新' })
		dispatchUpdate(this.events, this.ctx, this, update as any)
		return true
	}

	/** 睡眠 */
	private async sleep(ms: number): Promise<void> {
		if (ms <= 0) return
		await new Promise<void>((resolve) => {
			const t = setTimeout(resolve, ms)
			;(t as any).unref?.()
		})
	}

	/** 发送错误事件 */
	private emitError(e: unknown): void {
		const meta: UpdateMeta | undefined =
			this.offset > 0 ? { botId: this.instanceId, updateId: this.offset } : undefined
		this.events.error.emit(e, meta)
		const message = e instanceof Error ? e.message : String(e)
		this.updateStatus({ lastError: message })
		const error = e instanceof Error ? e : new Error(String(e))
		this.logger.error('polling error', { error })
	}

	private recordUpdate(updateId: number) {
		this.updateStatus({
			lastUpdateAt: Date.now(),
			lastUpdateId: updateId,
		})
	}
}

export { AbstractBot } from './api'

function safeUrlOrigin(value: string): string {
	try {
		return new URL(value).origin
	} catch {
		return 'invalid-url'
	}
}
