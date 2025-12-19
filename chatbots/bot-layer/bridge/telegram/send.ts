import { Buffer } from 'node:buffer'
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
import type { OutboundPlan, PlatformAdapter, RenderResult } from '../../platforms/base'

const escapeHtml = (input: string): string =>
	input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')

const escapeAttr = (input: string): string => escapeHtml(input).replace(/"/g, '&quot;')

const toNodeBuffer = (data: ArrayBufferLike | ArrayBufferView): Buffer => {
	if (Buffer.isBuffer(data)) return data
	if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
	return Buffer.from(new Uint8Array(data as ArrayBufferLike))
}

const capabilities: PlatformCapabilities = {
	format: 'html',
	supportsQuote: true,
	supportsImage: true,
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
			return escapeHtml(part.alt ?? part.url)
		case 'file':
			return escapeHtml(part.name ?? part.url)
		case 'raw':
			return '[telegram raw]'
		default:
			return ''
	}
}

const render = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: capabilities.format,
})

const toInputFile = (part: ImagePart | FilePart, fallbackName: string) =>
	part.data
		? {
				data: toNodeBuffer(part.data as ArrayBufferLike | ArrayBufferView),
				filename: part.name ?? fallbackName,
				contentType: part.mime,
			}
		: part.url

async function send(session: import('pluxel-plugin-telegram').MessageSession, plan: OutboundPlan, options?: { quote?: boolean }) {
	const replyTo = options?.quote ? session.message.message_id : undefined
	const parseMode = plan.rendered.format === 'html' ? 'HTML' : undefined

	const text = render(plan.textParts).text
	const needSplitCaption = (caption: string) =>
		!capabilities.supportsMixedMedia || (capabilities.maxCaptionLength !== undefined && caption.length > capabilities.maxCaptionLength)

	const sendText = async (content: string) => {
		if (!content) return
		const res = await session.bot.sendMessage(session.chatId, content, {
			reply_to_message_id: replyTo,
			parse_mode: parseMode,
		})
		if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.message}`)
	}

	// 逐个发送图片/文件，必要时拆分文本
	for (const [index, img] of plan.images.entries()) {
		const caption = text && !needSplitCaption(text) ? text : img.alt
		const payload = toInputFile(img, img.name ?? img.alt ?? `image-${index + 1}.png`)
		const res = await session.bot.sendPhoto(session.chatId, payload, {
			caption,
			reply_to_message_id: replyTo,
			parse_mode: parseMode,
		})
		if (!res.ok) throw new Error(`Telegram sendPhoto failed: ${res.message}`)
		if (text && needSplitCaption(text)) await sendText(text)
	}

	for (const [index, file] of plan.files.entries()) {
		const caption = text && !needSplitCaption(text) ? text : file.name ?? undefined
		const payload = toInputFile(file, file.name ?? `file-${index + 1}`)
		const res = await session.bot.sendDocument(session.chatId, payload, {
			caption,
			reply_to_message_id: replyTo,
		})
		if (!res.ok) throw new Error(`Telegram sendDocument failed: ${res.message}`)
		if (text && needSplitCaption(text)) await sendText(text)
	}

	// 如果没有媒体，发送纯文本
	if (!plan.images.length && !plan.files.length) {
		await sendText(plan.rendered.text)
	}
}

export const telegramAdapter: PlatformAdapter<'telegram'> = {
	name: 'telegram',
	capabilities,
	render,
	send,
}
