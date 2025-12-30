import { Buffer } from 'node:buffer'

import type {
	AudioPart,
	CodeBlockPart,
	FilePart,
	ImagePart,
	InlinePart,
	LinkPart,
	MentionPart,
	Part,
	PlatformCapabilities,
	StyledPart,
	VideoPart,
} from '../../types'
import type { OutboundText, PlatformAdapter, RenderResult } from '../../adapter'
import { toNodeBuffer } from '../../binary'

const escapeHtml = (input: string): string =>
	input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')

const escapeAttr = (input: string): string => escapeHtml(input).replace(/"/g, '&quot;')

const capabilities: PlatformCapabilities = {
	format: 'html',
	supportsQuote: true,
	supportsImage: true,
	supportsAudio: true,
	supportsVideo: true,
	supportsFile: true,
	supportsMixedMedia: true,
	supportsInlineMention: {
		user: true,
		role: false,
		channel: false,
		everyone: false,
	},
	maxCaptionLength: 1024,
}

const renderInline = (parts: InlinePart[]): string => parts.map(renderPart).join('')

const renderStyled = (part: StyledPart): string => {
	const inner = renderInline(part.children)
	switch (part.style) {
		case 'bold':
			return `<b>${inner}</b>`
		case 'italic':
			return `<i>${inner}</i>`
		case 'strike':
			return `<s>${inner}</s>`
		case 'underline':
			return `<u>${inner}</u>`
		case 'code':
			return `<code>${inner}</code>`
		default:
			return inner
	}
}

const renderMention = (part: MentionPart): string => `@${escapeHtml(String(part.id ?? part.kind))}`

const renderLink = (part: LinkPart): string =>
	part.label ? `<a href="${escapeAttr(part.url)}">${escapeHtml(part.label)}</a>` : escapeHtml(part.url)

const renderCodeblock = (part: CodeBlockPart): string =>
	part.language
		? `<pre><code class="language-${escapeAttr(part.language)}">${escapeHtml(part.code)}</code></pre>`
		: `<pre>${escapeHtml(part.code)}</pre>`

const renderPart = (part: Part): string => {
	switch (part.type) {
		case 'text':
			return escapeHtml(part.text)
		case 'styled':
			return renderStyled(part)
		case 'mention':
			return renderMention(part)
		case 'link':
			return renderLink(part)
		case 'codeblock':
			return renderCodeblock(part)
		case 'image':
			return escapeHtml(part.alt ?? part.url ?? '')
		case 'audio':
			return escapeHtml(part.name ?? part.url ?? '')
		case 'video':
			return escapeHtml(part.name ?? part.url ?? '')
		case 'file':
			return escapeHtml(part.name ?? part.url ?? '')
		default:
			return ''
	}
}

const render = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: capabilities.format,
})

type MediaInput = ImagePart | AudioPart | VideoPart | FilePart

const toInputFile = (part: MediaInput, fallbackName: string) =>
	part.data
		? {
				data: toNodeBuffer(part.data as ArrayBufferLike | ArrayBufferView),
				filename: part.name ?? fallbackName,
				contentType: part.mime,
			}
		: part.url

const isAnimationLike = (part: ImagePart): boolean => {
	const mime = (part.mime ?? '').toLowerCase()
	if (mime === 'image/gif' || mime === 'video/mp4') return true
	const name = (part.name ?? part.url ?? '').toLowerCase()
	return name.endsWith('.gif') || name.endsWith('.mp4')
}

const toParseMode = (format: RenderResult['format']): 'HTML' | undefined =>
	format === 'html' ? 'HTML' : undefined

export const telegramAdapter: PlatformAdapter<'telegram'> = {
	name: 'telegram',
	capabilities,
	render,

	sendText: async (session, text: OutboundText, options) => {
		if (!text.rendered.text) return
		const replyTo = options?.quote ? session.message.message_id : undefined
		const parseMode = toParseMode(text.rendered.format)
		const res = await session.bot.sendMessage({
			chat_id: session.chatId,
			text: text.rendered.text,
			reply_to_message_id: replyTo,
			parse_mode: parseMode,
		})
		if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.message}`)
	},

	uploadImage: async (_session, image) => image,
	uploadFile: async (_session, file) => file,

	sendImage: async (session, image, caption, options) => {
		const replyTo = options?.quote ? session.message.message_id : undefined
		const parseMode = caption ? toParseMode(caption.rendered.format) : undefined
		const payload = toInputFile(image, image.name ?? image.alt ?? 'image.png')
		if (!payload) throw new Error('Telegram: image.url 为空，且未提供 data，无法发送图片')

		if (isAnimationLike(image)) {
			const res = await session.bot.sendAnimation({
				chat_id: session.chatId,
				animation: payload,
				caption: caption?.rendered.text || undefined,
				reply_to_message_id: replyTo,
				parse_mode: parseMode,
			})
			if (!res.ok) {
				const msg = String(res.message ?? '')
				if (msg.includes('no animation in the request')) {
					const doc = await session.bot.sendDocument({
						chat_id: session.chatId,
						document: payload,
						caption: caption?.rendered.text || undefined,
						reply_to_message_id: replyTo,
					})
					if (!doc.ok) throw new Error(`Telegram sendAnimation failed: ${res.message}; sendDocument failed: ${doc.message}`)
				} else {
					throw new Error(`Telegram sendAnimation failed: ${res.message}`)
				}
			}
		} else {
			const res = await session.bot.sendPhoto({
				chat_id: session.chatId,
				photo: payload,
				caption: caption?.rendered.text || undefined,
				reply_to_message_id: replyTo,
				parse_mode: parseMode,
			})
			if (!res.ok) throw new Error(`Telegram sendPhoto failed: ${res.message}`)
		}
	},

	sendAudio: async (session, audio, options) => {
		const replyTo = options?.quote ? session.message.message_id : undefined
		const payload = toInputFile(audio, audio.name ?? 'audio')
		if (!payload) throw new Error('Telegram: audio.url 为空，且未提供 data，无法发送音频')
		const res = await session.bot.sendAudio({
			chat_id: session.chatId,
			audio: payload,
			reply_to_message_id: replyTo,
		})
		if (!res.ok) throw new Error(`Telegram sendAudio failed: ${res.message}`)
	},

	sendVideo: async (session, video, caption, options) => {
		const replyTo = options?.quote ? session.message.message_id : undefined
		const parseMode = caption ? toParseMode(caption.rendered.format) : undefined
		const payload = toInputFile(video, video.name ?? 'video.mp4')
		if (!payload) throw new Error('Telegram: video.url 为空，且未提供 data，无法发送视频')
		const res = await session.bot.sendVideo({
			chat_id: session.chatId,
			video: payload,
			caption: caption?.rendered.text || undefined,
			reply_to_message_id: replyTo,
			parse_mode: parseMode,
		})
		if (!res.ok) throw new Error(`Telegram sendVideo failed: ${res.message}`)
	},

	sendFile: async (session, file, options) => {
		const replyTo = options?.quote ? session.message.message_id : undefined
		const payload = toInputFile(file, file.name ?? 'file')
		if (!payload) throw new Error('Telegram: file.url 为空，且未提供 data，无法发送文件')
		const res = await session.bot.sendDocument({
			chat_id: session.chatId,
			document: payload,
			reply_to_message_id: replyTo,
		})
		if (!res.ok) throw new Error(`Telegram sendDocument failed: ${res.message}`)
	},
}
