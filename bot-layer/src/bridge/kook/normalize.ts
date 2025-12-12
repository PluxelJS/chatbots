import type { MessageSession } from 'pluxel-plugin-kook'
import type { Attachment, BotChannel, BotUser, Message, MessageReference, Part } from '../../types'
import { hasRichParts } from '../../utils'
import { createReply } from '../../platforms/base'
import { kookAdapter } from './send'

type KookAttachment = { type?: string; url?: string; name?: string; file_type?: string }

interface NormalizedContent {
	text: string
	parts: Part[]
	attachments: Attachment<'kook'>[]
	rich: boolean
}

const normalizeContent = (payload: any, source: 'message' | 'reference'): NormalizedContent => {
	const parts: Part[] = []
	const attachments: Attachment<'kook'>[] = []
	const extra: any = payload?.extra ?? payload ?? {}

	const rawContent = payload?.content ?? extra?.kmarkdown?.raw_content ?? ''
	if (rawContent) {
		parts.push({ type: 'text', text: String(rawContent) })
	}

	if (extra?.mention_all || extra?.mention_here) {
		parts.push({ type: 'mention', kind: 'everyone' })
	}

	if (Array.isArray(extra?.mention)) {
		for (const id of extra.mention) {
			parts.push({ type: 'mention', kind: 'user', id })
		}
	}

	if (Array.isArray(extra?.mention_roles)) {
		for (const roleId of extra.mention_roles) {
			parts.push({ type: 'mention', kind: 'role', id: roleId })
		}
	}

	const pushAttachment = (att: KookAttachment) => {
		if (!att?.type || !att.url) return
		if (att.type === 'image') {
			const part = { type: 'image' as const, url: att.url, alt: att.name, name: att.name }
			parts.push(part)
			attachments.push({ platform: 'kook', kind: 'image', part, source })
			return
		}
		if (att.type === 'file') {
			const part = { type: 'file' as const, url: att.url, name: att.name, mime: att.file_type }
			parts.push(part)
			attachments.push({ platform: 'kook', kind: 'file', part, source })
			return
		}
		parts.push({ type: 'raw', platform: 'kook', payload: att })
	}

	const attachmentsRaw = extra?.attachments
	if (attachmentsRaw) {
		const list = Array.isArray(attachmentsRaw) ? attachmentsRaw : [attachmentsRaw]
		for (const att of list) {
			pushAttachment(att)
		}
	}

	const textParts = parts.filter((p) => p.type !== 'image' && p.type !== 'file')
	const text = textParts.length ? kookAdapter.render(textParts).text : rawContent ? String(rawContent) : ''
	return {
		text,
		parts,
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
		parts: normalized.parts,
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

	return {
		platform: 'kook',
		text: normalized.text,
		parts: normalized.parts,
		attachments: normalized.attachments,
		reference,
		rich: normalized.rich || Boolean(reference?.rich),
		user,
		channel,
		messageId,
		raw: session,
		bot: session.bot,
		reply,
	}
}
