import type { HttpClient } from 'pluxel-plugin-wretch'
import type { TelegramApi, TelegramApiOptions } from './types'
import { createTelegramApiWithDefinitions, createTelegramRequest } from './core'
import type { TelegramApiDefinition } from './core'
import { telegramApiDefinitions } from './definitions.source' with { type: 'macro' }

export function createTelegramApi(http: HttpClient, options?: TelegramApiOptions): TelegramApi {
	return createTelegramApiWithDefinitions(
		http,
		options,
		telegramApiDefinitions() as unknown as TelegramApiDefinition[],
	)
}

export { createTelegramRequest }
export * from './core'
export * from './types'
