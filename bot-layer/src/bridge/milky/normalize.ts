import type { Attachment, BotChannel, BotUser, MentionPart, Message, MessageReference, Part } from '../../types'
import { hasRichParts } from '../../utils'
import { createReply, createSendHelpers } from '../../platforms/base'
import { milkyAdapter } from './adapter'

type MilkyMessageSession = import('pluxel-plugin-milky').MilkyMessageSession

type IncomingSegment = {
	type: string
	data?: Record<string, unknown> | null
}

type IncomingMessage = {
	message_scene: string
	peer_id: number | string
	sender_id?: number | string
	segments?: IncomingSegment[]
	time?: number
	message_seq?: number
}

type NormalizedContent = {
	text: string
	textRaw: string
	parts: Part[]
	mentions: MentionPart[]
	attachments: Attachment<'milky'>[]
	rich: boolean
	replySeq?: number
}

const fetchUrl = async (url: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
	const res = await fetch(url, { signal })
	if (!res.ok) throw new Error(`http ${res.status}`)
	return await res.arrayBuffer()
}

const attachmentForUrl = (
	kind: 'image' | 'file',
	part: Extract<Part, { type: 'image' | 'file' }>,
	source: 'message' | 'reference',
): Attachment<'milky'> => ({
	platform: 'milky',
	kind,
	part,
	source,
	fetch: part.url ? (signal) => fetchUrl(part.url!, signal) : undefined,
})

const resolveFileDownloadUrl = async (
	session: MilkyMessageSession,
	message: IncomingMessage,
	segData: any,
): Promise<string | null> => {
	const file_id = segData?.file_id
	if (!file_id) return null

	if (message.message_scene === 'group') {
		const res = await (session.bot as any).call('get_group_file_download_url', {
			group_id: Number(message.peer_id),
			file_id,
		})
		return res?.ok ? (res.data?.download_url ?? null) : null
	}

	const file_hash = segData?.file_hash
	if (!file_hash) return null
	const res = await (session.bot as any).call('get_private_file_download_url', {
		user_id: Number(message.peer_id),
		file_id,
		file_hash,
	})
	return res?.ok ? (res.data?.download_url ?? null) : null
}

const normalizeSegments = async (
	session: MilkyMessageSession,
	message: IncomingMessage,
	segments: IncomingSegment[],
	source: 'message' | 'reference',
): Promise<NormalizedContent> => {
	const parts: Part[] = []
	const attachments: Attachment<'milky'>[] = []
	let replySeq: number | undefined

	for (const seg of segments as any[]) {
		switch (seg?.type) {
			case 'text':
				if (seg.data?.text) parts.push({ type: 'text', text: String(seg.data.text) })
				break
			case 'mention':
				parts.push({ type: 'mention', kind: 'user', id: Number(seg.data?.user_id) })
				break
			case 'mention_all':
				parts.push({ type: 'mention', kind: 'everyone' })
				break
			case 'face':
				parts.push({ type: 'text', text: `[face:${String(seg.data?.face_id ?? '')}]` })
				break
			case 'reply':
				replySeq = Number(seg.data?.message_seq)
				break
			case 'image': {
				const url = seg.data?.temp_url ? String(seg.data.temp_url) : undefined
				const part = {
					type: 'image' as const,
					url,
					name: seg.data?.resource_id ? String(seg.data.resource_id) : undefined,
					alt: seg.data?.summary ? String(seg.data.summary) : undefined,
					width: typeof seg.data?.width === 'number' ? seg.data.width : undefined,
					height: typeof seg.data?.height === 'number' ? seg.data.height : undefined,
				}
				parts.push(part)
				attachments.push(attachmentForUrl('image', part, source))
				break
			}
			case 'record': {
				const url = seg.data?.temp_url ? String(seg.data.temp_url) : undefined
				const part = {
					type: 'file' as const,
					url,
					name: seg.data?.resource_id ? `record-${String(seg.data.resource_id)}.amr` : 'record.amr',
					mime: 'audio/amr',
				}
				parts.push(part)
				attachments.push(attachmentForUrl('file', part, source))
				break
			}
			case 'video': {
				const url = seg.data?.temp_url ? String(seg.data.temp_url) : undefined
				const part = {
					type: 'file' as const,
					url,
					name: seg.data?.resource_id ? `video-${String(seg.data.resource_id)}.mp4` : 'video.mp4',
					mime: 'video/mp4',
				}
				parts.push(part)
				attachments.push(attachmentForUrl('file', part, source))
				break
			}
			case 'file': {
				const url = await resolveFileDownloadUrl(session, message, seg.data).catch(() => null)
				const part = {
					type: 'file' as const,
					url: url ?? undefined,
					name: seg.data?.file_name ? String(seg.data.file_name) : 'file',
					size: typeof seg.data?.file_size === 'number' ? seg.data.file_size : undefined,
				}
				if (part.url) {
					parts.push(part)
					attachments.push(attachmentForUrl('file', part, source))
				} else {
					parts.push({ type: 'text', text: `[file:${part.name}]` })
				}
				break
			}
			default:
				break
		}
	}

	const textParts = parts.filter((p) => p.type !== 'image' && p.type !== 'file')
	const text = textParts.length ? milkyAdapter.render(textParts).text : ''
	const textRaw = text
	const mentions = parts.filter((p): p is MentionPart => p.type === 'mention')

	return { text, textRaw, parts, mentions, attachments, rich: hasRichParts(parts), replySeq }
}

const normalizeReference = async (
	session: MilkyMessageSession,
	message: IncomingMessage,
	replySeq: number,
): Promise<MessageReference<'milky'> | undefined> => {
	const peer = Number(message.peer_id)
	if (!Number.isFinite(peer)) return undefined

	try {
		const res = await (session.bot as any).call('get_message', {
			message_scene: message.message_scene,
			peer_id: peer,
			message_seq: replySeq,
		})
		if (!res?.ok || !res.data?.message) {
			return {
				platform: 'milky',
				messageId: replySeq,
				text: '',
				textRaw: '',
				parts: [],
				mentions: [],
				attachments: [],
				rich: false,
				user: null,
				channel: null,
			}
		}

		const m = res.data.message as IncomingMessage
		const normalized = await normalizeSegments(session, m, (m as any).segments ?? [], 'reference')
		const user: BotUser<'milky'> = {
			id: Number((m as any).sender_id),
			username: null,
			displayName: null,
			avatar: null,
			isBot: null,
		}
		const channel: BotChannel<'milky'> = {
			id: Number((m as any).peer_id),
			guildId: null,
			name: null,
			isPrivate: m.message_scene === 'group' ? false : true,
		}

		return {
			platform: 'milky',
			messageId: replySeq,
			text: normalized.text,
			textRaw: normalized.textRaw,
			parts: normalized.parts,
			mentions: normalized.mentions,
			attachments: normalized.attachments,
			rich: normalized.rich,
			user,
			channel,
		}
	} catch {
		return {
			platform: 'milky',
			messageId: replySeq,
			text: '',
			textRaw: '',
			parts: [],
			mentions: [],
			attachments: [],
			rich: false,
			user: null,
			channel: null,
		}
	}
}

export const normalizeMilkyMessage = async (session: MilkyMessageSession): Promise<Message<'milky'>> => {
	const message = session.message as IncomingMessage
	const normalized = await normalizeSegments(session, message, (message as any).segments ?? [], 'message')
	const reference =
		typeof normalized.replySeq === 'number' && Number.isFinite(normalized.replySeq)
			? await normalizeReference(session, message, normalized.replySeq)
			: undefined

	const channel: BotChannel<'milky'> = {
		id: Number((message as any).peer_id),
		guildId: null,
		name: null,
		isPrivate: message.message_scene === 'group' ? false : true,
	}

	const user: BotUser<'milky'> = {
		id: Number((message as any).sender_id),
		username: null,
		displayName: null,
		avatar: null,
		isBot: null,
	}

	const messageId = Number((message as any).message_seq) || null
	const reply = createReply(milkyAdapter, session)
	const { uploadImage, uploadFile, sendText, sendImage, sendFile } = createSendHelpers(milkyAdapter, session)

	return {
		platform: 'milky',
		text: normalized.text,
		textRaw: normalized.textRaw,
		parts: normalized.parts,
		mentions: normalized.mentions,
		attachments: normalized.attachments,
		reference,
		rich: normalized.rich || Boolean(reference?.rich),
		user,
		channel,
		messageId,
		raw: session,
		bot: session.bot,
		reply,
		sendText,
		sendImage,
		sendFile,
		uploadImage,
		uploadFile,
	}
}
