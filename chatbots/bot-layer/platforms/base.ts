import type {
	FilePart,
	InlinePart,
	ImagePart,
	MessageContent,
	Part,
	Platform,
	PlatformCapabilities,
	PlatformRegistry,
	ReplyOptions,
} from '../types'
import { normalizeMessageContent } from '../parts'

export type RenderResult = { text: string; format: PlatformCapabilities['format'] }

export interface OutboundPlan {
	rendered: RenderResult
	textParts: Part[]
	images: ImagePart[]
	files: FilePart[]
	rich: boolean
	parts: Part[]
}

export interface PlatformAdapter<P extends Platform = Platform> {
	name: P
	capabilities: PlatformCapabilities
	render: (parts: Part[]) => RenderResult
	send: (session: PlatformRegistry[P]['raw'], plan: OutboundPlan, options?: ReplyOptions) => Promise<void>
}

const hasRichParts = (parts: Part[]): boolean =>
	parts.some((p) => p.type === 'image' || p.type === 'file' || p.type === 'raw')

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

/** 针对平台能力对 Part 进行降级/兼容处理，确保新平台不会因为不支持的元素而失败 */
export const normalizePartsForAdapter = <P extends Platform>(
	parts: Part[],
	adapter: PlatformAdapter<P>,
): Part[] => {
	const { capabilities } = adapter

	return parts
		.map<Part | null>((part) => {
			switch (part.type) {
				case 'styled': {
					const children = normalizePartsForAdapter(part.children as InlinePart[], adapter) as InlinePart[]
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
						return {
							type: 'text',
							text: part.label ? `${part.label} (${part.url})` : part.url,
						}
					}
					return part
				}
				case 'codeblock': {
					if (capabilities.format === 'plain') {
						return { type: 'text', text: part.code }
					}
					return part
				}
				case 'image':
					if (!capabilities.supportsImage) return { type: 'text', text: part.alt ?? part.url }
					return part
				case 'file':
					if (!capabilities.supportsFile) return { type: 'text', text: part.name ?? part.url }
					return part
				case 'raw':
					if (!capabilities.supportsRaw) return { type: 'text', text: `[${part.platform} raw]` }
					return part
				default:
					return part
			}
		})
		.filter((p): p is Part => Boolean(p))
}

export const buildOutboundPlan = <P extends Platform>(parts: Part[], adapter: PlatformAdapter<P>): OutboundPlan => {
	const normalized = normalizePartsForAdapter(parts, adapter)
	const rich = hasRichParts(normalized)
	const rendered = adapter.render(normalized)
	const images = adapter.capabilities.supportsImage
		? normalized.filter((p): p is ImagePart => p.type === 'image')
		: []
	const files = adapter.capabilities.supportsFile
		? normalized.filter((p): p is FilePart => p.type === 'file')
		: []
	const textParts = normalized.filter((p) => p.type !== 'image' && p.type !== 'file')

	return { rendered, textParts, images, files, rich, parts: normalized }
}

export const createReply =
	<P extends Platform>(adapter: PlatformAdapter<P>, session: PlatformRegistry[P]['raw']) =>
	async (content: MessageContent, options?: ReplyOptions) => {
		const parts = normalizeMessageContent(content)
		if (!parts.length) return
		const plan = buildOutboundPlan(parts, adapter)
		await adapter.send(session, plan, options)
	}
