import type { MilkyApiCall } from './types'
import type { MilkyApiEndpoint } from './definitions'
import { milkyApiEndpoints } from './endpoints.source' with { type: 'macro' }

const ENDPOINTS = milkyApiEndpoints() as unknown as ReadonlyArray<MilkyApiEndpoint>

export const MILKY_API_PROTO: Record<string, unknown> = Object.create(Object.prototype)

for (const endpoint of ENDPOINTS) {
	Object.defineProperty(MILKY_API_PROTO, endpoint, {
		enumerable: true,
		value(payload?: unknown) {
			return this.$raw.call(endpoint, payload) as ReturnType<MilkyApiCall>
		},
	})
}
