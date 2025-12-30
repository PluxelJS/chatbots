import type { HttpClient } from 'pluxel-plugin-wretch'
import type { KookApi } from './types'
import type {
	HttpMethod,
	IBaseAPIResponse,
	JsonLike,
	KookApiOptions,
	KookAutoApi,
	KookRequest,
	RequestPayload,
	Result,
} from './types'
import { createKookRawApiFromRequest } from './raw'
import { KOOK_API_PROTO } from './prototype'
import { createKookTools } from './tool'

export type KookAutoEndpoint = readonly [keyof KookAutoApi, HttpMethod, string]

export function createKookApiWithEndpoints(
	http: HttpClient,
	options: KookApiOptions | undefined,
	autoEndpoints: ReadonlyArray<KookAutoEndpoint>,
): KookApi {
	const request = createKookRequest(http, options)
	const proto = Object.create(KOOK_API_PROTO) as Record<string, unknown>
	for (const [name] of autoEndpoints) {
		if (name in proto) continue
		Object.defineProperty(proto, name, {
			enumerable: true,
			value(payload?: unknown) {
				return this.$raw.call(name as any, payload)
			},
		})
	}

	const api = Object.create(proto) as KookApi
	api.$raw = createKookRawApiFromRequest(request, autoEndpoints as unknown as ReadonlyArray<[string, HttpMethod, string]>)
	api.$tool = createKookTools(api)
	return api
}

export function createKookRequest(http: HttpClient, options?: KookApiOptions): KookRequest {
	const prefix = options?.apiPrefix ?? '/api/v3'
	return <T>(method: HttpMethod, path: string, payload?: RequestPayload) =>
		requestWithClient<T>(http, prefix, method, path, payload)
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
