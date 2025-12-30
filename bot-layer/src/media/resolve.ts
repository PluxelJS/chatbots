import { Buffer } from 'node:buffer'

import type { AnyMessage, AttachmentSource, MediaKind as PartMediaKind, Part, Platform } from '../types'
import { collectAttachments } from './attachments'
import { resolveAuthorAvatarImage, resolveMentionedUsers, resolveUserAvatarImage, type ResolvedAvatarImage } from './avatars'

export type CollectedMediaKind = 'avatar' | PartMediaKind
export type MediaSource = AttachmentSource | 'author' | 'mention'

export interface MediaItem<P extends Platform = Platform> {
	platform: P
	kind: CollectedMediaKind
	source: MediaSource
	part?: Extract<Part, { type: 'image' | 'audio' | 'video' | 'file' }>
	user?: { id?: string | number | null; username?: string | null; displayName?: string | null }
	/** Optional URL (may be absent for security reasons, e.g. Telegram token-file URLs). */
	url?: string
	/** Download function to get binary data. */
	fetch?: (signal?: AbortSignal) => Promise<ArrayBuffer | ArrayBufferView | Buffer>
	/** Stable key for de-duplication. */
	key?: string
}

export interface ResolvedMediaItem<P extends Platform = Platform> extends MediaItem<P> {
	data: Buffer
}

export interface CollectMediaOptions {
	includeReferences?: boolean
	includeAvatars?: boolean
	includeAuthorAvatar?: boolean
	includeMentionAvatars?: boolean
	limit?: number
	unique?: boolean
	/**
	 * Avatar preference:
	 * - `public`: never returns token-file URL; may be less accurate.
	 * - `any`: may use bot token APIs (Telegram) for higher hit rate.
	 */
	avatarPrefer?: 'public' | 'any'
}

const isAttachmentPart = (part: Part): part is Extract<Part, { type: 'image' | 'file' }> =>
	part.type === 'image' || part.type === 'file'

const toMediaKey = (item: MediaItem): string | null => {
	if (item.key) return item.key
	if (item.kind === 'avatar') return item.url ? `avatar:url:${item.url}` : null
	const part: any = item.part ?? {}
	const id = part.fileId ?? part.url ?? null
	return id ? `${item.platform}:${item.source}:${item.kind}:${id}` : null
}

const toBuffer = (input: ArrayBuffer | ArrayBufferView | Buffer): Buffer => {
	if (Buffer.isBuffer(input)) return input
	if (input instanceof ArrayBuffer) return Buffer.from(input)
	return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
}

const fetchUrl = async (url: string, signal?: AbortSignal): Promise<Buffer> => {
	const res = await fetch(url, signal ? { signal } : undefined)
	if (!res.ok) throw new Error(`bot-layer: 下载媒体失败 ${res.status} ${res.statusText}`)
	return Buffer.from(await res.arrayBuffer())
}

const normalizeLimit = (value: number | undefined): number => {
	if (value === undefined) return Number.POSITIVE_INFINITY
	const n = Math.floor(value)
	return Number.isFinite(n) && n > 0 ? n : 0
}

const pushUnique = (out: MediaItem[], seen: Set<string>, unique: boolean, item: MediaItem) => {
	const key = toMediaKey(item)
	if (unique && key) {
		if (seen.has(key)) return
		seen.add(key)
	}
	out.push(item)
}

const avatarToMedia = (
	platform: Platform,
	source: MediaSource,
	user: MediaItem['user'],
	img: ResolvedAvatarImage,
): MediaItem => {
	const key = img.cacheKey ?? (img.url ? `avatar:url:${img.url}` : null) ?? null
	return {
		platform,
		kind: 'avatar',
		source,
		user,
		url: img.source === 'token-file' ? undefined : img.url,
		key: key ?? undefined,
		fetch: async (signal) => {
			if (signal?.aborted) throw new Error('bot-layer: resolveMedia aborted')
			return img.data
		},
	}
}

export const collectMedia = async (msg: AnyMessage, opts?: CollectMediaOptions): Promise<MediaItem[]> => {
	const includeReferences = opts?.includeReferences ?? true
	const includeAvatars = opts?.includeAvatars ?? true
	const includeAuthorAvatar = opts?.includeAuthorAvatar ?? true
	const includeMentionAvatars = opts?.includeMentionAvatars ?? true
	const unique = opts?.unique ?? true
	const limit = normalizeLimit(opts?.limit)
	const avatarPrefer = opts?.avatarPrefer ?? 'public'

	const out: MediaItem[] = []
	const seen = new Set<string>()

	// image/file attachments
	const atts = collectAttachments(msg, { includeReferences })
	for (const att of atts) {
		if (out.length >= limit) break
		if (!isAttachmentPart(att.part as any)) continue
		pushUnique(out, seen, unique, {
			platform: att.platform,
			kind: att.kind,
			source: att.source,
			part: att.part as any,
			url: (att.part as any).url ?? undefined,
			fetch: att.fetch ?? (att.part.url ? (signal) => fetchUrl(att.part.url!, signal) : undefined),
		})
	}

	// avatars (author + mentions)
	if (!includeAvatars || out.length >= limit) return out

	if (includeMentionAvatars) {
		// resolveMentionedUsers already de-dupes users by default
		const mentioned = await resolveMentionedUsers(msg, { unique: true, limit })
		for (const u of mentioned) {
			if (out.length >= limit) break
			const img = await resolveUserAvatarImage(msg, u as any, { prefer: avatarPrefer })
			if (!img) continue
			const item = avatarToMedia(
				msg.platform,
				'mention',
				{ id: u.id as any, username: u.username, displayName: u.displayName },
				img,
			)
			pushUnique(out, seen, unique, item)
		}
	}

	if (includeAuthorAvatar && out.length < limit) {
		const img = await resolveAuthorAvatarImage(msg, { prefer: avatarPrefer })
		if (!img) return out
		const u = msg.user
		const item = avatarToMedia(
			msg.platform,
			'author',
			{ id: u?.id as any, username: u?.username ?? null, displayName: u?.displayName ?? null },
			img,
		)
		pushUnique(out, seen, unique, item)
	}

	return out
}

export const resolveMedia = async (items: MediaItem[], opts?: { concurrency?: number; signal?: AbortSignal }): Promise<ResolvedMediaItem[]> => {
	const signal = opts?.signal
	const concurrencyRaw = typeof opts?.concurrency === 'number' ? Math.floor(opts.concurrency) : 4
	const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 1
	if (!items.length) return []

	const results = new Array<ResolvedMediaItem>(items.length)
	let cursor = 0

	const throwIfAborted = () => {
		if (signal?.aborted) throw new Error('bot-layer: resolveMedia aborted')
	}

	const run = async () => {
		while (true) {
			throwIfAborted()
			const index = cursor++
			if (index >= items.length) return
			const item = items[index]
			let data: Buffer | null = null
			if (item.fetch) {
				data = toBuffer(await item.fetch(signal))
			} else if (item.url) {
				data = await fetchUrl(item.url, signal)
			} else if (item.part && (item.part as any).data) {
				data = toBuffer((item.part as any).data)
			}
			if (!data) throw new Error('bot-layer: media 无可用下载方式')
			results[index] = { ...item, data }
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
	return results
}
