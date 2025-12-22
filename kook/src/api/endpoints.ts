import type { HttpMethod, KookAutoApi } from './types'
import { kookAutoEndpoints } from './endpoints.source' with { type: 'macro' }

export const AUTO_ENDPOINTS =
	kookAutoEndpoints() as unknown as [keyof KookAutoApi, HttpMethod, string][]
