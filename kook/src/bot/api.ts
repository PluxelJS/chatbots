import type { HttpClient } from 'pluxel-plugin-wretch'
import type { KookApi, KookApiOptions } from '../api'
import { createKookRawApi } from '../api/raw'
import { KOOK_API_PROTO } from '../api/prototype'
import { createKookTools } from '../api/tool'

export class AbstractBot {
	public readonly $raw: KookApi['$raw']
	public readonly $tool: KookApi['$tool']

	constructor(public readonly http: HttpClient, options?: KookApiOptions) {
		this.$raw = createKookRawApi(http, options)
		this.$tool = createKookTools(this as unknown as KookApi)
	}
}

// Make api endpoints available on every bot instance via prototype chain.
Object.setPrototypeOf(AbstractBot.prototype, KOOK_API_PROTO)

/* biome-ignore lint/suspicious/noUnsafeDeclarationMerging: extend class shape with API methods */
export interface AbstractBot extends KookApi {}

export type { HttpMethod, Ok, Err, Result } from '../api'
