import type { HttpClient } from 'pluxel-plugin-wretch'
import type {
	ApiMethodName,
	HttpMethod,
	JsonLike,
	Result,
	TelegramApi,
	TelegramApiOptions,
	TelegramRequest,
} from './types'
import { createTelegramRawApiFromRequest } from './raw'
import { TELEGRAM_API_PROTO } from './prototype'
import { createTelegramTools } from './tool'

export type TelegramApiDefinition = readonly [ApiMethodName, HttpMethod]

export function createTelegramApiWithDefinitions(
	http: HttpClient,
	options: TelegramApiOptions | undefined,
	definitions: ReadonlyArray<TelegramApiDefinition>,
): TelegramApi {
	const request = createTelegramRequest(http, options)

	const proto = Object.create(TELEGRAM_API_PROTO) as Record<string, unknown>
	for (const [name] of definitions) {
		if (name in proto) continue
		Object.defineProperty(proto, name, {
			enumerable: true,
			value(payload?: unknown) {
				return this.$raw.call(name as any, payload)
			},
		})
	}

	const api = Object.create(proto) as TelegramApi
	api.$raw = createTelegramRawApiFromRequest(request, definitions)
	api.$tool = createTelegramTools(api)
	return api
}

export function createTelegramRequest(http: HttpClient, options?: TelegramApiOptions): TelegramRequest {
	const apiBase = (options?.apiBase ?? 'https://api.telegram.org').trim() || 'https://api.telegram.org'
	const baseWithToken =
		(options?.token != null
			? `${apiBase.replace(/\/+$/, '')}/bot${options.token}`
			: apiBase.replace(/\/+$/, '')) + '/'

	return <T>(method: HttpMethod, apiMethod: string, payload?: JsonLike) => {
		const path = apiMethod.replace(/^\/+/, '')
		const url = `${baseWithToken}${path}`
		return requestWithClient<T>(http, method, url, payload)
	}
}
/* ----------------------------- Helpers ----------------------------- */

type JsonChain = { json(): Promise<unknown> }
type RequestBuilder = {
	get(): JsonChain
	post(b?: BodyInit | JsonLike): JsonChain
}

interface TelegramResponse<T> {
	ok: boolean
	result?: T
	description?: string
	error_code?: number
}

function requestWithClient<T>(
	http: HttpClient,
	method: HttpMethod,
	apiMethod: string,
	payload?: JsonLike,
): Promise<Result<T>> {
	const url =
		method === 'GET' && isPlainObject(payload)
			? appendQuery(apiMethod, payload as Record<string, unknown>)
			: apiMethod
	const req = (http as any).url ? ((http as any).url(url) as RequestBuilder) : ((http as any) as RequestBuilder)

	let rc: JsonChain
	if (method === 'GET') {
		rc = req.get()
	} else {
		rc = req.post(payload)
	}

	return rc
		.json()
		.then((raw) => {
			const res = raw as TelegramResponse<T>
			return res.ok && res.result !== undefined
				? { ok: true, data: res.result }
				: { ok: false, code: res.error_code ?? -1, message: res.description || 'Unexpected Error' }
		})
		.catch((e: unknown) => ({
			ok: false,
			code: normalizeErrCode(e),
			message: normalizeErrMsg(e),
		})) as Promise<Result<T>>
}

function appendQuery(path: string, params: Record<string, unknown>): string {
	const search = new URLSearchParams()
	let has = false
	for (const k in params) {
		const v = params[k]
		if (v === undefined || v === null) continue
		if (Array.isArray(v)) {
			for (const item of v) {
				search.append(k, String(item))
			}
		} else {
			search.append(k, String(v))
		}
		has = true
	}
	if (!has) return path
	return path + (path.includes('?') ? '&' : '?') + search.toString()
}

function isPlainObject(value: JsonLike): value is Record<string, unknown> {
	if (!value || typeof value !== 'object') return false
	return !(value instanceof FormData)
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
