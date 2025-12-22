import type { HttpClient } from 'pluxel-plugin-wretch'
import type * as Kook from '../types'
import { MessageType } from '../types'
import type {
	HttpMethod,
	IBaseAPIResponse,
	JsonLike,
	KookApi,
	KookApiOptions,
	KookAutoApi,
	KookConversation,
	KookRequest,
	ManualKookApi,
	RequestPayload,
	Result,
} from './types'

export type KookAutoEndpoint = readonly [keyof KookAutoApi, HttpMethod, string]

export function createKookApiWithEndpoints(
	http: HttpClient,
	options: KookApiOptions | undefined,
	autoEndpoints: ReadonlyArray<KookAutoEndpoint>,
): KookApi {
	const request = createKookRequest(http, options)
	return buildKookApi(request, autoEndpoints)
}

export function createKookRequest(http: HttpClient, options?: KookApiOptions): KookRequest {
	const prefix = options?.apiPrefix ?? '/api/v3'
	return <T>(method: HttpMethod, path: string, payload?: RequestPayload) =>
		requestWithClient<T>(http, prefix, method, path, payload)
}

function buildKookApi(request: KookRequest, autoEndpoints: ReadonlyArray<KookAutoEndpoint>): KookApi {
	const api: Partial<ManualKookApi & KookAutoApi> = {
		sendMessage: (target_id, content, options) => {
			const o = options
			return request('POST', '/message/create', {
				json: {
					target_id,
					content,
					type: o?.type,
					temp_target_id: o?.temp_target_id,
					quote: o?.quote,
					template_id: o?.template_id,
				},
			})
		},

		createTempMessageBuilder: (target_id, user_id, builderOptions) =>
			makeConversation(request, target_id, { ...builderOptions, temp_target_id: user_id }).send,

		createMessageBuilder: (target_id, builderOptions) =>
			makeConversation(request, target_id, builderOptions).send,

		createConversation: (target_id, builderOptions) => makeConversation(request, target_id, builderOptions),

		updateMessage: (msg_id, content, options) => {
			const o = options
			return request<void>('POST', '/message/update', {
				json: {
					msg_id,
					content,
					type: o?.type,
					temp_target_id: o?.temp_target_id,
					quote: o?.quote,
					template_id: o?.template_id,
				},
			})
		},

		deleteMessage: (msg_id) => request<void>('POST', '/message/delete', { json: { msg_id } }),

		createAsset: (file, name = 'asset') =>
			request<{ url: string }>('POST', '/asset/create', { body: toFormData(file, name) }).then(
				(r) => (r.ok ? { ok: true, data: r.data.url } : r),
			),
	}

	const define = defineResult(api, request)

	for (const [name, method, path] of autoEndpoints) {
		define(name, method, path)
	}

	return api as KookApi
}

/* ----------------------------- Helpers ----------------------------- */

type JsonChain = { json(): Promise<unknown> }
type RequestBuilder = {
	get(): JsonChain
	delete(): JsonChain
	head(): JsonChain
	opts(): JsonChain
	post(b?: BodyInit | JsonLike): JsonChain
	put(b?: BodyInit | JsonLike): JsonChain
	patch(b?: BodyInit | JsonLike): JsonChain
}

function requestWithClient<T>(
	http: HttpClient,
	apiPrefix: string,
	method: HttpMethod,
	path: string,
	payload?: RequestPayload,
): Promise<Result<T>> {
	const sp = cleanParams(payload?.searchParams)
	const url = sp ? appendQuery(apiPrefix + path, sp) : apiPrefix + path

	const req = (http as any).url ? ((http as any).url(url) as RequestBuilder) : ((http as any) as RequestBuilder)
	const body = payload?.body ?? payload?.json

	let rc: JsonChain | null = null
	switch (method) {
		case 'GET':
			rc = req.get()
			break
		case 'DELETE':
			rc = req.delete()
			break
		case 'POST':
			rc = req.post(body)
			break
		case 'PUT':
			rc = req.put(body)
			break
		case 'PATCH':
			rc = req.patch(body)
			break
		case 'HEAD':
			rc = req.head()
			break
		case 'OPTIONS':
			rc = req.opts()
			break
		default:
			rc = null
	}
	if (!rc) return Promise.resolve({ ok: false, code: -400, message: 'Unsupported HTTP method' })

	return rc
		.json()
		.then((raw) => {
			const res = raw as unknown as IBaseAPIResponse<T>
			return res.code === 0
				? { ok: true, data: res.data }
				: { ok: false, code: res.code, message: res.message || 'Unexpected Error' }
		})
		.catch((e: unknown) => ({ ok: false, code: normalizeErrCode(e), message: normalizeErrMsg(e) })) as Promise<
		Result<T>
	>
}

function defineResult(target: Record<string, unknown>, request: KookRequest) {
	return (name: keyof KookAutoApi, method: HttpMethod, path: string) => {
		const isQuery = method === 'GET' || method === 'DELETE'
		target[name as string] = (arg?: unknown) =>
			request(
				method,
				path,
				isQuery
					? arg
						? { searchParams: arg as Record<string, unknown> }
						: undefined
					: { json: arg as JsonLike },
			)
	}
}

function appendQuery(path: string, params: Record<string, unknown>): string {
	const search = new URLSearchParams()
	let has = false
	for (const k in params) {
		const v = (params as Record<string, unknown>)[k]
		if (v === undefined || v === null) continue
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) {
				search.append(k, serializeQueryValue(v[i]))
				has = true
			}
		} else {
			search.append(k, serializeQueryValue(v))
			has = true
		}
	}
	if (!has) return path
	return path + (path.includes('?') ? '&' : '?') + search.toString()
}

function serializeQueryValue(value: unknown): string {
	if (value == null) return ''
	if (value instanceof Date) return value.toISOString()
	return String(value)
}

function cleanParams(obj: Record<string, unknown> | undefined) {
	if (!obj) return undefined
	let has = false
	const out: Record<string, unknown> = {}
	for (const k in obj) {
		const v = obj[k]
		if (v === undefined) continue
		out[k] = v
		has = true
	}
	return has ? out : undefined
}

function toFormData(file: Buffer | Blob | string | FormData, name: string): FormData {
	if (typeof file === 'string') {
		const u8 =
			typeof Buffer !== 'undefined'
				? Buffer.from(file, 'base64') // Node
				: Uint8Array.from(atob(file), (c) => c.charCodeAt(0)) // Browser
		const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
		const fd = new FormData()
		fd.append('file', new Blob([ab], { type: 'application/octet-stream' }), name)
		return fd
	}

	if (isNodeBuffer(file)) {
		const u8 = new Uint8Array(file.buffer, file.byteOffset, file.byteLength)
		const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
		const fd = new FormData()
		fd.append('file', new Blob([ab], { type: 'application/octet-stream' }), name)
		return fd
	}

	if (file instanceof Blob) {
		const fd = new FormData()
		fd.append('file', file, name)
		return fd
	}

	return file
}

function isNodeBuffer(x: unknown): x is Buffer {
	return typeof Buffer !== 'undefined' && x instanceof Buffer
}

export function normalizeErrCode(e: unknown): number {
	const status = (e as { status?: unknown })?.status
	return typeof status === 'number' ? status : -1
}

export function normalizeErrMsg(e: unknown): string {
	if (!e) return 'Network Error'
	if (typeof e === 'string') return e
	if (e instanceof Error && e.message) return e.message
	const m = e as { message?: unknown; statusText?: unknown }
	if (typeof m.message === 'string') return m.message
	if (typeof m.statusText === 'string') return m.statusText
	return 'Network Error'
}

function makeConversation(
	request: KookRequest,
	target_id: string,
	base?: { type?: Kook.MessageType; quote?: string; template_id?: string; temp_target_id?: string },
): KookConversation {
	const defaults = base ? Object.freeze({ ...base }) : undefined
	let trackedId: string | undefined

	const send: KookConversation['send'] = async (content, options) => {
		const res = await request<Kook.MessageReturn>('POST', '/message/create', {
			json: {
				target_id,
				content,
				type: options?.type ?? defaults?.type,
				quote: options?.quote ?? defaults?.quote,
				template_id: options?.template_id ?? defaults?.template_id,
				temp_target_id: options?.temp_target_id ?? defaults?.temp_target_id,
			},
		})
		if (res.ok && res.data?.msg_id) {
			trackedId = res.data.msg_id
		}
		return res
	}

	const reply: KookConversation['reply'] = async (quote, content, options) => {
		const res = await request<Kook.MessageReturn>('POST', '/message/create', {
			json: {
				target_id,
				content,
				quote,
				type: options?.type ?? defaults?.type,
				template_id: options?.template_id ?? defaults?.template_id,
				temp_target_id: options?.temp_target_id ?? defaults?.temp_target_id,
			},
		})
		if (res.ok && res.data?.msg_id) {
			trackedId = res.data.msg_id
		}
		return res
	}

	const edit: KookConversation['edit'] = (msg_id, content, options) =>
		request<void>('POST', '/message/update', {
			json: {
				msg_id,
				content,
				type: options?.type,
				quote: options?.quote ?? defaults?.quote,
				template_id: options?.template_id ?? defaults?.template_id,
				temp_target_id: options?.temp_target_id ?? defaults?.temp_target_id,
			},
		})

	const deleteMessage: KookConversation['delete'] = (msg_id) =>
		request<void>('POST', '/message/delete', { json: { msg_id } })

	const editTracked: KookConversation['editTracked'] = (content, options) => {
		if (!trackedId) return missingTracked()
		return edit(trackedId, content, options)
	}

	const deleteTracked: KookConversation['deleteTracked'] = () => {
		if (!trackedId) return missingTracked()
		return deleteMessage(trackedId)
	}

	const upsert: KookConversation['upsert'] = async (content, options) => {
		if (trackedId) {
			const editOptions = options
				? {
						type:
							options.type === MessageType.kmarkdown || options.type === MessageType.card
								? options.type
								: undefined,
						quote: options.quote,
						template_id: options.template_id,
						temp_target_id: options.temp_target_id,
					}
				: undefined

			const res = await edit(trackedId, content, editOptions)
			if (res.ok) return res
			trackedId = undefined
		}
		return send(content, options)
	}

	const transient: KookConversation['transient'] = async (content, options, ttlMs = 5000) => {
		const res = await send(content, options)
		const msgId = res.ok ? res.data?.msg_id : undefined
		if (res.ok && msgId && ttlMs > 0) {
			scheduleDelete(() => deleteMessage(msgId), ttlMs)
		}
		return res
	}

	const track: KookConversation['track'] = (msg_id) => {
		trackedId = typeof msg_id === 'string' && msg_id ? msg_id : undefined
		return trackedId
	}

	const withDefaults: KookConversation['withDefaults'] = (overrides) => {
		const next = makeConversation(request, target_id, { ...defaults, ...overrides })
		if (trackedId) next.track(trackedId)
		return next
	}

	return {
		target_id,
		defaults,
		get lastMessageId() {
			return trackedId
		},
		send,
		reply,
		edit,
		editTracked,
		delete: deleteMessage,
		deleteTracked,
		upsert,
		transient,
		track,
		withDefaults,
	}
}

function missingTracked(): Promise<Result<void>> {
	return Promise.resolve({ ok: false, code: -404, message: 'No tracked message to operate on' } as Result<void>)
}

function scheduleDelete(task: () => Promise<unknown>, ttlMs: number) {
	const timer = setTimeout(() => {
		void task().catch(() => {})
	}, ttlMs)
	;(timer as any).unref?.()
}

