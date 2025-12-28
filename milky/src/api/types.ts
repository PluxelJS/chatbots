import type { z } from 'zod'
import type { MilkyApiDefinitionByEndpoint, MilkyApiEndpoint } from './definitions'
import * as milkySchemas from '@saltify/milky-types'

export type { MilkyApiEndpoint } from './definitions'

export type HttpMethod = 'POST'
export type JsonLike = unknown

export type MilkyOk<T> = {
	ok: true
	data: T
	raw: unknown
}

export type MilkyErr = {
	ok: false
	retcode: number
	message: string
	status?: string
	raw: unknown
}

export type Result<T> = MilkyOk<T> | MilkyErr

export type SchemaPair = {
	input?: z.ZodTypeAny
	output?: z.ZodTypeAny
}

export type MilkyRequest = <T>(api: string, payload?: JsonLike, schemas?: SchemaPair) => Promise<Result<T>>

export type MilkyApiOptions = {
	baseUrl: string
	accessToken?: string
}

type StructName = keyof typeof milkySchemas

type InferInputByStructName<N extends StructName> = (typeof milkySchemas)[N] extends z.ZodTypeAny
	? z.input<(typeof milkySchemas)[N]>
	: never

type InferOutputByStructName<N extends StructName> = (typeof milkySchemas)[N] extends z.ZodTypeAny
	? z.output<(typeof milkySchemas)[N]>
	: never

type InputStruct<E extends MilkyApiEndpoint> = MilkyApiDefinitionByEndpoint<E>['inputStruct']
type OutputStruct<E extends MilkyApiEndpoint> = MilkyApiDefinitionByEndpoint<E>['outputStruct']

export type MilkyApiInput<E extends MilkyApiEndpoint> = InputStruct<E> extends StructName
	? InferInputByStructName<InputStruct<E>>
	: InputStruct<E> extends null
		? void
		: unknown

export type MilkyApiOutput<E extends MilkyApiEndpoint> = OutputStruct<E> extends StructName
	? InferOutputByStructName<OutputStruct<E>>
	: OutputStruct<E> extends null
		? void
		: unknown

type EmptyInput = Record<string, never>

export type MilkyApi = {
	// Typed call for known endpoints
	call<E extends MilkyApiEndpoint>(
		api: E,
		...args: MilkyApiInput<E> extends void
			? [payload?: EmptyInput]
			: {} extends MilkyApiInput<E>
				? [payload?: MilkyApiInput<E>]
			: [payload: MilkyApiInput<E>]
	): Promise<Result<MilkyApiOutput<E>>>
	// Fallback for custom/unknown endpoints
	call<T = unknown>(api: string, payload?: JsonLike): Promise<Result<T>>
}
