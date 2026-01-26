import type { HttpClient } from '@pluxel/wretch'
import { AUTO_ENDPOINTS } from './endpoints'
import { createKookRequest } from './core'
import type { HttpMethod, JsonLike, KookApiOptions, KookAutoApi, KookRequest } from './types'

type EndpointMeta = {
	method: HttpMethod
	path: string
	isQuery: boolean
}

function buildEndpointMeta(endpoints: ReadonlyArray<readonly [string, HttpMethod, string]>) {
	const map = new Map<string, EndpointMeta>()
	for (const [name, method, path] of endpoints) {
		map.set(name, {
			method,
			path,
			isQuery: method === 'GET' || method === 'DELETE',
		})
	}
	return map
}

export type KookRawApi = {
	request: KookRequest
	call<K extends keyof KookAutoApi>(endpoint: K, payload?: unknown): ReturnType<KookAutoApi[K]>
}

export function createKookRawApi(http: HttpClient, options?: KookApiOptions): KookRawApi {
	const request = createKookRequest(http, options)
	return createKookRawApiFromRequest(request, AUTO_ENDPOINTS as unknown as ReadonlyArray<readonly [string, HttpMethod, string]>)
}

export function createKookRawApiFromRequest(
	request: KookRequest,
	endpoints: ReadonlyArray<readonly [string, HttpMethod, string]> = AUTO_ENDPOINTS as unknown as ReadonlyArray<
		readonly [string, HttpMethod, string]
	>,
): KookRawApi {
	const endpointMeta = buildEndpointMeta(endpoints)

	return {
		request,
		call(endpoint, payload) {
			const meta = endpointMeta.get(endpoint as string)
			return request(
				(meta as EndpointMeta).method,
				(meta as EndpointMeta).path,
				(meta as EndpointMeta).isQuery
					? payload
						? { searchParams: payload as Record<string, unknown> }
						: undefined
					: isBodyPayload(payload)
						? { body: payload as BodyInit }
						: { json: payload as JsonLike },
			) as ReturnType<KookAutoApi[typeof endpoint]>
		},
	}
}

function isBodyPayload(payload: unknown): payload is BodyInit {
	if (!payload) return false
	if (typeof payload === 'string') return true
	if (payload instanceof FormData) return true
	if (payload instanceof Blob) return true
	if (payload instanceof URLSearchParams) return true
	if (payload instanceof ArrayBuffer) return true
	if (ArrayBuffer.isView(payload)) return true
	return typeof Buffer !== 'undefined' && payload instanceof Buffer
}
