import type { Context } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { Event } from '@saltify/milky-types'
import type { MilkyChannel } from '../events'
import { dispatchMilkyEvent } from '../events/dispatcher'
import { createInitialStatus, type MilkyBotStatus } from '../shared/status'
import { AbstractBot } from './api'
import { maskSecret } from '../shared/utils'

export type MilkyBotConfig = {
	baseUrl: string
	accessToken?: string
}

export type MilkyBotControl = {
	info: {
		instanceId: string
		baseUrl: string
	}
	start(): Promise<void>
	stop(): Promise<void>
	getStatusSnapshot(): MilkyBotStatus
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const

const createIdleStatus = (instanceId: string, baseUrl: string, tokenPreview: string): MilkyBotStatus => ({
	instanceId,
	state: 'initializing',
	baseUrl,
	tokenPreview,
	startedAt: 0,
	updatedAt: 0,
})

export class MilkyBot extends AbstractBot {
	public readonly $control: MilkyBotControl

	private readonly baseUrl: string
	private readonly instanceId: string
	private readonly logger: Context['logger']

	private abort?: AbortController
	private running = false
	private stopRequested = false
	private status: MilkyBotStatus
	private readonly onStatusChange?: (status: MilkyBotStatus) => void

	private static seq = 0

	constructor(
		http: HttpClient,
		private readonly config: MilkyBotConfig,
		private readonly ctx: Context,
		private readonly events: MilkyChannel,
		onStatusChange?: (status: MilkyBotStatus) => void,
	) {
		super(http, { baseUrl: config.baseUrl, accessToken: config.accessToken })
		this.baseUrl = config.baseUrl.replace(/\/+$/, '')
		this.instanceId = `milky-${++MilkyBot.seq}`
		this.logger = ctx.logger.with({ platform: 'milky', instanceId: this.instanceId })
		this.onStatusChange = onStatusChange
		const preview = config.accessToken ? maskSecret(config.accessToken) : '—'
		this.status = onStatusChange
			? createInitialStatus(this.instanceId, this.baseUrl, preview)
			: createIdleStatus(this.instanceId, this.baseUrl, preview)
		this.$control = {
			info: { instanceId: this.instanceId, baseUrl: this.baseUrl },
			start: () => this.startInternal(),
			stop: () => this.stopInternal(),
			getStatusSnapshot: () => this.snapshotStatus(),
		}
	}

	private updateStatus(patch: Partial<MilkyBotStatus>) {
		if (!this.onStatusChange) return
		this.updateStatusAt(Date.now(), patch)
	}

	private updateStatusAt(now: number, patch: Partial<MilkyBotStatus>) {
		if (!this.onStatusChange) return
		this.status = { ...this.status, ...patch, updatedAt: now }
		this.onStatusChange(this.status)
	}

	private snapshotStatus(): MilkyBotStatus {
		return { ...this.status }
	}

	private async startInternal(): Promise<void> {
		this.stopRequested = false
		this.updateStatus({ state: 'connecting', stateMessage: '初始化中', lastError: undefined })

		const impl = await this.get_impl_info()
		if (impl.ok) {
			this.updateStatus({
				implName: impl.data.impl_name,
				implVersion: impl.data.impl_version,
				qqProtocolType: impl.data.qq_protocol_type,
				qqProtocolVersion: impl.data.qq_protocol_version,
				milkyVersion: impl.data.milky_version,
			})
		}

		const login = await this.get_login_info()
		if (!login.ok) {
			this.updateStatus({
				state: 'error',
				stateMessage: '未处于登录状态 / 鉴权失败',
				lastError: login.message,
			})
			throw new Error(login.message)
		}

		this.updateStatus({
			selfId: login.data.uin,
			nickname: login.data.nickname,
			stateMessage: '已登录，正在连接事件流',
		})

		await this.startEventLoop()
	}

	private async stopInternal(): Promise<void> {
		this.stopRequested = true
		this.running = false
		this.abort?.abort()
		this.abort = undefined

		this.updateStatus({ state: 'stopped', stateMessage: '已断开' })
	}

	private async startEventLoop(): Promise<void> {
		if (this.running) return
		this.running = true
		this.abort = new AbortController()

		const cleanup = () => this.stopInternal().catch(() => {})
		this.ctx.scope.collectEffect(cleanup)

		void this.eventLoop(this.abort.signal).catch((e) => {
			this.updateStatus({
				state: 'error',
				stateMessage: '事件循环异常',
				lastError: e instanceof Error ? e.message : String(e),
			})
			const error = e instanceof Error ? e : new Error(String(e))
			this.logger.error('event loop crashed', { error })
		})
	}

	private async eventLoop(signal: AbortSignal): Promise<void> {
		let backoffIndex = 0

		while (!signal.aborted && this.running) {
			try {
				this.updateStatus({
					state: 'connecting',
					stateMessage: '连接事件流（SSE）',
					lastError: undefined,
				})
				await this.connectSseOnce(signal)
				backoffIndex = 0
			} catch (e) {
				if (signal.aborted || this.stopRequested) break
				const message = e instanceof Error ? e.message : String(e)
				this.updateStatus({ state: 'error', stateMessage: '事件连接失败', lastError: message })
				const wait = DEFAULT_BACKOFF_MS[Math.min(backoffIndex, DEFAULT_BACKOFF_MS.length - 1)]
				backoffIndex++
				await this.sleep(wait, signal)
			}
		}
	}

	private async connectSseOnce(signal: AbortSignal): Promise<void> {
		const url = new URL(this.baseUrl)
		url.pathname = `${url.pathname.replace(/\/+$/, '')}/event`
		const headers: Record<string, string> = {
			Accept: 'text/event-stream',
		}
		if (this.config.accessToken) headers.Authorization = `Bearer ${this.config.accessToken}`

		const res = await fetch(url.toString(), { method: 'GET', headers, signal })
		if (!res.ok) {
			throw new Error(`SSE http ${res.status}`)
		}
		if (!res.body) {
			throw new Error('SSE response has no body')
		}

		if (this.onStatusChange) {
			const now = Date.now()
			this.updateStatusAt(now, {
				state: 'online',
				stateMessage: 'SSE 已连接',
				connectedAt: now,
			})
		}

		const reader = res.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''
		let dataLines: string[] = []

		const flush = () => {
			if (dataLines.length === 0) return
			const raw = dataLines.join('\n')
			dataLines = []
			let json: unknown
			try {
				json = JSON.parse(raw)
			} catch {
				return
			}
			const parsed = Event.safeParse(json)
			if (!parsed.success) return

			if (this.onStatusChange) {
				const now = Date.now()
				this.updateStatusAt(now, { lastEventAt: now, lastEventType: parsed.data.event_type })
			}
			dispatchMilkyEvent(this.events, this, parsed.data)
		}

		while (!signal.aborted) {
			const { value, done } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })

			let idx: number
			while ((idx = buffer.indexOf('\n')) !== -1) {
				let line = buffer.slice(0, idx)
				buffer = buffer.slice(idx + 1)
				if (line.endsWith('\r')) line = line.slice(0, -1)

				if (line === '') {
					flush()
					continue
				}

				if (line.startsWith('data:')) {
					dataLines.push(line.slice(5).trimStart())
				}
			}
		}

		flush()
		throw new Error('SSE disconnected')
	}

	private async sleep(ms: number, signal?: AbortSignal) {
		if (!signal) return new Promise((r) => setTimeout(r, ms))
		return new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms)
			signal.addEventListener(
				'abort',
				() => {
					clearTimeout(timer)
					resolve()
				},
				{ once: true },
			)
		})
	}

}
