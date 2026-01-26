import type { HttpClient } from '@pluxel/wretch'
import type { TelegramApi, TelegramApiOptions } from './types'
import { createTelegramRequest } from './core'
import { createTelegramRawApi } from './raw'
import { TELEGRAM_API_PROTO } from './prototype'
import { createTelegramTools } from './tool'

export function createTelegramApi(http: HttpClient, options?: TelegramApiOptions): TelegramApi {
	const api = Object.create(TELEGRAM_API_PROTO) as TelegramApi
	api.$raw = createTelegramRawApi(http, options)
	api.$tool = createTelegramTools(api)
	return api
}

export { createTelegramRequest }
export * from './core'
export * from './prototype'
export * from './tool'
export * from './types'
