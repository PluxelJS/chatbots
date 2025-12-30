import { AUTO_ENDPOINTS } from './endpoints'
import type { HttpMethod, JsonLike, RequestPayload } from './types'

export const KOOK_API_PROTO: Record<string, unknown> = Object.create(Object.prototype)

for (const [name, method, path] of AUTO_ENDPOINTS as unknown as ReadonlyArray<[string, HttpMethod, string]>) {
	Object.defineProperty(KOOK_API_PROTO, name, {
		enumerable: true,
		value(payload?: unknown) {
			const isQuery = (method as HttpMethod) === 'GET' || (method as HttpMethod) === 'DELETE'
			const reqPayload: RequestPayload | undefined = isQuery
				? payload
					? { searchParams: payload as Record<string, unknown> }
					: undefined
				: isBodyPayload(payload)
					? { body: payload as BodyInit }
					: { json: payload as JsonLike }

			return this.$raw.request(method as HttpMethod, path, reqPayload)
		},
	})
}

function isBodyPayload(payload: unknown): payload is BodyInit {
	if (!payload) return false
	if (typeof payload === 'string') return true
	if (payload instanceof FormData) return true
	if (payload instanceof Blob) return true
	if (payload instanceof URLSearchParams) return true
	if (payload instanceof ArrayBuffer) return true
	if (ArrayBuffer.isView(payload)) return true
	return typeof Buffer !== 'undefined' && payload instanceof Buffer
}
