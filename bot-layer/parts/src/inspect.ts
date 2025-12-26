import type { Part } from './model'

const RICH_PART_TYPES = new Set<Part['type']>(['image', 'file'])

export const hasRichParts = (parts: Part[]): boolean => parts.some((part) => RICH_PART_TYPES.has(part.type))
