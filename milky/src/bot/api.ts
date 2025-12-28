import type { HttpClient } from 'pluxel-plugin-wretch'
import type { MilkyApi, MilkyApiOptions } from '../api'
import { createMilkyApi } from '../api'

export class AbstractBot {
	public readonly api: MilkyApi

	constructor(public readonly http: HttpClient, options: MilkyApiOptions) {
		this.api = createMilkyApi(http, options)
		Object.assign(this, this.api)
	}
}

/* biome-ignore lint/suspicious/noUnsafeDeclarationMerging: extend class shape with API methods */
export interface AbstractBot extends MilkyApi {}

export type { Result } from '../api'

