import type { FilePart, ImagePart, InlinePart, Part, Platform } from '../types'
import type { PlatformAdapter } from '../platforms/adapter'

export type TextLikePart = Exclude<Part, ImagePart | FilePart>

export const isTextLike = (part: Part): part is TextLikePart => part.type !== 'image' && part.type !== 'file'

export const assertTextOnly = (parts: Part[], label: string) => {
	const bad = parts.find((p) => !isTextLike(p))
	if (!bad) return
	throw new Error(`bot-layer: ${label} 只允许文本类 Part，发现: ${bad.type}`)
}

const inlineToText = (parts: InlinePart[]): string =>
	parts
		.map((p) => {
			if (p.type === 'text') return p.text
			if (p.type === 'styled') return inlineToText(p.children)
			if (p.type === 'mention') return `@${p.id ?? p.kind}`
			if (p.type === 'link') return p.label ? `${p.label} (${p.url})` : p.url
			return ''
		})
		.join('')

const normalizeInlineForAdapter = <P extends Platform>(
	parts: InlinePart[],
	adapter: PlatformAdapter<P>,
): InlinePart[] => {
	const { capabilities } = adapter

	return parts
		.map<InlinePart | null>((part) => {
			switch (part.type) {
				case 'styled': {
					const children = normalizeInlineForAdapter(part.children, adapter)
					if (capabilities.format === 'plain') {
						return children.length ? { type: 'text', text: inlineToText(children) } : null
					}
					return { ...part, children }
				}
				case 'mention': {
					const support = capabilities.supportsInlineMention[part.kind] ?? false
					if (!support) return { type: 'text', text: `@${part.id ?? part.kind}` }
					return part
				}
				case 'link': {
					if (capabilities.format === 'plain') {
						return { type: 'text', text: part.label ? `${part.label} (${part.url})` : part.url }
					}
					return part
				}
				default:
					return part
			}
		})
		.filter((p): p is InlinePart => Boolean(p))
}

export const normalizeTextPartsForAdapter = <P extends Platform>(
	parts: TextLikePart[],
	adapter: PlatformAdapter<P>,
): TextLikePart[] => {
	const { capabilities } = adapter

	return parts
		.map<TextLikePart | null>((part) => {
			switch (part.type) {
				case 'styled': {
					const children = normalizeInlineForAdapter(part.children, adapter)
					if (capabilities.format === 'plain') {
						return children.length ? { type: 'text', text: inlineToText(children) } : null
					}
					return { ...part, children }
				}
				case 'mention': {
					const support = capabilities.supportsInlineMention[part.kind] ?? false
					if (!support) return { type: 'text', text: `@${part.id ?? part.kind}` }
					return part
				}
				case 'link': {
					if (capabilities.format === 'plain') {
						return { type: 'text', text: part.label ? `${part.label} (${part.url})` : part.url }
					}
					return part
				}
				case 'codeblock': {
					if (capabilities.format === 'plain') {
						return { type: 'text', text: part.code }
					}
					return part
				}
				default:
					return part
			}
		})
		.filter((p): p is TextLikePart => Boolean(p))
}

export const imageToText = (part: ImagePart): string => part.alt || part.url || '[image]'
export const fileToText = (part: FilePart): string => part.name || part.url || '[file]'

/**
 * 将任意 `Part[]` 归一化为“可渲染为文本”的 Part[]：
 * - 文本类 Part 会根据 format/mention 支持做降级
 * - image/file 会退化为可读文本（alt/url/name）
 */
export const normalizePartsForAdapter = <P extends Platform>(
	parts: Part[],
	adapter: PlatformAdapter<P>,
): TextLikePart[] => {
	const normalized: TextLikePart[] = []
	for (const part of parts) {
		if (part.type === 'image') {
			normalized.push({ type: 'text', text: imageToText(part) })
			continue
		}
		if (part.type === 'file') {
			normalized.push({ type: 'text', text: fileToText(part) })
			continue
		}
		normalized.push(part)
	}
	return normalizeTextPartsForAdapter(normalized, adapter)
}

