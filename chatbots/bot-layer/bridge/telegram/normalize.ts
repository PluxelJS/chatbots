import type { MessageSession } from 'pluxel-plugin-telegram'
import type { Attachment, BotChannel, BotUser, Message, MessageReference, Part } from '../../types'
import { hasRichParts } from '../../utils'
import { createReply, createSendHelpers } from '../../platforms/base'
import { telegramAdapter } from './adapter'

type TelegramMessage = MessageSession['message']
type Entity = {
	offset: number
	length: number
	type: string
	url?: string
	user?: { id?: number }
	language?: string
}

interface ResolvedTelegramFile {
	url: string
	name?: string
	mime?: string
	size?: number
}

interface TelegramNormalizeContext {
	session: MessageSession
	fileCache: Map<string, Promise<ResolvedTelegramFile>>
}

interface NormalizedContent {
	text: string
	parts: Part[]
	attachments: Attachment<'telegram'>[]
	rich: boolean
}

const createContext = (session: MessageSession): TelegramNormalizeContext => ({
	session,
	fileCache: new Map(),
})

const buildFileUrl = (session: MessageSession, filePath: string): string => {
	const base = session.bot.apiBase.replace(/\/+$/, '')
	const cleaned = filePath.replace(/^\/+/, '')
	return `${base}/file/bot${session.bot.token}/${cleaned}`
}

const resolveTelegramFile = async (
	ctx: TelegramNormalizeContext,
	fileId: string,
	fallbackName?: string,
	fallbackMime?: string,
	fallbackSize?: number,
): Promise<ResolvedTelegramFile> => {
	if (!ctx.fileCache.has(fileId)) {
		ctx.fileCache.set(
			fileId,
			(async () => {
				try {
					const info = await ctx.session.bot.getFile({ file_id: fileId })
					if (!info.ok || !info.data.file_path) {
						throw new Error(`getFile failed for ${fileId}`)
					}
					const url = buildFileUrl(ctx.session, info.data.file_path)
					const name = fallbackName ?? info.data.file_path.split('/').pop() ?? fileId
					return {
						url,
						name,
						mime: fallbackMime ?? undefined,
						size: info.data.file_size ?? fallbackSize,
					}
				} catch {
					return {
						url: fileId,
						name: fallbackName ?? fileId,
						mime: fallbackMime ?? undefined,
						size: fallbackSize,
					}
				}
			})(),
		)
	}
	return ctx.fileCache.get(fileId)!
}

const buildTextParts = (text: string, entities: Entity[]): Part[] => {
	if (!text) return []
	if (!entities.length) return [{ type: 'text', text }]

	const parts: Part[] = []
	let cursor = 0

	for (const entity of entities) {
		const start = entity.offset
		const end = entity.offset + entity.length
		if (start > cursor) {
			parts.push({ type: 'text', text: text.slice(cursor, start) })
		}
		const segment = text.slice(start, end)
		switch (entity.type) {
			case 'mention':
				parts.push({ type: 'mention', kind: 'user', id: segment.replace(/^@/, '') })
				break
			case 'text_mention':
				parts.push({ type: 'mention', kind: 'user', id: entity.user?.id })
				break
			case 'text_link':
				parts.push({ type: 'link', url: entity.url ?? segment, label: segment })
				break
			case 'url':
				parts.push({ type: 'link', url: segment })
				break
			case 'bold':
				parts.push({ type: 'styled', style: 'bold', children: [{ type: 'text', text: segment }] })
				break
			case 'italic':
				parts.push({ type: 'styled', style: 'italic', children: [{ type: 'text', text: segment }] })
				break
			case 'code':
				parts.push({ type: 'styled', style: 'code', children: [{ type: 'text', text: segment }] })
				break
			case 'strikethrough':
				parts.push({ type: 'styled', style: 'strike', children: [{ type: 'text', text: segment }] })
				break
			case 'pre':
				parts.push({ type: 'codeblock', code: segment, language: entity.language })
				break
			default:
				parts.push({ type: 'text', text: segment })
				break
		}
		cursor = end
	}

	if (cursor < text.length) {
		parts.push({ type: 'text', text: text.slice(cursor) })
	}

	return parts
}

const normalizeContent = async (
	message: TelegramMessage,
	ctx: TelegramNormalizeContext,
	source: 'message' | 'reference',
): Promise<NormalizedContent> => {
	const parts: Part[] = []
	const attachments: Attachment<'telegram'>[] = []

	const textRaw = message.text ?? message.caption ?? ''
	const entities = (message.entities ?? message.caption_entities ?? []) as Entity[]
	const textParts = buildTextParts(textRaw, entities)
	parts.push(...textParts)

	const textOnly = textParts.length ? telegramAdapter.render(textParts).text : textRaw

	const addAttachment = (part: Attachment<'telegram'>['part']) => {
		attachments.push({ platform: 'telegram', kind: part.type, part, source })
		parts.push(part)
	}

	if (message.photo?.length) {
		const photo = message.photo.at(-1)
		if (photo) {
			const resolved = await resolveTelegramFile(ctx, photo.file_id, photo.file_unique_id, undefined, photo.file_size)
			const part = {
				type: 'image' as const,
				url: resolved.url,
				fileId: photo.file_id,
				alt: textRaw || undefined,
				name: resolved.name,
				mime: resolved.mime,
				width: photo.width,
				height: photo.height,
				size: resolved.size,
			}
			addAttachment(part)
		}
	}

	if (message.document) {
		const resolved = await resolveTelegramFile(
			ctx,
			message.document.file_id,
			message.document.file_name,
			message.document.mime_type ?? undefined,
			message.document.file_size ?? undefined,
		)
		const part = {
			type: 'file' as const,
			url: resolved.url,
			fileId: message.document.file_id,
			name: resolved.name ?? message.document.file_name,
			mime: resolved.mime ?? message.document.mime_type ?? undefined,
			size: resolved.size ?? message.document.file_size ?? undefined,
		}
		addAttachment(part)
	}

	if (message.animation && message.animation.mime_type) {
		const resolved = await resolveTelegramFile(
			ctx,
			message.animation.file_id,
			message.animation.file_name,
			message.animation.mime_type,
			message.animation.file_size ?? undefined,
		)
		const part = {
			type: 'file' as const,
			url: resolved.url,
			fileId: message.animation.file_id,
			name: resolved.name ?? message.animation.file_name,
			mime: resolved.mime ?? message.animation.mime_type,
			size: resolved.size ?? message.animation.file_size ?? undefined,
		}
		addAttachment(part)
	}

	if (message.sticker && message.sticker.is_video === false && message.sticker.is_animated === false) {
		const resolved = await resolveTelegramFile(
			ctx,
			message.sticker.file_id,
			message.sticker.file_unique_id ? `${message.sticker.file_unique_id}.webp` : undefined,
			'image/webp',
			message.sticker.file_size ?? undefined,
		)
		const part = {
			type: 'image' as const,
			url: resolved.url,
			fileId: message.sticker.file_id,
			name: resolved.name,
			mime: resolved.mime ?? 'image/webp',
			alt: textRaw || undefined,
			size: resolved.size ?? message.sticker.file_size ?? undefined,
		}
		addAttachment(part)
	}

	const rich = hasRichParts(parts)

	return {
		text: textOnly,
		parts,
		attachments,
		rich,
	}
}

const normalizeReference = async (
	message: TelegramMessage | null | undefined,
	ctx: TelegramNormalizeContext,
	seen: Set<number>,
): Promise<MessageReference<'telegram'> | undefined> => {
	if (!message || typeof message.message_id !== 'number' || seen.has(message.message_id)) return undefined
	seen.add(message.message_id)

	const normalized = await normalizeContent(message, ctx, 'reference')

	if (message.reply_to_message) {
		const nested = await normalizeReference(message.reply_to_message, ctx, seen)
		if (nested?.attachments?.length) {
			normalized.attachments.push(...nested.attachments)
		}
	}

	const user: BotUser<'telegram'> | null = message.from
		? {
				id: message.from.id,
				username: message.from.username ?? null,
				displayName: message.from.first_name ?? message.from.username ?? null,
				avatar: null,
				isBot: typeof message.from.is_bot === 'boolean' ? message.from.is_bot : null,
			}
		: null

	return {
		platform: 'telegram',
		messageId: message.message_id ?? null,
		text: normalized.text,
		parts: normalized.parts,
		attachments: normalized.attachments,
		rich: normalized.rich,
		user,
		channel: null,
	}
}

export const normalizeTelegramMessage = async (session: MessageSession): Promise<Message<'telegram'>> => {
	const ctx = createContext(session)
	const normalized = await normalizeContent(session.message, ctx, 'message')

	const reference = await normalizeReference(session.message.reply_to_message, ctx, new Set())

	const channel: BotChannel<'telegram'> = {
		id: session.chatId,
		isPrivate: session.message.chat.type === 'private' ? true : session.message.chat.type === 'group' ? false : null,
		guildId: null,
		name: null,
	}

	const user: BotUser<'telegram'> = {
		id: session.message.from?.id ?? session.userId,
		username: session.message.from?.username ?? null,
		displayName: session.message.from?.first_name ?? session.message.from?.username ?? null,
		avatar: null,
		isBot: typeof session.message.from?.is_bot === 'boolean' ? session.message.from.is_bot : null,
	}

	const reply = createReply(telegramAdapter, session)
	const { uploadImage, uploadFile, sendText, sendImage, sendFile } = createSendHelpers(telegramAdapter, session)

	return {
		platform: 'telegram',
		text: normalized.text,
		parts: normalized.parts,
		attachments: normalized.attachments,
		reference,
		rich: normalized.rich || Boolean(reference?.rich),
		user,
		channel,
		messageId: session.message.message_id ?? null,
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
