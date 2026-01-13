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
	AdapterPolicy,
	StyledPart,
	VideoPart,
} from '../../types'
import { defineAdapter } from '../../adapter'
import type { OutboundOp, OutboundText, PlatformAdapter, RenderResult } from '../../adapter'
import { toNodeBuffer } from '../../binary'

type MilkyMessageSession = import('pluxel-plugin-milky').MilkyMessageSession
type Result<T> = import('pluxel-plugin-milky').Result<T>

const policy = {
	text: {
		format: 'plain',
		inlineMention: {
			user: 'native',
			role: 'text',
			channel: 'text',
			everyone: 'native',
		},
	},
	outbound: {
		supportsQuote: true,
		supportsMixedMedia: true,
		supportedOps: ['text', 'image', 'audio', 'video', 'file'],
	},
} as const satisfies AdapterPolicy

export const milkyPolicy = policy

declare global {
	interface BotCorePlatformPolicyRegistry {
		milky: typeof milkyPolicy
	}
}

const renderInline = (parts: InlinePart[]): string => parts.map(renderPart).join('')

const renderStyled = (part: StyledPart): string => renderInline(part.children)

const renderMention = (part: MentionPart): string => {
	switch (part.kind) {
		case 'user':
			return `@${part.displayName ?? part.username ?? String(part.id)}`
		case 'everyone':
			return '@全体成员'
		default:
			return `@${part.displayName ?? part.username ?? String(part.id)}`
	}
}

const renderLink = (part: LinkPart): string => (part.label ? `${part.label} (${part.url})` : part.url)

const renderCodeblock = (part: CodeBlockPart): string => part.code

const renderPart = (part: Part): string => {
	switch (part.type) {
		case 'text':
			return part.text
		case 'styled':
			return renderStyled(part)
		case 'mention':
			return renderMention(part)
		case 'link':
			return renderLink(part)
		case 'codeblock':
			return renderCodeblock(part)
		case 'image':
			return part.alt ?? part.url ?? ''
		case 'audio':
			return part.name ?? part.url ?? ''
		case 'video':
			return part.name ?? part.url ?? ''
		case 'file':
			return part.name ?? part.url ?? ''
		default:
			return ''
	}
}

const render = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: policy.text.format,
})

type OutgoingSegment =
	| { type: 'text'; data: { text: string } }
	| { type: 'mention'; data: { user_id: number } }
	| { type: 'mention_all'; data: {} }
	| { type: 'reply'; data: { message_seq: number } }
	| { type: 'image'; data: { uri: string; sub_type: 'normal' | 'sticker'; summary?: string | null } }
	| { type: 'record'; data: { uri: string } }
	| { type: 'video'; data: { uri: string; thumb_uri?: string | null } }

const base64Uri = (data: ArrayBufferLike | ArrayBufferView): string => `base64://${toNodeBuffer(data).toString('base64')}`

const uriFromPart = (part: ImagePart | AudioPart | VideoPart | FilePart, label: string): string => {
	if (part.data) return base64Uri(part.data as ArrayBufferLike | ArrayBufferView)
	if (part.url) return part.url
	throw new Error(`Milky: 缺少 url，且未提供 data，无法发送${label}`)
}

const toOutgoingTextSegments = (text: OutboundText): OutgoingSegment[] => {
	const segs: OutgoingSegment[] = []
	for (const part of text.parts) {
		if (part.type === 'text') {
			if (part.text) segs.push({ type: 'text', data: { text: part.text } })
			continue
		}
		if (part.type === 'mention') {
			if (part.kind === 'everyone') {
				segs.push({ type: 'mention_all', data: {} })
				continue
			}
			if (part.kind === 'user') {
				const id = part.id != null ? Number(part.id) : NaN
				if (Number.isFinite(id)) {
					segs.push({ type: 'mention', data: { user_id: id } })
				} else {
					const label = part.displayName ?? part.username ?? ''
					segs.push({ type: 'text', data: { text: label ? `@${label}` : '@' } })
				}
			}
			continue
		}
	}
	return segs
}

const withQuote = (session: MilkyMessageSession, segs: OutgoingSegment[], quote?: boolean): OutgoingSegment[] => {
	if (!quote) return segs
	const seq = Number(session.message?.message_seq)
	if (!Number.isFinite(seq)) return segs
	return [{ type: 'reply', data: { message_seq: seq } }, ...segs]
}

const expectOk = <T>(res: Result<T>, name: string) => {
	if (res.ok) return
	throw new Error(res.message || `${name} failed`)
}

const sendMessage = async (session: MilkyMessageSession, message: OutgoingSegment[]) => {
	const scene = session.message?.message_scene
	const peer = Number(session.message?.peer_id)
	if (!Number.isFinite(peer)) throw new Error('Milky: 缺少 peer_id')

	if (scene === 'group') {
		const res = await session.bot.send_group_message({ group_id: peer, message })
		expectOk(res, 'send_group_message')
		return
	}

	const res = await session.bot.send_private_message({ user_id: peer, message })
	expectOk(res, 'send_private_message')
}

export const milkyAdapter = defineAdapter({
	name: 'milky',
	policy,
	render,

	uploadMedia: async (_session, media) => media,

	send: async (session, op: OutboundOp, options) => {
		switch (op.type) {
			case 'text': {
				const segments = withQuote(session, toOutgoingTextSegments(op.text), options?.quote)
				await sendMessage(session, segments)
				return
			}

			case 'image': {
				const uri = uriFromPart(op.image, '图片')
				const img: OutgoingSegment = {
					type: 'image',
					data: { uri, sub_type: 'normal', summary: op.caption?.rendered.text ?? null },
				}
				const captionSegs = op.caption ? toOutgoingTextSegments(op.caption) : []
				const segments = withQuote(session, [img, ...captionSegs], options?.quote)
				await sendMessage(session, segments)
				return
			}

			case 'audio': {
				const uri = uriFromPart(op.audio, '音频')
				const seg: OutgoingSegment = { type: 'record', data: { uri } }
				const segments = withQuote(session, [seg], options?.quote)
				await sendMessage(session, segments)
				return
			}

			case 'video': {
				const uri = uriFromPart(op.video, '视频')
				const thumb_uri = op.video.thumbnail?.url ?? null
				const seg: OutgoingSegment = { type: 'video', data: { uri, thumb_uri } }
				const captionSegs = op.caption ? toOutgoingTextSegments(op.caption) : []
				const segments = withQuote(session, [seg, ...captionSegs], options?.quote)
				await sendMessage(session, segments)
				return
			}

			case 'file': {
				const scene = session.message?.message_scene
				const peer = Number(session.message?.peer_id)
				if (!Number.isFinite(peer)) throw new Error('Milky: 缺少 peer_id')

				const file_uri = uriFromPart(op.file, '文件')
				const file_name = op.file.name ?? 'file'

				if (scene === 'group') {
					const res = await session.bot.upload_group_file({
						group_id: peer,
						parent_folder_id: '/',
						file_uri,
						file_name,
					})
					expectOk(res, 'upload_group_file')
					return
				}

				const res = await session.bot.upload_private_file({
					user_id: peer,
					file_uri,
					file_name,
				})
				expectOk(res, 'upload_private_file')
				return
			}
		}
	},
})
