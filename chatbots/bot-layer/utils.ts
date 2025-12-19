import type { InlinePart, Part, Platform, MessageContent } from './types'
import { normalizeMessageContent } from './parts'
import { getAdapter } from './platforms/registry'
import { normalizePartsForAdapter } from './platforms/base'

// ============================================================================
// Part 转换工具
// ============================================================================

/** 将 MessageContent 规范化为 Part[] */
export const toPartArray = (content: MessageContent | undefined): Part[] => {
	return normalizeMessageContent(content)
}

/** 判断是否包含富媒体 Part */
const RICH_PART_TYPES = new Set<Part['type']>(['image', 'file', 'raw'])
export const hasRichParts = (parts: Part[]): boolean =>
	parts.some((part) => RICH_PART_TYPES.has(part.type))

/** 将 Part[] 转为平台特定的文本格式 */
export const partsToText = (parts: Part[], platform: Platform): string => {
	const adapter = getAdapter(platform)
	const normalized = normalizePartsForAdapter(parts, adapter as any)
	return adapter.render(normalized).text
}

// ============================================================================
// Part 构建工具（便捷函数）
// ============================================================================

export const text = (t: string): Part => ({ type: 'text', text: t })
export const mention = (kind: 'user' | 'role' | 'channel' | 'everyone', id?: string | number): Part =>
	({ type: 'mention', kind, id })
export const image = (url: string, alt?: string): Part => ({ type: 'image', url, alt })
export const file = (url: string, name?: string, mime?: string): Part => ({ type: 'file', url, name, mime })
export const link = (url: string, label?: string): Part => ({ type: 'link', url, label })
export const codeblock = (code: string, language?: string): Part => ({ type: 'codeblock', code, language })
export const bold = (...children: InlinePart[]): Part => ({ type: 'styled', style: 'bold', children })
export const italic = (...children: InlinePart[]): Part => ({ type: 'styled', style: 'italic', children })
export const code = (t: string): Part => ({ type: 'styled', style: 'code', children: [{ type: 'text', text: t }] })
export const strike = (...children: InlinePart[]): Part => ({ type: 'styled', style: 'strike', children })
export const raw = <P extends Platform>(platform: P, payload: unknown): Part => ({ type: 'raw', platform, payload })
