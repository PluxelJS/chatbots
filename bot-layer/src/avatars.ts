import { Buffer } from 'node:buffer'

import type { AnyMessage, BotUser, MentionPart, Platform, PlatformRegistry } from './types'

export interface ResolvedUserProfile<P extends Platform = Platform> {
	platform: P
	id: PlatformRegistry[P]['userId']
	username: string | null
	displayName: string | null
	avatar: string | null
	isBot: boolean | null
	raw?: unknown
}

export interface ResolvedAvatarImage {
	data: Buffer
	mime?: string
	name?: string
	url?: string
	/**
	 * Stable dedupe/cache key that never contains secrets.
	 * Prefer this over `url` for de-duplication.
	 */
	cacheKey?: string
	/** Where the avatar came from (best-effort). */
	source?: 'public' | 'token-file' | 'unknown'
}

export type AvatarTraceEvent =
	| { kind: 'start'; platform: Platform; prefer: 'public' | 'any'; ref: { id?: unknown; username?: string | null } }
	| { kind: 'try'; step: 'telegram.getUserProfilePhotos' | 'telegram.userpic' }
	| { kind: 'ok'; step: string; source?: ResolvedAvatarImage['source']; cacheKey?: string }
	| { kind: 'miss'; step: string; reason?: string }
	| { kind: 'error'; step: string; message: string }
	| { kind: 'fetch'; ok: boolean; status?: number; note?: string }

export type UserRef =
	| string
	| number
	| (Partial<Omit<ResolvedUserProfile, 'platform'>> & { id?: string | number | null })
	| MentionPart

export interface ResolveMessageUsersOptions {
	includeAuthor?: boolean
	includeMentions?: boolean
	includeReference?: boolean
	limit?: number
	unique?: boolean
}

export interface ResolvedMessageUsers {
	author: ResolvedUserProfile | null
	mentions: ResolvedUserProfile[]
	reference: ResolvedUserProfile | null
	all: ResolvedUserProfile[]
}

export interface ResolveMentionedUsersOptions {
	limit?: number
	unique?: boolean
}

const buildTelegramFileUrl = (bot: any, filePath: string): string => {
	const base = bot.apiBase
	const cleanedBase = base.replace(/\/+$/, '')
	const cleanedPath = filePath.replace(/^\/+/, '')
	return `${cleanedBase}/file/bot${bot.token}/${cleanedPath}`
}

const normalizeUserRef = (ref: UserRef | null | undefined) => {
	if (ref === null || ref === undefined) return {}
	if (typeof ref === 'string' || typeof ref === 'number') return { id: ref }
	const anyRef = ref as Partial<ResolvedUserProfile> & { id?: string | number | null }
	return {
		id: anyRef.id ?? null,
		username: anyRef.username ?? null,
		displayName: anyRef.displayName ?? null,
		avatar: anyRef.avatar ?? null,
		isBot: anyRef.isBot ?? null,
		raw: anyRef.raw,
	}
}

const resolveName = (value?: string | null) => {
	const trimmed = value?.trim()
	return trimmed ? trimmed : null
}

const toTelegramNumericId = (idRaw: unknown): number | null => {
	if (typeof idRaw === 'number' && Number.isFinite(idRaw) && idRaw > 0) return idRaw
	if (typeof idRaw === 'string' && /^\d+$/.test(idRaw)) {
		const num = Number(idRaw)
		return Number.isFinite(num) && num > 0 ? num : null
	}
	return null
}

const buildTelegramUserpicUrl = (username: string): string =>
	`https://t.me/i/userpic/320/${encodeURIComponent(username)}.jpg`

type NormalizedUserRef = ReturnType<typeof normalizeUserRef>

const fetchBuffer = async (
	url: string,
	signal?: AbortSignal,
	trace?: (event: AvatarTraceEvent) => void,
	note?: string,
): Promise<Buffer | null> => {
	try {
		const res = await fetch(url, {
			signal,
			headers: {
				accept: 'image/*,*/*;q=0.8',
				'user-agent': 'pluxel-bot-layer/1',
			},
		})
		trace?.({ kind: 'fetch', ok: res.ok, status: res.status, note })
		if (!res.ok) return null
		return Buffer.from(await res.arrayBuffer())
	} catch {
		trace?.({ kind: 'fetch', ok: false, note })
		return null
	}
}

const resolveTelegramAvatarImage = async (
	msg: AnyMessage,
	ref: NormalizedUserRef,
	opts?: {
		signal?: AbortSignal
		prefer?: 'public' | 'any'
		trace?: (event: AvatarTraceEvent) => void
	},
): Promise<ResolvedAvatarImage | null> => {
	const bot: any = msg.bot
	const prefer = opts?.prefer ?? 'any'
	const signal = opts?.signal
	const trace = opts?.trace
	trace?.({ kind: 'start', platform: 'telegram', prefer, ref: { id: ref.id, username: resolveName(ref.username) } })

	const idRaw = ref.id
	const numericId = toTelegramNumericId(idRaw)
	let username =
		resolveName(ref.username) ??
		(typeof idRaw === 'string' && numericId === null ? resolveName(idRaw.replace(/^@/, '')) : null)

	const fetchByFileId = async (fileId: string): Promise<ResolvedAvatarImage | null> => {
		if (!fileId) return null
		try {
			const file = await bot.getFile({ file_id: fileId })
			const path = file?.ok ? file.data?.file_path : null
			if (!path) return null
			const url = buildTelegramFileUrl(bot, path)
			const data = await fetchBuffer(url, signal, trace, 'telegram:file')
			if (!data) return null
			// Never expose token URL by default; use file_id as stable key instead.
			return {
				data,
				name: path.split('/').pop() ?? undefined,
				cacheKey: `telegram:file:${fileId}`,
				source: 'token-file',
				url: prefer === 'any' ? url : undefined,
			}
		} catch {
			return null
		}
	}

	// Prefer public userpic if requested.
	if (prefer === 'public' && username) {
		trace?.({ kind: 'try', step: 'telegram.userpic' })
		const url = buildTelegramUserpicUrl(username)
		const data = await fetchBuffer(url, signal, trace, `telegram:userpic:${username.toLowerCase()}`)
		if (data) {
			const img = { data, url, mime: 'image/jpeg', name: `${username}.jpg`, cacheKey: `telegram:userpic:${username.toLowerCase()}`, source: 'public' } satisfies ResolvedAvatarImage
			trace?.({ kind: 'ok', step: 'telegram.userpic', source: img.source, cacheKey: img.cacheKey })
			return img
		}
		trace?.({ kind: 'miss', step: 'telegram.userpic', reason: 'no response / not found' })
	}

	// Best effort: profile photos API by numeric user_id (requires bot token).
	if (prefer === 'any' && numericId !== null) {
		trace?.({ kind: 'try', step: 'telegram.getUserProfilePhotos' })
		try {
			const photos = await bot.getUserProfilePhotos({ user_id: numericId, limit: 1 })
			if (!photos?.ok) {
				trace?.({ kind: 'miss', step: 'telegram.getUserProfilePhotos', reason: `not ok: ${photos?.message ?? 'unknown'}` })
				// keep going
			}
			const totalCount = photos?.ok ? (photos.data as any)?.total_count : undefined
			const list = photos?.ok ? photos.data?.photos : null
			const sizes = list?.length ? list[0] : null
			const best = Array.isArray(sizes) ? sizes[sizes.length - 1] : null
			const res = best?.file_id ? await fetchByFileId(best.file_id) : null
			if (res) {
				trace?.({ kind: 'ok', step: 'telegram.getUserProfilePhotos', source: res.source, cacheKey: res.cacheKey })
				return res
			}
			trace?.({
				kind: 'miss',
				step: 'telegram.getUserProfilePhotos',
				reason: best?.file_id ? 'file fetch failed' : `no photos${typeof totalCount === 'number' ? ` total_count=${totalCount}` : ''}`,
			})
		} catch (e) {
			// ignore
			trace?.({
				kind: 'error',
				step: 'telegram.getUserProfilePhotos',
				message: e instanceof Error ? e.message : String(e),
			})
		}
	}

	return null
}

type ProfilePatch = {
	username: string | null
	displayName: string | null
	avatar: string | null
	isBot: boolean | null
	raw?: unknown
}

const buildProfilePatch = (ref: NormalizedUserRef): ProfilePatch => ({
	username: resolveName(ref.username),
	displayName: resolveName(ref.displayName),
	avatar: resolveName(ref.avatar),
	isBot: ref.isBot ?? null,
	raw: ref.raw,
})

const applyProfilePatch = (profile: ResolvedUserProfile | null, patch: ProfilePatch) => {
	if (!profile) return
	if (profile.username === null && patch.username !== null) profile.username = patch.username
	if (profile.displayName === null && patch.displayName !== null) profile.displayName = patch.displayName
	if (profile.avatar === null && patch.avatar !== null) profile.avatar = patch.avatar
	if (profile.isBot === null && patch.isBot !== null) profile.isBot = patch.isBot
	if (profile.raw === undefined && patch.raw !== undefined) profile.raw = patch.raw
}

const PROFILE_CACHE = new WeakMap<AnyMessage, Map<string, Promise<ResolvedUserProfile | null>>>()
const AVATAR_IMAGE_CACHE = new WeakMap<AnyMessage, Map<string, Promise<ResolvedAvatarImage | null>>>()

const getProfileCache = (msg: AnyMessage) => {
	let cache = PROFILE_CACHE.get(msg)
	if (!cache) {
		cache = new Map()
		PROFILE_CACHE.set(msg, cache)
	}
	return cache
}

const buildProfileCacheKey = (platform: Platform, ref: NormalizedUserRef): string | null => {
	const id = ref.id
	if (typeof id === 'number') {
		if (!Number.isFinite(id)) return null
		if (platform === 'telegram' && id <= 0) return null
		return `${platform}:id:${id}`
	}
	if (typeof id === 'string') {
		const trimmed = id.trim()
		if (trimmed) {
			if (/^\d+$/.test(trimmed)) return `${platform}:id:${trimmed}`
			if (trimmed.startsWith('@')) return `${platform}:username:${trimmed.slice(1).toLowerCase()}`
			return `${platform}:id:${trimmed}`
		}
	}
	const username = resolveName(ref.username)
	return username ? `${platform}:username:${username.toLowerCase()}` : null
}

const mergeTelegramProfile = (
	base: ResolvedUserProfile<'telegram'> | null,
	patch: Partial<ResolvedUserProfile<'telegram'>>,
): ResolvedUserProfile<'telegram'> | null => {
	if (!base) {
		if (typeof patch.id !== 'number') return null
		return {
			platform: 'telegram',
			id: patch.id,
			username: patch.username ?? null,
			displayName: patch.displayName ?? null,
			avatar: patch.avatar ?? null,
			isBot: patch.isBot ?? null,
			raw: patch.raw,
		}
	}
	if (base.username === null && patch.username !== undefined) base.username = patch.username ?? null
	if (base.displayName === null && patch.displayName !== undefined) base.displayName = patch.displayName ?? null
	if (base.avatar === null && patch.avatar !== undefined) base.avatar = patch.avatar ?? null
	if (base.isBot === null && patch.isBot !== undefined) base.isBot = patch.isBot ?? null
	if (base.raw === undefined && patch.raw !== undefined) base.raw = patch.raw
	return base
}

const toProfile = <P extends Platform>(
	platform: P,
	user: BotUser<P>,
	raw?: unknown,
): ResolvedUserProfile<P> => ({
	platform,
	id: user.id,
	username: user.username ?? null,
	displayName: user.displayName ?? null,
	avatar: user.avatar ?? null,
	isBot: user.isBot ?? null,
	raw,
})

const resolveUserProfileUncached = async (
	msg: AnyMessage,
	ref: NormalizedUserRef,
	patch: ProfilePatch,
): Promise<ResolvedUserProfile | null> => {
	const baseUsername = patch.username
	const baseDisplayName = patch.displayName
	const baseAvatar = patch.avatar
	const baseIsBot = patch.isBot

	if (msg.platform === 'kook') {
		const id = ref.id != null ? String(ref.id) : null
		if (!id) return null

		const profile: ResolvedUserProfile<'kook'> = {
			platform: 'kook',
			id,
			username: baseUsername,
			displayName: baseDisplayName,
			avatar: baseAvatar,
			isBot: baseIsBot,
			raw: patch.raw,
		}

		if (profile.avatar && profile.username && profile.displayName && profile.isBot !== null) {
			return profile
		}

		try {
			const res = await bot.getUserView({
				user_id: id,
				guild_id: msg.channel.guildId ?? undefined,
			})
			if (!res?.ok) return profile
			const data = res.data
			profile.username ??= data?.username ?? null
			profile.displayName ??= data?.nickname ?? data?.username ?? null
			profile.avatar ??= data?.avatar ?? data?.vip_avatar ?? null
			if (profile.isBot === null && typeof data?.bot === 'boolean') profile.isBot = data.bot
			profile.raw ??= data
			return profile
		} catch {
			return profile
		}
	}

	if (msg.platform === 'telegram') {
		const bot: any = msg.bot
		const idRaw = ref.id
		const numericId = toTelegramNumericId(idRaw)
		const username =
			baseUsername ??
			(typeof idRaw === 'string' && numericId === null ? resolveName(idRaw.replace(/^@/, '')) : null)

		let profile: ResolvedUserProfile<'telegram'> | null = null
		if (numericId !== null) {
			profile = mergeTelegramProfile(profile, {
				id: numericId,
				username: baseUsername,
				displayName: baseDisplayName,
				avatar: baseAvatar,
				isBot: baseIsBot,
				raw: patch.raw,
			})
		}

		const needsIdentity = !profile || profile.username === null || profile.displayName === null || profile.isBot === null
		const needsAvatar = !profile || profile.avatar === null

		const applyChatPhoto = async (fileId: string, id: number) => {
			try {
				const file = await bot.getFile({ file_id: fileId })
				const path = file?.ok ? file.data?.file_path : null
				if (path) {
					profile = mergeTelegramProfile(profile, { avatar: buildTelegramFileUrl(bot, path), id })
				}
			} catch {
				// ignore
			}
		}

		if (numericId !== null && needsIdentity) {
			try {
				const res = await bot.getChatMember({ chat_id: msg.channel.id, user_id: numericId })
				const userInfo = res?.ok ? res.data?.user : null
				if (userInfo) {
					profile = mergeTelegramProfile(profile, {
						id: numericId,
						username: userInfo.username ?? baseUsername ?? null,
						displayName: resolveName(
							[userInfo.first_name, userInfo.last_name].filter(Boolean).join(' ') || userInfo.username,
						),
						isBot: typeof userInfo.is_bot === 'boolean' ? userInfo.is_bot : baseIsBot,
						raw: userInfo,
					})
				}
			} catch {
				// ignore
			}
		}

		if (numericId !== null && (needsIdentity || needsAvatar)) {
			try {
				const chat = await bot.getChat({ chat_id: numericId })
				const data = chat?.ok ? chat.data : null
				if (data) {
					profile = mergeTelegramProfile(profile, {
						id: typeof data.id === 'number' ? data.id : numericId,
						username: data.username ?? baseUsername ?? null,
						displayName: resolveName(data.title ?? data.first_name ?? data.username ?? null),
						raw: data,
					})
					if (needsAvatar && data.photo) {
						const fileId = data.photo.big_file_id ?? data.photo.small_file_id
						if (fileId) await applyChatPhoto(fileId, numericId)
					}
				}
			} catch {
				// ignore
			}
		}

		if (numericId !== null && needsAvatar) {
			try {
				const photos = await bot.getUserProfilePhotos({ user_id: numericId, limit: 1 })
				const list = photos?.ok ? photos.data?.photos : null
				if (list?.length) {
					const sizes = list[0]
					const best = Array.isArray(sizes) ? sizes[sizes.length - 1] : null
					if (best?.file_id) await applyChatPhoto(best.file_id, numericId)
				}
			} catch {
				// ignore
			}
		}

		if (!profile && username) {
			try {
				const chat = await bot.getChat({ chat_id: `@${username}` })
				const data = chat?.ok ? chat.data : null
				if (data && typeof data.id === 'number') {
					profile = mergeTelegramProfile(profile, {
						id: data.id,
						username: data.username ?? username ?? null,
						displayName: resolveName(data.title ?? data.first_name ?? data.username ?? null),
						raw: data,
					})
					const photo = data.photo
					const fileId = photo?.big_file_id ?? photo?.small_file_id
					if (fileId) await applyChatPhoto(fileId, data.id)
				}
			} catch {
				// ignore
			}
		}

		return profile
	}

	return null
}

export const resolveUserProfile = async (
	msg: AnyMessage,
	user: UserRef,
): Promise<ResolvedUserProfile | null> => {
	const ref = normalizeUserRef(user)
	const patch = buildProfilePatch(ref)
	const cacheKey = buildProfileCacheKey(msg.platform, ref)
	const cache = cacheKey ? getProfileCache(msg) : null

	const cached = cacheKey ? cache?.get(cacheKey) : undefined
	if (cached) {
		const profile = await cached
		applyProfilePatch(profile, patch)
		return profile
	}

	const promise = resolveUserProfileUncached(msg, ref, patch).catch((err) => {
		if (cacheKey && cache) cache.delete(cacheKey)
		throw err
	})
	if (cacheKey && cache) cache.set(cacheKey, promise)
	const resolved = await promise
	if (cacheKey && cache && !resolved) cache.delete(cacheKey)
	applyProfilePatch(resolved, patch)
	return resolved
}

export const resolveUserAvatarUrl = async (
	msg: AnyMessage,
	user: UserRef,
): Promise<string | null> => {
	const ref = normalizeUserRef(user)
	const direct = resolveName(ref.avatar)
	if (direct) return direct
	const profile = await resolveUserProfile(msg, user)
	const avatar = profile?.avatar ?? null
	if (avatar) return avatar
	if (msg.platform === 'telegram') {
		const username = resolveName(ref.username) ?? resolveName(profile?.username)
		if (username) return buildTelegramUserpicUrl(username)
	}
	return null
}

export const resolveUserAvatarImage = async (
	msg: AnyMessage,
	user: UserRef,
	opts?: {
		signal?: AbortSignal
		prefer?: 'public' | 'any'
		trace?: (event: AvatarTraceEvent) => void
	},
): Promise<ResolvedAvatarImage | null> => {
	const ref = normalizeUserRef(user)
	const prefer = opts?.prefer ?? 'any'
	const signal = opts?.signal
	const trace = opts?.trace

	const cacheKey = (() => {
		if (signal) return null
		const key = buildProfileCacheKey(msg.platform, ref)
		return key ? `avatar:image:${prefer}:${key}` : null
	})()

	const getAvatarCache = (m: AnyMessage) => {
		let map = AVATAR_IMAGE_CACHE.get(m)
		if (!map) {
			map = new Map()
			AVATAR_IMAGE_CACHE.set(m, map)
		}
		return map
	}

	if (cacheKey) {
		const map = getAvatarCache(msg)
		const cached = map.get(cacheKey)
		if (cached) return cached
		const promise = (async () => {
			if (msg.platform === 'telegram') {
				const res = await resolveTelegramAvatarImage(msg, ref, { signal, prefer, trace })
				if (res) return res
			}
			const url = await resolveUserAvatarUrl(msg, user)
			if (!url) return null
			const data = await fetchBuffer(url, signal, trace, 'generic:url')
			if (!data) return null
			return { data, url, cacheKey: `url:${url}`, source: 'unknown' }
		})()
			.catch((err) => {
				map.delete(cacheKey)
				throw err
			})
		map.set(cacheKey, promise)
		const resolved = await promise
		if (!resolved) map.delete(cacheKey)
		return resolved
	}

	if (msg.platform === 'telegram') {
		const res = await resolveTelegramAvatarImage(msg, ref, { signal, prefer, trace })
		if (res) return res
	}

	const url = await resolveUserAvatarUrl(msg, user)
	if (!url) return null
	const data = await fetchBuffer(url, signal, trace, 'generic:url')
	if (!data) return null
	return { data, url, cacheKey: `url:${url}`, source: 'unknown' }
}

export const resolveAuthorProfile = async (msg: AnyMessage): Promise<ResolvedUserProfile | null> => {
	const base = toProfile(msg.platform, msg.user as any)
	if (base.avatar) return base
	let resolved = await resolveUserProfile(msg, msg.user as any)

	if (msg.platform === 'telegram' && !resolved?.avatar && msg.channel?.isPrivate === true) {
		const fallbackId = toTelegramNumericId(msg.channel.id)
		const authorId = toTelegramNumericId(base.id as any)
		if (fallbackId && (!authorId || fallbackId !== authorId)) {
			const fallback = await resolveUserProfile(msg, fallbackId)
			if (fallback?.avatar) resolved = fallback
		}
	}

	if (!resolved) return base
	return {
		...resolved,
		username: base.username ?? resolved.username,
		displayName: base.displayName ?? resolved.displayName,
		isBot: base.isBot ?? resolved.isBot,
	}
}

export const resolveAuthorAvatarUrl = async (msg: AnyMessage): Promise<string | null> => {
	const profile = await resolveAuthorProfile(msg)
	const avatar = profile?.avatar ?? null
	if (avatar) return avatar
	if (msg.platform === 'telegram') {
		const username = resolveName(profile?.username ?? msg.user?.username ?? null)
		if (username) return buildTelegramUserpicUrl(username)
	}
	return null
}

export const resolveAuthorAvatarImage = async (
	msg: AnyMessage,
	opts?: { signal?: AbortSignal; prefer?: 'public' | 'any'; trace?: (event: AvatarTraceEvent) => void },
): Promise<ResolvedAvatarImage | null> => resolveUserAvatarImage(msg, msg.user as any, opts)

export const resolveMentionedUsers = async (
	msg: AnyMessage,
	opts?: ResolveMentionedUsersOptions,
): Promise<ResolvedUserProfile[]> => {
	const limit = opts?.limit ?? Number.POSITIVE_INFINITY
	const unique = opts?.unique ?? true
	const out: ResolvedUserProfile[] = []
	const seen = new Set<string>()

	const mentions = msg.mentions?.length ? msg.mentions : msg.parts
	for (const part of mentions) {
		if (out.length >= limit) break
		if (part.type !== 'mention' || part.kind !== 'user') continue
		if (part.id === undefined || part.id === null) {
			if (!part.username) continue
		}
		const profile = await resolveUserProfile(msg, part as MentionPart)
		if (!profile) continue
		if (unique) {
			const key = `${profile.platform}:${String(profile.id)}`
			if (seen.has(key)) continue
			seen.add(key)
		}
		out.push(profile)
	}

	return out
}

export const resolveMessageUsers = async (
	msg: AnyMessage,
	opts?: ResolveMessageUsersOptions,
): Promise<ResolvedMessageUsers> => {
	const includeAuthor = opts?.includeAuthor ?? true
	const includeMentions = opts?.includeMentions ?? true
	const includeReference = opts?.includeReference ?? false
	const unique = opts?.unique ?? true
	const limit = opts?.limit ?? Number.POSITIVE_INFINITY

	const all: ResolvedUserProfile[] = []
	const seen = new Set<string>()

	const push = (profile: ResolvedUserProfile | null) => {
		if (!profile) return
		if (all.length >= limit) return
		if (unique) {
			const key = `${profile.platform}:${String(profile.id)}`
			if (seen.has(key)) return
			seen.add(key)
		}
		all.push(profile)
	}

	const author = includeAuthor ? await resolveAuthorProfile(msg) : null
	if (author) push(author)

	const mentions = includeMentions ? await resolveMentionedUsers(msg, { limit }) : []
	for (const m of mentions) {
		if (all.length >= limit) break
		push(m)
	}

	let reference: ResolvedUserProfile | null = null
	if (includeReference && msg.reference?.user) {
		reference = toProfile(msg.platform, msg.reference.user as any)
		if (!reference.avatar && msg.reference.user.id != null) {
			reference = await resolveUserProfile(msg, msg.reference.user.id as any)
		}
		push(reference)
	}

	return {
		author,
		mentions,
		reference,
		all,
	}
}
