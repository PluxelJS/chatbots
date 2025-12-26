import type { Part, Platform } from '../types'
import { getAdapter } from '../platforms/registry'
import { normalizePartsForAdapter } from './normalize'

export const partsToText = (parts: Part[], platform: Platform): string => {
	const adapter = getAdapter(platform)
	const normalized = normalizePartsForAdapter(parts, adapter)
	return adapter.render(normalized).text
}

