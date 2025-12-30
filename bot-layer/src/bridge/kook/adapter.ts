import { Buffer } from 'node:buffer'
import { MessageType } from 'pluxel-plugin-kook'

import type {
	CodeBlockPart,
	FilePart,
	ImagePart,
	InlinePart,
	LinkPart,
	MentionPart,
	Part,
	PlatformCapabilities,
	StyledPart,
} from '../../types'
import type { OutboundText, PlatformAdapter, RenderResult } from '../../platforms/base'
import { toNodeBuffer } from '../../binary'

const capabilities: PlatformCapabilities = {
	format: 'markdown',
	supportsQuote: true,
	supportsImage: true,
	supportsFile: true,
	supportsMixedMedia: false,
	supportsInlineMention: {
		user: true,
		role: true,
		channel: true,
		everyone: true,
	},
}

const renderInline = (parts: InlinePart[]): string => parts.map(renderPart).join('')

const renderStyled = (part: StyledPart): string => {
	const inner = renderInline(part.children)
	switch (part.style) {
		case 'bold': return `**${inner}**`
		case 'italic': return `*${inner}*`
		case 'strike': return `~~${inner}~~`
		case 'code': return `\`${inner}\``
		default: return inner
	}
}

const renderMention = (part: MentionPart): string => {
	switch (part.kind) {
		case 'user': return `(met)${part.id ?? ''}(met)`
		case 'role': return `(rol)${part.id ?? ''}(rol)`
		case 'channel': return `(chn)${part.id ?? ''}(chn)`
		case 'everyone': return '(met)all(met)'
		default: return ''
	}
}

const renderLink = (part: LinkPart): string =>
	part.label ? `[${part.label}](${part.url})` : part.url

const renderCodeblock = (part: CodeBlockPart): string =>
	part.language ? `\`\`\`${part.language}\n${part.code}\n\`\`\`` : `\`\`\`\n${part.code}\n\`\`\``

const renderPart = (part: Part): string => {
	switch (part.type) {
		case 'text': return part.text
		case 'styled': return renderStyled(part)
		case 'mention': return renderMention(part)
		case 'link': return renderLink(part)
		case 'codeblock': return renderCodeblock(part)
		case 'image': return part.alt ?? part.url ?? ''
		case 'file': return part.name ?? part.url ?? ''
		default: return ''
	}
}

const render = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: capabilities.format,
})

const needsMarkdown = (parts: Part[]): boolean =>
	parts.some((p) => p.type === 'styled' || p.type === 'mention' || p.type === 'link' || p.type === 'codeblock')

const isPrivateSession = (session: import('pluxel-plugin-kook').MessageSession): boolean =>
	session.data?.channel_type === 'PERSON'

const uploadIfNeeded = async (
	session: import('pluxel-plugin-kook').MessageSession,
	file: ImagePart | FilePart,
	fallbackName: string,
): Promise<string> => {
	if (!file.data) {
		if (!file.url) throw new Error('KOOK: 缺少 url，且未提供 data，无法发送媒体')
		return file.url
	}

	const res = await session.bot.$tool.createAsset(
		toNodeBuffer(file.data as ArrayBufferLike | ArrayBufferView),
		file.name ?? fallbackName,
	)
	if (!res.ok) throw new Error(`KOOK createAsset failed: ${res.message}`)
	return res.data
}

export const kookAdapter: PlatformAdapter<'kook'> = {
	name: 'kook',
	capabilities,
	render,

	sendText: async (session, text: OutboundText, options) => {
		const quote = options?.quote ? session.data?.msg_id : undefined
		const type = needsMarkdown(text.parts) ? MessageType.kmarkdown : undefined
		if (isPrivateSession(session)) {
			const res = await session.bot.createDirectMessage({
				target_id: session.userId,
				content: text.rendered.text,
				type,
				quote,
			})
			if (!res.ok) throw new Error(`KOOK createDirectMessage failed: ${res.message}`)
			return
		}
		const res = await session.bot.sendMessage({
			target_id: session.channelId,
			content: text.rendered.text,
			type,
			quote,
		})
		if (!res.ok) throw new Error(`KOOK sendMessage failed: ${res.message}`)
	},

	uploadImage: async (session, image) => {
		const url = await uploadIfNeeded(session, image, image.name ?? image.alt ?? 'image.png')
		return { ...image, url, data: undefined }
	},

	uploadFile: async (session, file) => {
		const url = await uploadIfNeeded(session, file, file.name ?? 'file')
		return { ...file, url, data: undefined }
	},

	sendImage: async (session, image, _caption, options) => {
		const quote = options?.quote ? session.data?.msg_id : undefined
		if (!image.url) throw new Error('KOOK: image.url 为空，无法发送图片')
		if (isPrivateSession(session)) {
			const res = await session.bot.createDirectMessage({
				target_id: session.userId,
				content: image.url,
				type: MessageType.image,
				quote,
			})
			if (!res.ok) throw new Error(`KOOK createDirectMessage failed: ${res.message}`)
			return
		}
		const res = await session.bot.sendMessage({
			target_id: session.channelId,
			content: image.url,
			type: MessageType.image,
			quote,
		})
		if (!res.ok) throw new Error(`KOOK sendImage failed: ${res.message}`)
	},

	sendFile: async (session, file, options) => {
		const quote = options?.quote ? session.data?.msg_id : undefined
		if (!file.url) throw new Error('KOOK: file.url 为空，无法发送文件')
		if (isPrivateSession(session)) {
			const res = await session.bot.createDirectMessage({
				target_id: session.userId,
				content: file.url,
				type: MessageType.file,
				quote,
			})
			if (!res.ok) throw new Error(`KOOK createDirectMessage failed: ${res.message}`)
			return
		}
		const res = await session.bot.sendMessage({
			target_id: session.channelId,
			content: file.url,
			type: MessageType.file,
			quote,
		})
		if (!res.ok) throw new Error(`KOOK sendFile failed: ${res.message}`)
	},
}
