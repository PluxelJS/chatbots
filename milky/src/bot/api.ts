import type { HttpClient } from 'pluxel-plugin-wretch'
import type { MilkyApi, MilkyApiOptions } from '../api'
import { createMilkyRawApi } from '../api'
import { MILKY_API_PROTO } from '../api/prototype'
import { createMilkyTools } from '../api/tool'

export class AbstractBot {
	public readonly $raw: MilkyApi['$raw']
	public readonly $tool: MilkyApi['$tool']

	constructor(public readonly http: HttpClient, options: MilkyApiOptions) {
		this.$raw = createMilkyRawApi(http, options)
		this.$tool = createMilkyTools(this as unknown as MilkyApi)
	}
}

// Make api endpoints available on every bot instance via prototype chain.
Object.setPrototypeOf(AbstractBot.prototype, MILKY_API_PROTO)

/* biome-ignore lint/suspicious/noUnsafeDeclarationMerging: extend class shape with API methods */
export interface AbstractBot extends MilkyApi {}

export type { Result } from '../api'
