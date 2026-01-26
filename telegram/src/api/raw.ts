import type { HttpClient } from '@pluxel/wretch'
import { createTelegramRequest } from './core'
import type {
	ApiMethodName,
	HttpMethod,
	JsonLike,
	Result,
	TelegramApiOptions,
	TelegramBinaryLike,
	TelegramFileInput,
	TelegramInputFile,
	TelegramRawApi,
	TelegramRequest,
} from './types'
import { telegramApiDefinitions } from './definitions.source' with { type: 'macro' }

export type TelegramApiDefinition = readonly [ApiMethodName, HttpMethod]

const DEFAULT_DEFINITIONS = telegramApiDefinitions() as unknown as ReadonlyArray<TelegramApiDefinition>

const MULTIPART_FIELDS = new Map<string, string>([
	['sendPhoto', 'photo'],
	['sendDocument', 'document'],
	['sendAnimation', 'animation'],
	['setWebhook', 'certificate'],
])

export function createTelegramRawApi(http: HttpClient, options?: TelegramApiOptions): TelegramRawApi {
	const request = createTelegramRequest(http, options)
	return createTelegramRawApiFromRequest(request, DEFAULT_DEFINITIONS)
}

export function createTelegramRawApiFromRequest(
	request: TelegramRequest,
	definitions: ReadonlyArray<TelegramApiDefinition> = DEFAULT_DEFINITIONS,
): TelegramRawApi {
	const methodMap = new Map<string, HttpMethod>()
	for (const [name, method] of definitions) methodMap.set(name, method)

	const call = ((apiMethod: string, payload?: JsonLike) => {
		const httpMethod = methodMap.get(apiMethod) ?? 'POST'
		const coerced = httpMethod === 'POST' ? coerceTelegramMultipartPayload(apiMethod, payload) : payload
		return request(httpMethod, apiMethod, coerced)
	}) as TelegramRawApi['call']

	return { call, request }
}

export function coerceTelegramMultipartPayload(apiMethod: string, payload: JsonLike): JsonLike {
	if (!payload || typeof payload !== 'object') return payload
	if (payload instanceof FormData) return payload

	const key = MULTIPART_FIELDS.get(apiMethod)
	if (!key) return payload

	const record = payload as Record<string, unknown>
	const file = record[key] as TelegramInputFile | undefined
	if (!file) return payload
	if (typeof file === 'string') return payload

	return buildInputFilePayload(key, file, record)
}

function buildInputFilePayload(
	fieldName: string,
	inputFile: TelegramInputFile,
	payload: Record<string, unknown>,
): FormData {
	const fd = new FormData()

	for (const [k, v] of Object.entries(payload)) {
		if (v === undefined) continue
		if (k === fieldName) continue
		if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
			fd.append(k, String(v))
			continue
		}
		if (v instanceof Date) {
			fd.append(k, v.toISOString())
			continue
		}
		fd.append(k, JSON.stringify(v))
	}

	appendTelegramInputFile(fd, fieldName, inputFile)
	return fd
}

function appendTelegramInputFile(fd: FormData, fieldName: string, inputFile: TelegramInputFile) {
	if (typeof inputFile === 'string') {
		fd.append(fieldName, inputFile)
		return
	}

	const fileInput = isTelegramFileInput(inputFile) ? inputFile : { data: inputFile }
	const blob = toBlob(fileInput.data, fileInput.contentType)
	const filename = fileInput.filename ?? `${fieldName}.bin`
	fd.append(fieldName, blob, filename)
}

function isTelegramFileInput(x: TelegramInputFile): x is TelegramFileInput {
	return typeof x === 'object' && x !== null && 'data' in x
}

function toBlob(data: TelegramBinaryLike, contentType?: string): Blob {
	if (data instanceof Blob) return contentType ? data.slice(0, data.size, contentType) : data

	const toUint8Copy = (input: ArrayBufferView): Uint8Array<ArrayBuffer> => {
		const out: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(input.byteLength))
		out.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
		return out
	}

	if (isNodeBuffer(data)) {
		return new Blob([toUint8Copy(data)], { type: contentType ?? 'application/octet-stream' })
	}

	if (data instanceof ArrayBuffer) {
		return new Blob([data], { type: contentType ?? 'application/octet-stream' })
	}

	// ArrayBufferView
	return new Blob([toUint8Copy(data)], {
		type: contentType ?? 'application/octet-stream',
	})
}

function isNodeBuffer(x: unknown): x is Buffer {
	return typeof Buffer !== 'undefined' && x instanceof Buffer
}
