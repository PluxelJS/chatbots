import { Buffer } from 'node:buffer'
import { MessageType } from 'pluxel-plugin-kook'

import type {
	AudioPart,
	CodeBlockPart,
	FilePart,
	ImagePart,
	InlinePart,
	LinkPart,
	MentionPart,
	Part,
	AdapterPolicy,
	StyledPart,
	VideoPart,
} from '../../types'
import { defineAdapter } from '../../adapter'
import type { OutboundOp, OutboundText, PlatformAdapter, RenderResult } from '../../adapter'
import { toNodeBuffer } from '../../binary'

const policy = {
	text: {
		format: 'markdown',
		inlineMention: {
			user: 'native',
			role: 'native',
			channel: 'native',
			everyone: 'native',
		},
	},
	outbound: {
		supportsQuote: true,
		supportsMixedMedia: false,
		supportedOps: ['text', 'image', 'video', 'file'],
	},
} as const satisfies AdapterPolicy

export const kookPolicy = policy

declare global {
	interface BotCorePlatformPolicyRegistry {
		kook: typeof kookPolicy
	}
}

const renderInline = (parts: InlinePart[]): string => parts.map(renderPart).join('')

const renderStyled = (part: StyledPart): string => {
	const inner = renderInline(part.children)
	switch (part.style) {
		case 'bold': return `**${inner}**`
		case 'italic': return `*${inner}*`
		case 'strike': return `~~${inner}~~`
		case 'code': return `\`${inner}\``
		case 'underline': return `(ins)${inner}(ins)`
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
		case 'audio': return part.name ?? part.url ?? ''
		case 'video': return part.name ?? part.url ?? ''
		case 'file': return part.name ?? part.url ?? ''
		default: return ''
	}
}

const render = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: policy.text.format,
})

const needsMarkdown = (parts: Part[]): boolean =>
	parts.some((p) => p.type === 'styled' || p.type === 'mention' || p.type === 'link' || p.type === 'codeblock')

const isPrivateSession = (session: import('pluxel-plugin-kook').MessageSession): boolean =>
	session.data?.channel_type === 'PERSON'

const uploadIfNeeded = async (
	session: import('pluxel-plugin-kook').MessageSession,
	file: ImagePart | AudioPart | VideoPart | FilePart,
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

export const kookAdapter = defineAdapter({
	name: 'kook',
	policy,
	render,

	uploadMedia: async (session, media) => {
		if (media.type === 'image') {
			const url = await uploadIfNeeded(session, media, media.name ?? media.alt ?? 'image.png')
			return { ...media, url, data: undefined }
		}
		if (media.type === 'file') {
			const url = await uploadIfNeeded(session, media, media.name ?? 'file')
			return { ...media, url, data: undefined }
		}
		if (media.type === 'video') {
			const url = await uploadIfNeeded(session, media, media.name ?? 'video.mp4')
			return { ...media, url, data: undefined }
		}
		if (media.type === 'audio') {
			const url = await uploadIfNeeded(session, media, media.name ?? 'audio')
			return { ...media, url, data: undefined }
		}
		return media
	},

	send: async (session, op: OutboundOp, options) => {
		const quote = options?.quote ? session.data?.msg_id : undefined

		const sendText = async (text: OutboundText) => {
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
		}

		switch (op.type) {
			case 'text':
				await sendText(op.text)
				return
			case 'image': {
				if (op.caption?.rendered.text) {
					throw new Error('KOOK: 不支持单条图文混排（image caption）')
				}
				if (!op.image.url) throw new Error('KOOK: image.url 为空，无法发送图片')
				if (isPrivateSession(session)) {
					const res = await session.bot.createDirectMessage({
						target_id: session.userId,
						content: op.image.url,
						type: MessageType.image,
						quote,
					})
					if (!res.ok) throw new Error(`KOOK createDirectMessage failed: ${res.message}`)
					return
				}
				const res = await session.bot.sendMessage({
					target_id: session.channelId,
					content: op.image.url,
					type: MessageType.image,
					quote,
				})
				if (!res.ok) throw new Error(`KOOK sendImage failed: ${res.message}`)
				return
			}
			case 'file': {
				if (!op.file.url) throw new Error('KOOK: file.url 为空，无法发送文件')
				if (isPrivateSession(session)) {
					const res = await session.bot.createDirectMessage({
						target_id: session.userId,
						content: op.file.url,
						type: MessageType.file,
						quote,
					})
					if (!res.ok) throw new Error(`KOOK createDirectMessage failed: ${res.message}`)
					return
				}
				const res = await session.bot.sendMessage({
					target_id: session.channelId,
					content: op.file.url,
					type: MessageType.file,
					quote,
				})
				if (!res.ok) throw new Error(`KOOK sendFile failed: ${res.message}`)
				return
			}
			case 'video': {
				if (op.caption?.rendered.text) {
					throw new Error('KOOK: 不支持单条图文混排（video caption）')
				}
				if (!op.video.url) throw new Error('KOOK: video.url 为空，无法发送视频')
				if (isPrivateSession(session)) {
					const res = await session.bot.createDirectMessage({
						target_id: session.userId,
						content: op.video.url,
						type: MessageType.video,
						quote,
					})
					if (!res.ok) throw new Error(`KOOK createDirectMessage failed: ${res.message}`)
					return
				}
				const res = await session.bot.sendMessage({
					target_id: session.channelId,
					content: op.video.url,
					type: MessageType.video,
					quote,
				})
				if (!res.ok) throw new Error(`KOOK sendVideo failed: ${res.message}`)
				return
			}
			case 'audio':
				throw new Error('KOOK: 不支持音频发送')
		}
	},
})
