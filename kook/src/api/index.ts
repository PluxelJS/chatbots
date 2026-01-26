import type { HttpClient } from '@pluxel/wretch'
import type { KookApi, KookApiOptions } from './types'
import { createKookRawApi } from './raw'
import { KOOK_API_PROTO } from './prototype'
import { createKookTools } from './tool'
import { createKookRequest } from './core'

export function createKookApi(http: HttpClient, options?: KookApiOptions): KookApi {
	const api = Object.create(KOOK_API_PROTO) as KookApi
	api.$raw = createKookRawApi(http, options)
	api.$tool = createKookTools(api)
	return api
}

export { createKookRequest }
export * from './core'
export * from './prototype'
export * from './raw'
export * from './tool'
export * from './types'
