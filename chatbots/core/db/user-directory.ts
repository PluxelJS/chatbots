import type { EntityManager } from 'pluxel-plugin-mikro-orm/mikro-orm/core'
import type { MikroOrm, MikroOrmEntityBatch } from 'pluxel-plugin-mikro-orm'

import type { AnyMessage, Platform } from '@pluxel/bot-layer'
import type { UnifiedIdentity, UnifiedPlatformUserId, UnifiedUser } from '../types'
import type { LinkTokenRow, UnifiedIdentityRow, UnifiedUserRow } from './schemas'
import { LinkTokenSchema, UnifiedIdentitySchema, UnifiedUserSchema } from './schemas'

type Entities = {
	user: { entityName: string }
	identity: { entityName: string }
	token: { entityName: string }
}

export type LinkConsumeResult =
	| { ok: true; userId: number }
	| { ok: false; reason: 'not_found' | 'expired' | 'consumed' | 'conflict'; message: string }

export class UserDirectory {
	private constructor(
		private readonly mikro: MikroOrm,
		private readonly entities: Entities,
		private readonly options: { cacheTtlMs: number; cacheMax: number },
	) {}

	private readonly cache = new Map<
		string,
		{ expiresAt: number; value: { user: UnifiedUser; identity: UnifiedIdentity } }
	>()
	private readonly cacheKeysByUserId = new Map<number, Set<string>>()
	private readonly inflight = new Map<string, Promise<{ user: UnifiedUser; identity: UnifiedIdentity }>>()

	static async create(
		mikro: MikroOrm,
		options: { cacheTtlMs?: number; cacheMax?: number } = {},
	): Promise<{ dir: UserDirectory; batch: MikroOrmEntityBatch }> {
		const batch = await mikro.registerEntities([UnifiedUserSchema, UnifiedIdentitySchema, LinkTokenSchema])
		const [user, identity, token] = batch.entities
		const normalized = {
			cacheTtlMs: Math.max(0, Math.floor(options.cacheTtlMs ?? 10_000)),
			cacheMax: Math.max(0, Math.floor(options.cacheMax ?? 2000)),
		}
		return {
			dir: new UserDirectory(mikro, {
				user: { entityName: user!.entityName },
				identity: { entityName: identity!.entityName },
				token: { entityName: token!.entityName },
			}, normalized),
			batch,
		}
	}

	private normalizePlatformUserId(platform: Platform, userId: AnyMessage['user']['id']): UnifiedPlatformUserId {
		// telegram userId 是 number；kook 是 string。统一用 string 存储，便于跨平台/索引/unique。
		if (platform === 'telegram') return String(userId)
		return String(userId)
	}

	private async now(): Promise<Date> {
		return new Date()
	}

	private async em(): Promise<EntityManager> {
		return await this.mikro.em()
	}

	async ensureUserForMessage(msg: AnyMessage): Promise<{ user: UnifiedUser; identity: UnifiedIdentity }> {
		const platform = msg.platform
		const platformUserId = this.normalizePlatformUserId(platform, msg.user.id as any)
		const identity = { platform, platformUserId }
		const displayName = normalizeDisplayName(msg.user.displayName ?? msg.user.username ?? null)

		const cacheKey = `${platform}:${platformUserId}`
		const cached = this.getCached(cacheKey)
		if (cached) {
			if (displayName && cached.user.displayName !== displayName) {
				await this.updateUserDisplayName(cached.user.id, displayName)
				const updated = { user: { ...cached.user, displayName }, identity: cached.identity }
				this.setCached(cacheKey, updated)
				return updated
			}
			return cached
		}

		const pending = this.inflight.get(cacheKey)
		if (pending) return await pending

		const promise = this.ensureUserForIdentityUncached(identity, displayName).finally(() => {
			this.inflight.delete(cacheKey)
		})
		this.inflight.set(cacheKey, promise)
		const resolved = await promise
		if (displayName && resolved.user.displayName !== displayName) {
			await this.updateUserDisplayName(resolved.user.id, displayName)
			resolved.user = { ...resolved.user, displayName }
		}
		this.setCached(cacheKey, resolved)
		return resolved
	}

	private async ensureUserForIdentityUncached(
		identity: UnifiedIdentity,
		displayName: string | null,
	): Promise<{ user: UnifiedUser; identity: UnifiedIdentity }> {
		const em = await this.em()
		const existing = (await em.findOne<UnifiedIdentityRow>(
			this.entities.identity.entityName as any,
			{ platform: identity.platform, platformUserId: identity.platformUserId },
		)) as UnifiedIdentityRow | null

		if (existing) {
			const userRow = (await em.findOne<UnifiedUserRow>(
				this.entities.user.entityName as any,
				{ id: existing.userId },
			)) as UnifiedUserRow | null
			if (!userRow) {
				// 数据损坏：创建一个新 user 并重绑定 identity
				const created = await this.createUserWithIdentity(em, identity, displayName)
				return created
			}
			const full = await this.loadUserById(em, userRow.id)
			return { user: full, identity }
		}

		const created = await this.createUserWithIdentity(em, identity, displayName)
		return created
	}

	private getCached(key: string) {
		const rec = this.cache.get(key)
		if (!rec) return undefined
		if (rec.expiresAt > Date.now()) {
			// LRU: refresh
			this.cache.delete(key)
			this.cache.set(key, rec)
			return rec.value
		}
		this.evictKey(key, rec.value.user.id)
		return undefined
	}

	private setCached(key: string, value: { user: UnifiedUser; identity: UnifiedIdentity }) {
		if (this.options.cacheMax <= 0 || this.options.cacheTtlMs <= 0) return
		// overwrite / refresh: remove old mapping first
		const prev = this.cache.get(key)
		if (prev) this.evictKey(key, prev.value.user.id)

		const expiresAt = Date.now() + this.options.cacheTtlMs
		this.cache.set(key, { expiresAt, value })
		let keys = this.cacheKeysByUserId.get(value.user.id)
		if (!keys) {
			keys = new Set()
			this.cacheKeysByUserId.set(value.user.id, keys)
		}
		keys.add(key)

		while (this.cache.size > this.options.cacheMax) {
			const oldestKey = this.cache.keys().next().value as string | undefined
			if (!oldestKey) break
			const oldest = this.cache.get(oldestKey)
			if (oldest) this.evictKey(oldestKey, oldest.value.user.id)
			else this.cache.delete(oldestKey)
		}
	}

	private evictKey(key: string, userId: number) {
		this.cache.delete(key)
		const keys = this.cacheKeysByUserId.get(userId)
		if (!keys) return
		keys.delete(key)
		if (keys.size === 0) this.cacheKeysByUserId.delete(userId)
	}

	private invalidateUserId(userId: number) {
		const keys = this.cacheKeysByUserId.get(userId)
		if (!keys) return
		for (const key of keys) this.cache.delete(key)
		this.cacheKeysByUserId.delete(userId)
	}

	private invalidateIdentity(platform: Platform, platformUserId: UnifiedPlatformUserId) {
		const key = `${platform}:${platformUserId}`
		const rec = this.cache.get(key)
		if (rec) this.evictKey(key, rec.value.user.id)
	}

	private async createUserWithIdentity(
		em: EntityManager,
		identity: UnifiedIdentity,
		displayName: string | null,
	): Promise<{ user: UnifiedUser; identity: UnifiedIdentity }> {
		const now = await this.now()
		try {
			return await em.transactional(async (tx) => {
				const user = { createdAt: now, displayName } as Omit<UnifiedUserRow, 'id'>
				const userId = (await tx.insert(this.entities.user.entityName as any, user)) as unknown as number

				const identityRow: Omit<UnifiedIdentityRow, 'id'> = {
					userId,
					platform: identity.platform,
					platformUserId: identity.platformUserId,
					createdAt: now,
				}
				await tx.insert(this.entities.identity.entityName as any, identityRow)
				const userFull = await this.loadUserById(tx, userId)
				return { user: userFull, identity }
			})
		} catch (e) {
			// 并发情况下可能被 unique 抢先插入；回退到读取。
			const fallback = (await em.findOne<UnifiedIdentityRow>(
				this.entities.identity.entityName as any,
				{ platform: identity.platform, platformUserId: identity.platformUserId },
			)) as UnifiedIdentityRow | null
			if (fallback) {
				const userFull = await this.loadUserById(em, fallback.userId)
				return { user: userFull, identity }
			}
			throw e
		}
	}

	private async loadUserById(em: EntityManager, userId: number): Promise<UnifiedUser> {
		const userRow = (await em.findOne<UnifiedUserRow>(
			this.entities.user.entityName as any,
			{ id: userId },
		)) as UnifiedUserRow | null
		if (!userRow) throw new Error(`UnifiedUser not found: ${userId}`)

		const identities = (await em.find<UnifiedIdentityRow>(
			this.entities.identity.entityName as any,
			{ userId },
			{ orderBy: { id: 'asc' } as any },
		)) as UnifiedIdentityRow[]

		return {
			id: userRow.id,
			displayName: userRow.displayName ?? null,
			createdAt: userRow.createdAt,
			identities: identities.map((i) => ({
				platform: i.platform as any,
				platformUserId: i.platformUserId,
			})),
		}
	}

	async getUserById(userId: number): Promise<UnifiedUser | null> {
		const em = await this.em()
		const row = (await em.findOne<UnifiedUserRow>(
			this.entities.user.entityName as any,
			{ id: userId },
		)) as UnifiedUserRow | null
		if (!row) return null
		return await this.loadUserById(em, userId)
	}

	async findUserByIdentity(
		platform: Platform,
		platformUserId: UnifiedPlatformUserId,
	): Promise<UnifiedUser | null> {
		const normalized = this.normalizePlatformUserId(platform, platformUserId as any)
		const cacheKey = `${platform}:${normalized}`
		const cached = this.getCached(cacheKey)
		if (cached) return cached.user

		const em = await this.em()
		const identity = (await em.findOne<UnifiedIdentityRow>(
			this.entities.identity.entityName as any,
			{ platform, platformUserId: normalized },
		)) as UnifiedIdentityRow | null
		if (!identity) return null
		const user = await this.loadUserById(em, identity.userId)
		this.setCached(cacheKey, { user, identity: { platform, platformUserId: normalized } })
		return user
	}

	async searchUsersByName(query: string, limit = 20): Promise<UnifiedUser[]> {
		const needle = normalizeDisplayName(query)
		if (!needle) return []
		const em = await this.em()
		const rows = (await em.find<UnifiedUserRow>(
			this.entities.user.entityName as any,
			{ displayName: { $like: `%${needle}%` } as any },
			{ orderBy: { id: 'asc' } as any, limit: Math.max(1, Math.floor(limit)) },
		)) as UnifiedUserRow[]
		if (!rows.length) return []

		const ids = rows.map((r) => r.id)
		const identities = (await em.find<UnifiedIdentityRow>(
			this.entities.identity.entityName as any,
			{ userId: { $in: ids } as any },
			{ orderBy: { id: 'asc' } as any },
		)) as UnifiedIdentityRow[]
		const byUser = new Map<number, UnifiedIdentityRow[]>()
		for (const identity of identities) {
			const bucket = byUser.get(identity.userId)
			if (bucket) bucket.push(identity)
			else byUser.set(identity.userId, [identity])
		}

		return rows.map((row) => ({
			id: row.id,
			displayName: row.displayName ?? null,
			createdAt: row.createdAt,
			identities: (byUser.get(row.id) ?? []).map((i) => ({
				platform: i.platform as any,
				platformUserId: i.platformUserId,
			})),
		}))
	}

	async updateUserDisplayName(userId: number, displayName: string | null): Promise<void> {
		const em = await this.em()
		const normalized = normalizeDisplayName(displayName)
		await em.nativeUpdate(
			this.entities.user.entityName as any,
			{ id: userId },
			{ displayName: normalized },
		)
		this.invalidateUserId(userId)
	}

	async createLinkToken(userId: number, ttlSeconds: number): Promise<{ code: string; expiresAt: Date }> {
		const em = await this.em()
		const now = await this.now()
		const expiresAt = new Date(now.getTime() + Math.max(1, ttlSeconds) * 1000)

		for (let attempt = 0; attempt < 5; attempt++) {
			const code = randomCode()
			try {
				const row: Omit<LinkTokenRow, 'id'> = {
					userId,
					code,
					createdAt: now,
					expiresAt,
					consumedAt: null,
				}
				await em.insert(this.entities.token.entityName as any, row)
				return { code, expiresAt }
			} catch {
				// code unique 冲突：重试
			}
		}
		throw new Error('failed to generate link code (too many collisions)')
	}

	async consumeLinkToken(
		code: string,
		targetPlatform: Platform,
		targetPlatformUserId: UnifiedPlatformUserId,
	): Promise<LinkConsumeResult> {
		const em = await this.em()
		const now = await this.now()
		const result = await em.transactional(async (tx) => {
			const token = (await tx.findOne<LinkTokenRow>(
				this.entities.token.entityName as any,
				{ code },
			)) as LinkTokenRow | null
			if (!token) return { ok: false, reason: 'not_found', message: 'Link code not found.' } as const
			if (token.consumedAt) return { ok: false, reason: 'consumed', message: 'Link code already consumed.' } as const
			if (token.expiresAt.getTime() <= now.getTime()) {
				return { ok: false, reason: 'expired', message: 'Link code expired.' } as const
			}

			const existing = (await tx.findOne<UnifiedIdentityRow>(
				this.entities.identity.entityName as any,
				{ platform: targetPlatform, platformUserId: targetPlatformUserId },
			)) as UnifiedIdentityRow | null

			const alreadyOnTarget = (await tx.findOne<UnifiedIdentityRow>(
				this.entities.identity.entityName as any,
				{ userId: token.userId, platform: targetPlatform },
			)) as UnifiedIdentityRow | null
			if (alreadyOnTarget && alreadyOnTarget.platformUserId !== targetPlatformUserId) {
				return {
					ok: false,
					reason: 'conflict',
					message: `Target user already has ${targetPlatform} linked.`,
				} as const
			}

			let mergedFromUserId: number | null = null
			if (!existing) {
				await tx.insert(this.entities.identity.entityName as any, {
					userId: token.userId,
					platform: targetPlatform,
					platformUserId: targetPlatformUserId,
					createdAt: now,
				} satisfies Omit<UnifiedIdentityRow, 'id'>)
			} else if (existing.userId !== token.userId) {
				// 常见情况：目标平台第一次发言时会自动创建“独立 user”，这里允许把这个 identity 迁移到 token.userId。
				const siblings = (await tx.find<UnifiedIdentityRow>(
					this.entities.identity.entityName as any,
					{ userId: existing.userId },
					{ limit: 2, orderBy: { id: 'asc' } as any },
				)) as UnifiedIdentityRow[]
				if (siblings.length > 1) {
					return {
						ok: false,
						reason: 'conflict',
						message: 'This account is linked to a user with multiple identities; merge is not supported.',
					} as const
				}
				await tx.nativeUpdate(
					this.entities.identity.entityName as any,
					{ id: existing.id },
					{ userId: token.userId },
				)
				mergedFromUserId = existing.userId
				await tx.nativeDelete(this.entities.user.entityName as any, { id: existing.userId })
			}

			const affected = (await tx.nativeUpdate(
				this.entities.token.entityName as any,
				{ id: token.id, consumedAt: null },
				{ consumedAt: now },
			)) as unknown as number

			if (!affected) return { ok: false, reason: 'consumed', message: 'Link code already consumed.' } as const

			return { ok: true, userId: token.userId, mergedFromUserId } as const
		})

		// invalidate caches after commit
		this.invalidateIdentity(targetPlatform, targetPlatformUserId)
		if (result.ok) {
			this.invalidateUserId(result.userId)
			if (result.mergedFromUserId) this.invalidateUserId(result.mergedFromUserId)
		}
		// hide internal field
		if (result.ok) return { ok: true, userId: result.userId }
		return result
	}
}

function randomCode(): string {
	// 8 位 base32-ish（排除易混淆字符）
	const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
	let out = ''
	for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]!
	return out
}

function normalizeDisplayName(value: string | null | undefined): string | null {
	const trimmed = typeof value === 'string' ? value.trim() : ''
	return trimmed ? trimmed : null
}
