import type { HttpClient } from 'pluxel-plugin-wretch'
import * as milkySchemas from '@saltify/milky-types'
import type { MilkyApiEndpoint } from './definitions'
import { MILKY_API_PROTO } from './prototype'
import { createMilkyRequest } from './request'
import { createMilkyTools } from './tool'
import type { MilkyApi, MilkyApiCall, MilkyApiOptions, MilkyRawApi, SchemaPair } from './types'
import { milkyApiStructIndex } from './endpoints.source' with { type: 'macro' }

const pickSchema = (name: string | null | undefined) => {
	if (!name) return undefined
	const v = (milkySchemas as any)[name]
	return typeof v?.safeParse === 'function' ? v : undefined
}

const STRUCT_INDEX = milkyApiStructIndex() as unknown as Readonly<
	Record<MilkyApiEndpoint, { inputStruct: string | null; outputStruct: string | null }>
>

const schemaCache: Partial<Record<MilkyApiEndpoint, SchemaPair | null>> = Object.create(null)

function schemasFor(endpoint: MilkyApiEndpoint): SchemaPair | undefined {
	if (endpoint in schemaCache) return schemaCache[endpoint] ?? undefined
	const structs = STRUCT_INDEX[endpoint]
	const input = pickSchema(structs?.inputStruct)
	const output = pickSchema(structs?.outputStruct)
	const schemas = input || output ? ({ input, output } satisfies SchemaPair) : undefined
	schemaCache[endpoint] = schemas ?? null
	return schemas
}

export function createMilkyRawApi(http: HttpClient, options: MilkyApiOptions): MilkyRawApi {
	const request = createMilkyRequest(http, options.baseUrl, options.accessToken)

	const call: MilkyApiCall = (async (api: string, payload?: unknown) => {
		const schemas = Object.prototype.hasOwnProperty.call(STRUCT_INDEX, api)
			? schemasFor(api as MilkyApiEndpoint)
			: undefined
		return request(api, payload, schemas) as any
	}) as any

	return { call, request }
}

export function createMilkyApi(http: HttpClient, options: MilkyApiOptions): MilkyApi {
	const api = Object.create(MILKY_API_PROTO) as MilkyApi
	api.$raw = createMilkyRawApi(http, options)
	api.$tool = createMilkyTools(api)
	return api
}
