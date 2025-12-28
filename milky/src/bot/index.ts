import type { Context } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { Event } from '@saltify/milky-types'
import type { MilkyChannel } from '../events'
import { dispatchMilkyEvent } from '../events/dispatcher'
import type { MilkyEventTransport } from '../config'
import { createInitialStatus, type MilkyBotStatus } from '../status'
import { AbstractBot } from './api'
import { maskSecret } from '../utils'

export type MilkyBotConfig = {
	baseUrl: string
	accessToken?: string
	transport: MilkyEventTransport
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const

export class MilkyBot extends AbstractBot {
	public readonly baseUrl: string
	public readonly transport: MilkyEventTransport
	public readonly instanceId: string

	private abort?: AbortController
	private running = false
	private stopRequested = false
	private status: MilkyBotStatus
	private readonly onStatusChange?: (status: MilkyBotStatus) => void
	private ws: WebSocket | null = null

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
		this.transport = config.transport
		this.instanceId = `milky-${++MilkyBot.seq}`
		this.onStatusChange = onStatusChange
		const preview = config.accessToken ? maskSecret(config.accessToken) : '—'
		this.status = createInitialStatus(this.instanceId, this.baseUrl, preview, this.transport)
	}

	private updateStatus(patch: Partial<MilkyBotStatus>) {
		this.status = { ...this.status, ...patch, updatedAt: Date.now() }
		this.onStatusChange?.(this.status)
	}

	getStatusSnapshot(): MilkyBotStatus {
		return { ...this.status }
	}

	async start(): Promise<void> {
		this.stopRequested = false
		this.updateStatus({ state: 'connecting', stateMessage: '初始化中', lastError: undefined })

		const impl = await this.call('get_impl_info')
		if (impl.ok) {
			this.updateStatus({
				implName: impl.data.impl_name,
				implVersion: impl.data.impl_version,
				qqProtocolType: impl.data.qq_protocol_type,
				qqProtocolVersion: impl.data.qq_protocol_version,
				milkyVersion: impl.data.milky_version,
			})
		}

		const login = await this.call('get_login_info')
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

	async stop(): Promise<void> {
		this.stopRequested = true
		this.running = false
		this.abort?.abort()
		this.abort = undefined

		if (this.ws) {
			try {
				this.ws.close(1000, 'stop')
			} catch {}
			this.ws = null
		}

		this.updateStatus({ state: 'stopped', stateMessage: '已断开' })
	}

	private async startEventLoop(): Promise<void> {
		if (this.running) return
		this.running = true
		this.abort = new AbortController()

		const cleanup = () => this.stop().catch(() => {})
		this.ctx.scope.collectEffect(cleanup)

		void this.eventLoop(this.abort.signal).catch((e) => {
			this.updateStatus({
				state: 'error',
				stateMessage: '事件循环异常',
				lastError: e instanceof Error ? e.message : String(e),
			})
			this.ctx.logger.error(e, '[Milky] event loop crashed')
		})
	}

	private async eventLoop(signal: AbortSignal): Promise<void> {
		let backoffIndex = 0

		while (!signal.aborted && this.running) {
			try {
				this.updateStatus({
					state: 'connecting',
					stateMessage: `连接事件流（${this.transport.toUpperCase()}）`,
					lastError: undefined,
				})

				if (this.transport === 'ws') {
					await this.connectWsOnce(signal)
				} else {
					await this.connectSseOnce(signal)
				}
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

		this.updateStatus({
			state: 'online',
			stateMessage: 'SSE 已连接',
			connectedAt: Date.now(),
		})

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

			this.updateStatus({ lastEventAt: Date.now(), stateMessage: parsed.data.event_type })
			dispatchMilkyEvent(this.events, this.ctx, this, parsed.data, {
				receivedAt: Date.now(),
				source: 'sse',
			})
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

	private async connectWsOnce(signal: AbortSignal): Promise<void> {
		const url = new URL(this.baseUrl)
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
		url.pathname = `${url.pathname.replace(/\/+$/, '')}/event`
		if (this.config.accessToken) url.searchParams.set('access_token', this.config.accessToken)

		const ws = new WebSocket(url.toString())
		this.ws = ws

		await new Promise<void>((resolve, reject) => {
			const onOpen = () => resolve()
			const onErr = () => reject(new Error('WebSocket error'))
			ws.addEventListener('open', onOpen, { once: true })
			ws.addEventListener('error', onErr, { once: true })
		})

		this.updateStatus({
			state: 'online',
			stateMessage: 'WebSocket 已连接',
			connectedAt: Date.now(),
		})

		await new Promise<void>((resolve, reject) => {
			const onMessage = (ev: MessageEvent) => {
				const data = ev.data
				const text =
					typeof data === 'string'
						? data
						: data instanceof ArrayBuffer
							? Buffer.from(data).toString('utf8')
							: ''
				if (!text) return
				let json: unknown
				try {
					json = JSON.parse(text)
				} catch {
					return
				}
				const parsed = Event.safeParse(json)
				if (!parsed.success) return

				this.updateStatus({ lastEventAt: Date.now(), stateMessage: parsed.data.event_type })
				dispatchMilkyEvent(this.events, this.ctx, this, parsed.data, {
					receivedAt: Date.now(),
					source: 'ws',
				})
			}

			const onClose = () => resolve()
			const onError = () => reject(new Error('WebSocket error'))

			ws.addEventListener('message', onMessage)
			ws.addEventListener('close', onClose, { once: true })
			ws.addEventListener('error', onError, { once: true })

			const abortHandler = () => {
				try {
					ws.close(1000, 'abort')
				} catch {}
			}

			if (signal.aborted) abortHandler()
			signal.addEventListener('abort', abortHandler, { once: true })
		})

		throw new Error('WebSocket disconnected')
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
