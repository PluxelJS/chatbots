import type { z } from 'zod'
import type { MilkyApiDefinitionByEndpoint, MilkyApiEndpoint } from './definitions'
import type { OutgoingSegment, SendGroupMessageOutput, SendPrivateMessageOutput } from '@saltify/milky-types'
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

export type MilkyApiArgs<E extends MilkyApiEndpoint> = MilkyApiInput<E> extends void
	? [payload?: EmptyInput]
	: {} extends MilkyApiInput<E>
		? [payload?: MilkyApiInput<E>]
		: [payload: MilkyApiInput<E>]

export type MilkyApiEndpointFn<E extends MilkyApiEndpoint> = (
	...args: MilkyApiArgs<E>
) => Promise<Result<MilkyApiOutput<E>>>

export type MilkyApiEndpoints = {
	[E in MilkyApiEndpoint]: MilkyApiEndpointFn<E>
}

export type MilkyApiCall = {
	// Typed call for known endpoints
	<E extends MilkyApiEndpoint>(
		api: E,
		...args: MilkyApiArgs<E>
	): Promise<Result<MilkyApiOutput<E>>>
	// Fallback for custom/unknown endpoints
	<T = unknown>(api: string, payload?: JsonLike): Promise<Result<T>>
}

export type MilkyRawApi = {
	/**
	 * Escape hatch for dynamic endpoints (or when you really want the string-based call).
	 * Prefer calling endpoints directly: `api.get_login_info()` etc.
	 */
	call: MilkyApiCall
	/** Lowest-level request fn (envelope + optional zod validation). */
	request: MilkyRequest
}

export type MilkyApiTools = {
	createGroupSession(groupId: number): MilkyGroupSession
	createPrivateSession(userId: number): MilkyPrivateSession
	createGroupMessageBuilder(groupId: number): MilkyGroupSession['send']
	createPrivateMessageBuilder(userId: number): MilkyPrivateSession['send']
}

export type MilkyApi = MilkyApiEndpoints & { $raw: MilkyRawApi; $tool: MilkyApiTools }

export type MilkyMessage = string | OutgoingSegment[] | OutgoingSegment

export type MilkyGroupSession = {
	readonly groupId: number
	readonly lastMessageSeq?: number
	send(message: MilkyMessage): Promise<Result<SendGroupMessageOutput>>
	reply(messageSeq: number, message: MilkyMessage): Promise<Result<SendGroupMessageOutput>>
	recall(messageSeq?: number): Promise<Result<void>>
	track(messageSeq?: number | null): number | undefined
}

export type MilkyPrivateSession = {
	readonly userId: number
	readonly lastMessageSeq?: number
	send(message: MilkyMessage): Promise<Result<SendPrivateMessageOutput>>
	reply(messageSeq: number, message: MilkyMessage): Promise<Result<SendPrivateMessageOutput>>
	recall(messageSeq?: number): Promise<Result<void>>
	track(messageSeq?: number | null): number | undefined
}
