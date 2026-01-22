import type { Context } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import type { WebSocketPlugin } from 'pluxel-plugin-websocket'
import type { KookChannel } from '../events'
import type { User } from '../types'
import { AbstractBot } from './api'
import { dispatchKookEvent } from '../events/dispatcher'
import { createInitialStatus, type KookBotStatus } from '../shared/status'
import { KookGatewayClient, type GatewayState } from './websocket'

export type KookBotControl = {
	info: {
		instanceId: string
		mode: 'gateway' | 'webhook' | 'api'
	}
	start(): Promise<string>
	stop(): Promise<void>
	getStatusSnapshot(): KookBotStatus
}

export class Bot extends AbstractBot {
	public readonly $control: KookBotControl
	public selfInfo?: User
	client?: KookGatewayClient
	public readonly instanceId: string
	private status: KookBotStatus
	private readonly mode: 'gateway' | 'webhook' | 'api'
	private readonly onStatusChange?: (status: KookBotStatus) => void
	private readonly logger: ReturnType<Context['logger']['with']>

	private static seq = 0

	constructor(
		public readonly http: HttpClient,
		private readonly ctx: Context,
		private readonly events: KookChannel,
		private readonly websocket: WebSocketPlugin,
		mode: 'gateway' | 'webhook' | 'api' = 'gateway',
		onStatusChange?: (status: KookBotStatus) => void,
	) {
		super(http)
		this.instanceId = `kook-bot-${++Bot.seq}`
		this.logger = ctx.logger.with({ platform: 'kook', instanceId: this.instanceId })
		this.status = createInitialStatus(this.instanceId)
		this.mode = mode
		this.onStatusChange = onStatusChange
		this.$control = {
			info: { instanceId: this.instanceId, mode: this.mode },
			start: () => this.start(),
			stop: () => this.stop(),
			getStatusSnapshot: () => this.getStatusSnapshot(),
		}
	}

	private updateStatus(patch: Partial<KookBotStatus>) {
		this.status = {
			...this.status,
			...patch,
			updatedAt: Date.now(),
		}
		this.onStatusChange?.(this.status)
	}

	getStatusSnapshot(): KookBotStatus {
		return {
			...this.status,
			gateway: this.client?.getSnapshot() ?? this.status.gateway,
		}
	}

	async start(): Promise<string> {
		this.updateStatus({
			state: 'fetching_profile',
			stateMessage: '正在获取机器人资料',
		})
		const res = await this.getUserMe()
		if (res.ok === false) {
			const err = new Error(res.message)
			this.updateStatus({ state: 'error', lastError: err.message, stateMessage: '获取资料失败' })
			throw err
		}

		this.selfInfo = res.data
		const displayName = res.data.nickname || res.data.username
		this.updateStatus({
			botId: res.data.id,
			username: res.data.username,
			displayName,
		})

		if (this.mode === 'api') {
			this.updateStatus({
				state: 'api_only',
				stateMessage: 'API 模式（不连接网关）',
			})
			return res.data.id
		}

		if (this.mode === 'webhook') {
			this.updateStatus({
				state: 'webhook',
				stateMessage: 'Webhook 模式（不连接网关）',
			})
			return res.data.id
		}

		this.updateStatus({
			state: 'registering_gateway',
			stateMessage: '等待网关握手',
		})

		const client = this.createGatewayClient()
		this.client = client
		this.updateStatus({
			state: 'connecting',
			stateMessage: '正在连接 KOOK 网关',
			gateway: client.getSnapshot(),
		})

		void client.start().catch((error) => {
			const message = error instanceof Error ? error.message : String(error)
			this.updateStatus({
				state: 'error',
				lastError: message,
				stateMessage: '网关启动失败',
			})
			const err = error instanceof Error ? error : new Error(String(error))
			this.logger.error('KOOK 网关启动失败', { error: err })
		})

		return res.data.id
	}

	private createGatewayClient() {
		return new KookGatewayClient(
			{
				compress: 0,
				getGatewayUrl: async ({ resume, sn, session_id, compress }) => {
					const gateway = await this.getGateway({ compress })
					if (gateway.ok === false) throw new Error(gateway.message)
					const u = new URL(gateway.data.url)
					if (resume) {
						u.searchParams.set('resume', '1')
						u.searchParams.set('sn', String(sn ?? 0))
						if (session_id) u.searchParams.set('session_id', session_id)
					}
					return u.toString()
				},
				onEvent: (sn, data) => {
					this.updateStatus({
						lastEventAt: Date.now(),
						lastSequence: sn,
					})
					dispatchKookEvent(this.events, this.ctx, this, data)
				},
				onError: (e) => {
					const msg = e instanceof Error ? e.message : String(e)
					this.updateStatus({ lastError: msg, stateMessage: '网关异常' })
					const error = e instanceof Error ? e : new Error(String(e))
					this.logger.error('网关异常', { error })
				},
				onStateChange: (prev, next, meta) => {
					this.updateStatus({
						state: next,
						stateMessage: this.describeState(next, meta),
						gateway: this.client?.getSnapshot(),
					})
					this.logger.debug('gateway state {prev} -> {next}', { prev, next })
				},
			},
			(url, options) =>
				this.websocket.connect(url, {
					...options,
					description: 'kook-gateway',
					trackToCaller: true,
					clientOptions: { perMessageDeflate: false, ...options?.clientOptions },
				}),
		)
	}

	private describeState(state: GatewayState | KookBotStatus['state'], meta?: Record<string, any>) {
		if (!meta) return state === 'online' ? '网关已连接' : undefined
		if (typeof meta.reason === 'string') return meta.reason
		if (typeof meta.stage === 'string') return `${state}: ${meta.stage}`
		if (typeof meta.url === 'string') return meta.url
		if (typeof meta.delay === 'number') return `${state} · 等待 ${meta.delay}ms`
		if (meta.resumed) return 'resume 模式'
		if (meta.resume) return '尝试恢复会话'
		return state === 'online' ? '网关已连接' : undefined
	}

	async stop() {
		this.updateStatus({ state: 'stopped', stateMessage: 'stop()' })
		await this.client?.stop()
		await this.offline().catch(() => {})
		this.logger.info('机器人已停止。')
	}
}
