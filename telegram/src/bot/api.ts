import type { HttpClient } from '@pluxel/wretch'
import type { TelegramApi, TelegramApiOptions } from '../api'
import { createTelegramRawApi } from '../api/raw'
import { TELEGRAM_API_PROTO } from '../api/prototype'
import { createTelegramTools } from '../api/tool'

export class AbstractBot {
	public readonly $raw: TelegramApi['$raw']
	public readonly $tool: TelegramApi['$tool']

	constructor(public readonly http: HttpClient, options?: TelegramApiOptions) {
		this.$raw = createTelegramRawApi(http, options)
		this.$tool = createTelegramTools(this as unknown as TelegramApi)
	}
}

// Make api endpoints available on every bot instance via prototype chain.
Object.setPrototypeOf(AbstractBot.prototype, TELEGRAM_API_PROTO)

/* biome-ignore lint/suspicious/noUnsafeDeclarationMerging: extend class shape with API methods */
export interface AbstractBot extends TelegramApi {}

export type { HttpMethod, Ok, Err, Result } from '../api'
