import type { AudioPart, FilePart, ImagePart, InlinePart, MediaPart, MentionPart, Part, Platform, VideoPart } from '../types'
import type { PlatformAdapter } from '../adapter'

export type TextLikePart = Exclude<Part, MediaPart>

export const isTextLike = (part: Part): part is TextLikePart =>
	part.type !== 'image' && part.type !== 'audio' && part.type !== 'video' && part.type !== 'file'

export const isMediaPart = (part: Part): part is MediaPart =>
	part.type === 'image' || part.type === 'audio' || part.type === 'video' || part.type === 'file'

export const assertTextOnly = (parts: Part[], label: string) => {
	const bad = parts.find((p) => !isTextLike(p))
	if (!bad) return
	throw new Error(`bot-layer: ${label} 只允许文本类 Part，发现: ${bad.type}`)
}

const mentionToText = (part: MentionPart): string => {
	const label = part.displayName ?? part.username ?? (part.id != null ? String(part.id) : part.kind)
	return `@${label}`
}

const inlineToText = (parts: InlinePart[]): string =>
	parts
		.map((p) => {
			if (p.type === 'text') return p.text
			if (p.type === 'styled') return inlineToText(p.children)
			if (p.type === 'mention') return mentionToText(p)
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
					if (!support) return { type: 'text', text: mentionToText(part) }
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
					if (!support) return { type: 'text', text: mentionToText(part) }
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

export const imageToText = (part: ImagePart): string => part.alt || part.name || part.url || '[image]'
export const audioToText = (part: AudioPart): string => part.name || part.url || '[audio]'
export const videoToText = (part: VideoPart): string => part.name || part.url || '[video]'
export const fileToText = (part: FilePart): string => part.name || part.url || '[file]'

export const mediaToText = (part: MediaPart): string => {
	switch (part.type) {
		case 'image':
			return imageToText(part)
		case 'audio':
			return audioToText(part)
		case 'video':
			return videoToText(part)
		case 'file':
			return fileToText(part)
	}
}

/**
 * 将任意 `Part[]` 归一化为"可渲染为文本"的 Part[]：
 * - 文本类 Part 会根据 format/mention 支持做降级
 * - 媒体 Part 会退化为可读文本
 */
export const normalizePartsForAdapter = <P extends Platform>(
	parts: Part[],
	adapter: PlatformAdapter<P>,
): TextLikePart[] => {
	const normalized: TextLikePart[] = []
	for (const part of parts) {
		if (isMediaPart(part)) {
			normalized.push({ type: 'text', text: mediaToText(part) })
			continue
		}
		normalized.push(part)
	}
	return normalizeTextPartsForAdapter(normalized, adapter)
}
