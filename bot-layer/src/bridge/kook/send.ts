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
import type { OutboundPlan, PlatformAdapter, RenderResult } from '../../platforms/base'

const toNodeBuffer = (data: ArrayBufferLike | ArrayBufferView): Buffer => {
	if (Buffer.isBuffer(data)) return data
	if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
	return Buffer.from(new Uint8Array(data as ArrayBufferLike))
}

const capabilities: PlatformCapabilities = {
	format: 'markdown',
	supportsQuote: true,
	supportsImage: true,
	supportsFile: true,
	supportsMixedMedia: false,
	supportsRaw: true,
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
		case 'image': return part.alt ?? part.url
		case 'file': return part.name ?? part.url
		case 'raw': return '[kook raw]'
		default: return ''
	}
}

const render = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: capabilities.format,
})

const toAssetPayload = (part: ImagePart | FilePart) =>
	part.data ? toNodeBuffer(part.data as ArrayBufferLike | ArrayBufferView) : part.url

async function send(session: import('pluxel-plugin-kook').MessageSession, plan: OutboundPlan, options?: { quote?: boolean }) {
	const quote = options?.quote ? session.data?.msg_id : undefined
	const api = (session.bot as any)?.api

	const sendText = async (text: string) => {
		const needMarkdown = plan.textParts.some((p: Part) => p.type === 'styled' || p.type === 'mention' || p.type === 'link' || p.type === 'codeblock')
		const type = needMarkdown ? MessageType.kmarkdown : undefined
		const res = await session.bot.sendMessage(session.channelId, text, { type, quote })
		if (!res.ok) throw new Error(`KOOK sendMessage failed: ${res.message}`)
	}

	const uploadIfNeeded = async (file: ImagePart | FilePart, fallbackName: string): Promise<string> => {
		if (!file.data) return file.url
		if (!api?.createAsset) throw new Error('KOOK createAsset 不可用，无法上传文件')
		const res = await api.createAsset(toAssetPayload(file), file.name ?? fallbackName)
		if (!res.ok) throw new Error(`KOOK createAsset failed: ${res.message}`)
		return res.data
	}

	// KOOK 对图文混排支持有限，先发媒体再补文本
	for (const [index, img] of plan.images.entries()) {
		const url = await uploadIfNeeded(img, img.name ?? img.alt ?? `image-${index + 1}`)
		const res = await session.bot.sendMessage(session.channelId, url, { type: MessageType.image, quote })
		if (!res.ok) throw new Error(`KOOK sendImage failed: ${res.message}`)
	}
	for (const [index, file] of plan.files.entries()) {
		const url = await uploadIfNeeded(file, file.name ?? `file-${index + 1}`)
		const res = await session.bot.sendMessage(session.channelId, url, { type: MessageType.file, quote })
		if (!res.ok) throw new Error(`KOOK sendFile failed: ${res.message}`)
	}

	const text = render(plan.textParts).text
	if (text) {
		await sendText(text)
	} else if (!plan.images.length && !plan.files.length) {
		// 没有内容时也发一条空文本以保持行为一致
		await sendText(plan.rendered.text)
	}
}

export const kookAdapter: PlatformAdapter<'kook'> = {
	name: 'kook',
	capabilities,
	render,
	send,
}
