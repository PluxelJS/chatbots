import type { MessageSession } from 'pluxel-plugin-kook'
import type { Attachment, BotChannel, BotUser, MentionPart, Message, MessageReference, Part } from '../../types'
import { hasRichParts } from '../../parts'
import { createReply, createSendHelpers } from '../../adapter'
import { kookAdapter } from './adapter'

type KookAttachment = { type?: string; url?: string; name?: string; file_type?: string }

const fetchUrl = async (url: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
	const res = await fetch(url, signal ? { signal } : undefined)
	if (!res.ok) throw new Error(`bot-layer: kook 下载失败 http ${res.status}`)
	return await res.arrayBuffer()
}

interface NormalizedContent {
	text: string
	textRaw: string
	parts: Part[]
	mentions: MentionPart[]
	attachments: Attachment<'kook'>[]
	rich: boolean
}

const normalizeContent = (payload: any, source: 'message' | 'reference'): NormalizedContent => {
	const parts: Part[] = []
	const attachments: Attachment<'kook'>[] = []
	const extra: any = payload?.extra ?? payload ?? {}
	const mentionUsers = new Map<string, { username?: string; displayName?: string; avatar?: string }>()

	const mentionParts = extra?.kmarkdown?.mention_part
	if (Array.isArray(mentionParts)) {
		for (const meta of mentionParts) {
			if (!meta?.id) continue
			const username = meta.username ?? meta.full_name ?? null
			mentionUsers.set(String(meta.id), {
				username: meta.username ?? null,
				displayName: meta.full_name ?? username ?? null,
				avatar: meta.avatar ?? null,
			})
		}
	}

	const rawContent = payload?.content ?? extra?.kmarkdown?.raw_content ?? ''
	const textRaw = rawContent ? String(rawContent) : ''
	if (textRaw) {
		parts.push({ type: 'text', text: textRaw })
	}

	if (extra?.mention_all || extra?.mention_here) {
		parts.push({ type: 'mention', kind: 'everyone' })
	}

	if (Array.isArray(extra?.mention)) {
		for (const id of extra.mention) {
			const meta = mentionUsers.get(String(id))
			parts.push({
				type: 'mention',
				kind: 'user',
				id,
				username: meta?.username,
				displayName: meta?.displayName,
				avatar: meta?.avatar,
			})
		}
	}

	if (Array.isArray(extra?.mention_roles)) {
		for (const roleId of extra.mention_roles) {
			parts.push({ type: 'mention', kind: 'role', id: roleId })
		}
	}

	const pushAttachment = (att: KookAttachment) => {
		if (!att?.type || !att.url) return
		const url = att.url
		const fetch = (signal?: AbortSignal) => fetchUrl(url, signal)
		if (att.type === 'image') {
			const part = { type: 'image' as const, url: att.url, alt: att.name, name: att.name }
			parts.push(part)
			attachments.push({ platform: 'kook', kind: 'image', part, source, fetch })
			return
		}
		if (att.type === 'video') {
			const part = { type: 'video' as const, url: att.url, name: att.name, mime: att.file_type }
			parts.push(part)
			attachments.push({ platform: 'kook', kind: 'video', part, source, fetch })
			return
		}
		if (att.type === 'file') {
			const part = { type: 'file' as const, url: att.url, name: att.name, mime: att.file_type }
			parts.push(part)
			attachments.push({ platform: 'kook', kind: 'file', part, source, fetch })
			return
		}
		const part = { type: 'file' as const, url: att.url, name: att.name, mime: att.file_type }
		parts.push(part)
		attachments.push({ platform: 'kook', kind: 'file', part, source, fetch })
	}

	const attachmentsRaw = extra?.attachments
	if (attachmentsRaw) {
		const list = Array.isArray(attachmentsRaw) ? attachmentsRaw : [attachmentsRaw]
		for (const att of list) {
			pushAttachment(att)
		}
	}

	const textParts = parts.filter((p) => p.type !== 'image' && p.type !== 'audio' && p.type !== 'video' && p.type !== 'file')
	const text = textParts.length ? kookAdapter.render(textParts).text : textRaw
	const mentions = parts.filter((part): part is MentionPart => part.type === 'mention')
	return {
		text,
		textRaw,
		parts,
		mentions,
		attachments,
		rich: hasRichParts(parts),
	}
}

const normalizeReference = (session: MessageSession): MessageReference<'kook'> | undefined => {
	const quote: any = (session.data as any)?.extra?.quote
	if (!quote) return undefined
	const normalized = normalizeContent(quote, 'reference')

	const author = quote.author
	const user: BotUser<'kook'> | null = author
		? {
				id: author.id ?? author.userId ?? '',
				username: author.username ?? null,
				displayName: author.nickname ?? null,
				avatar: author.avatar ?? null,
				isBot: typeof author.bot === 'boolean' ? author.bot : null,
			}
		: null

	const messageId = quote.msg_id ?? quote.msgId ?? quote.id ?? null

	return {
		platform: 'kook',
		messageId,
		text: normalized.text,
		textRaw: normalized.textRaw,
		parts: normalized.parts,
		mentions: normalized.mentions,
		attachments: normalized.attachments,
		rich: normalized.rich,
		user,
		channel: null,
	}
}

export const normalizeKookMessage = (session: MessageSession): Message<'kook'> => {
	const messageId = session.data?.msg_id ?? null
	const normalized = normalizeContent(session.data, 'message')
	const reference = normalizeReference(session)

	const channel: BotChannel<'kook'> = {
		id: session.channelId,
		guildId: session.guildId ?? null,
		isPrivate: session.data?.channel_type === 'PERSON' ? true : session.data?.channel_type === 'GROUP' ? false : null,
		name: null,
	}

	const author: any = (session.data as any)?.extra?.author
	const user: BotUser<'kook'> = {
		id: session.userId,
		username: author?.username ?? null,
		displayName: author?.nickname ?? null,
		avatar: author?.avatar ?? null,
		isBot: typeof author?.bot === 'boolean' ? author?.bot : null,
	}

	const reply = createReply(kookAdapter, session)
	const { sendText, sendImage, sendAudio, sendVideo, sendFile } = createSendHelpers(kookAdapter, session)
	const supported = kookAdapter.policy.outbound.supportedOps

	return {
		platform: 'kook',
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
		...(supported.includes('image') ? { sendImage } : {}),
		...(supported.includes('audio') ? { sendAudio } : {}),
		...(supported.includes('video') ? { sendVideo } : {}),
		...(supported.includes('file') ? { sendFile } : {}),
	}
}
