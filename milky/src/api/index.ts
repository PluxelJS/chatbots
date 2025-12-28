import type { HttpClient } from 'pluxel-plugin-wretch'
import * as milkySchemas from '@saltify/milky-types'
import { createMilkyRequest } from './core'
import { MILKY_API_DEFINITIONS } from './definitions'
import type { MilkyApi, MilkyApiOptions } from './types'

const apiIndex: ReadonlyMap<
	string,
	{ inputStruct: string | null; outputStruct: string | null; description: string }
> = new Map(
	MILKY_API_DEFINITIONS.map((d) => [
		d.endpoint,
		{ inputStruct: d.inputStruct, outputStruct: d.outputStruct, description: d.description },
	] as const),
)

const pickSchema = (name: string | null | undefined) => {
	if (!name) return undefined
	const v = (milkySchemas as any)[name]
	return typeof v?.safeParse === 'function' ? v : undefined
}

export function createMilkyApi(http: HttpClient, options: MilkyApiOptions): MilkyApi {
	const request = createMilkyRequest(http, options.baseUrl, options.accessToken)

	const call: any = async <T = unknown>(api: string, payload?: unknown) => {
		const def = apiIndex.get(api)
		const schemas = def
			? { input: pickSchema(def.inputStruct), output: pickSchema(def.outputStruct) }
			: undefined
		return request<T>(api, payload, schemas)
	}

	return { call } as MilkyApi
}

export * from './types'
export * from './definitions'
