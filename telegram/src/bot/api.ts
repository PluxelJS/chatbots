import type { HttpClient } from 'pluxel-plugin-wretch'
import type { TelegramApiOptions, TelegramApi } from '../api'
import { createTelegramApi } from '../api'

export class AbstractBot {
	public readonly api: TelegramApi

	constructor(public readonly http: HttpClient, options?: TelegramApiOptions) {
		this.api = createTelegramApi(http, options)
		// Expose api methods directly on the bot instance for ergonomic calls.
		Object.assign(this, this.api)
	}
}

/* biome-ignore lint/suspicious/noUnsafeDeclarationMerging: extend class shape with API methods */
export interface AbstractBot extends TelegramApi {}

export type { HttpMethod, Ok, Err, Result } from '../api'
