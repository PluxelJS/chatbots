import type { MikroOrm } from 'pluxel-plugin-mikro-orm'

import { Decision } from './decision'
import { GrantsStore } from './grants_store'
import { PermissionRegistry, type PermissionEffect, type PermissionMeta } from './registry'
import { Resolver } from './resolver'
import { RoleTree } from './role_tree'
import { UserOverridesCache } from './user_overrides_cache'
import { AuthEngine, type AuthUser, type AuthorizationExplanation } from './auth_engine'
import type { GrantRow, RoleRow } from './db/schemas'
import type { NodeRef } from './resolver'
import type { GrantsStoreApi } from './store'

export type SubjectType = 'user' | 'role'
const DEFAULT_ROLE_NAME = 'DEFAULT'

export interface PermissionServiceOptions {
	resolverCacheMax?: number
	userOverridesTtlMs?: number
	userOverridesMax?: number
	userRolesTtlMs?: number
}

export class PermissionService {
	readonly registry = new PermissionRegistry()
	readonly resolver: Resolver
	readonly roles: RoleTree
	readonly overrides: UserOverridesCache
	readonly engine: AuthEngine

	private readonly disposeDb: () => Promise<void>
	private readonly store: GrantsStoreApi
	private readonly userRoleCache = new Map<number, { expiresAt: number; roleIdsSorted: number[] }>()
	private readonly userRolesTtlMs: number
	private defaultRoleId: number | null = null
	private catalogDirty = false
	private catalogRefresh: Promise<void> | null = null

	private constructor(
		store: GrantsStoreApi,
		disposeDb: () => Promise<void>,
		options: PermissionServiceOptions,
	) {
		this.store = store
		this.disposeDb = disposeDb
		this.resolver = new Resolver(this.registry, { cacheMax: options.resolverCacheMax ?? 5000 })
		this.roles = new RoleTree(this.registry, this.store)
		this.overrides = UserOverridesCache.create(this.registry, this.store, {
			ttlMs: options.userOverridesTtlMs ?? 10_000,
			max: options.userOverridesMax ?? 2000,
		})
		this.engine = new AuthEngine(this.registry, this.resolver, this.roles, this.overrides)
		this.userRolesTtlMs = Math.max(1, Math.floor(options.userRolesTtlMs ?? 10_000))
	}

	static async create(mikro: MikroOrm, options: PermissionServiceOptions = {}): Promise<PermissionService> {
		const { store, batch } = await GrantsStore.create(mikro)
		const svc = new PermissionService(store, () => batch.dispose(), options)
		await svc.ensureDefaultRole()
		await svc.roles.refreshAll()
		return svc
	}

	static async createWithStore(
		store: GrantsStoreApi,
		options: PermissionServiceOptions = {},
		dispose: () => Promise<void> = async () => {},
	): Promise<PermissionService> {
		const svc = new PermissionService(store, dispose, options)
		await svc.ensureDefaultRole()
		await svc.roles.refreshAll()
		return svc
	}

	async dispose(): Promise<void> {
		await this.disposeDb()
	}

	listNamespaces(): string[] {
		return this.registry.listNamespaces()
	}

	listPermissions(nsKey: string) {
		return this.registry.listPermissions(nsKey)
	}

	listRoles(): Promise<RoleRow[]> {
		return this.store.listRoles()
	}

	listGrants(subjectType: SubjectType, subjectId: number): Promise<GrantRow[]> {
		return this.store.listGrants(subjectType, subjectId)
	}

	listUserRoleIds(userId: number): Promise<number[]> {
		return this.store.listUserRoleIds(userId)
	}

	// --------------------------
	// Catalog declarations
	// --------------------------

	declareExact(nsKey: string, local: string, def: { default: PermissionEffect } & PermissionMeta): void {
		const wasActive = this.registry.getNamespaceIndex(nsKey) !== null
		this.registry.declareExact(nsKey, local, def)
		if (!wasActive) this.markCatalogDirty()
	}

	declareStar(nsKey: string, localPrefix: string, def: { default: PermissionEffect } & PermissionMeta): void {
		const wasActive = this.registry.getNamespaceIndex(nsKey) !== null
		this.registry.declareStar(nsKey, localPrefix, def)
		if (!wasActive) this.markCatalogDirty()
	}

	removeNamespace(nsKey: string): void {
		const wasActive = this.registry.getNamespaceIndex(nsKey) !== null
		this.registry.removeNamespace(nsKey)
		if (wasActive) this.markCatalogDirty()
	}

	private markCatalogDirty() {
		this.catalogDirty = true
		// user overrides may have been compiled while the namespace was inactive (nsIndex unavailable)
		this.overrides.clear()
	}

	private async ensureCatalogApplied(): Promise<void> {
		if (!this.catalogDirty) return
		if (this.catalogRefresh) return await this.catalogRefresh
		this.catalogRefresh = (async () => {
			await this.roles.refreshAll()
			this.catalogDirty = false
		})()
		try {
			await this.catalogRefresh
		} finally {
			this.catalogRefresh = null
		}
	}

	// --------------------------
	// Role management
	// --------------------------

	async createRole(parentRoleId: number | null = null, rank = 0, name?: string | null): Promise<number> {
		const id = await this.store.createRole(parentRoleId, rank, name)
		await this.roles.refreshRoleSubtree(id)
		return id
	}

	async updateRole(
		roleId: number,
		patch: { parentRoleId?: number | null; rank?: number; name?: string | null },
	): Promise<void> {
		await this.store.updateRole(roleId, patch)
		await this.roles.refreshRoleSubtree(roleId)
		this.userRoleCache.clear()
	}

	async deleteRole(roleId: number): Promise<void> {
		if (this.defaultRoleId === roleId) {
			throw new Error(`[Permissions] deleteRole(): refusing to delete default role #${roleId}`)
		}
		await this.store.deleteRole(roleId)
		await this.roles.refreshAll()
		this.userRoleCache.clear()
	}

	async assignRoleToUser(userId: number, roleId: number): Promise<void> {
		await this.store.assignRoleToUser(userId, roleId)
		this.userRoleCache.delete(userId)
	}

	async unassignRoleFromUser(userId: number, roleId: number): Promise<void> {
		await this.store.unassignRoleFromUser(userId, roleId)
		this.userRoleCache.delete(userId)
	}

	// --------------------------
	// Grants (validated, normalized)
	// --------------------------

	async grant(subjectType: SubjectType, subjectId: number, effect: PermissionEffect, node: string): Promise<void> {
		const resolved = this.resolver.resolveGrant(node)
		if (!resolved) throw new Error(`Invalid or undeclared permission node: ${node}`)

		await this.store.upsertGrant({
			subjectType,
			subjectId,
			nsKey: resolved.nsKey,
			kind: resolved.kind,
			local: resolved.local,
			effect,
		})

		if (subjectType === 'role') {
			await this.roles.refreshRoleSubtree(subjectId)
			this.userRoleCache.clear()
		} else {
			this.overrides.invalidate(subjectId)
		}
	}

	async revoke(subjectType: SubjectType, subjectId: number, node: string): Promise<void> {
		// revoke must NOT depend on catalog existence (offline/unloaded plugin cleanup)
		const resolved =
			this.resolver.resolveGrant(node) ??
			parseGrantNodeUnchecked(node)
		if (!resolved) throw new Error(`Invalid permission node: ${node}`)

		await this.store.revokeGrant({
			subjectType,
			subjectId,
			nsKey: resolved.nsKey,
			kind: resolved.kind,
			local: resolved.local,
		})

		if (subjectType === 'role') {
			await this.roles.refreshRoleSubtree(subjectId)
			this.userRoleCache.clear()
		} else {
			this.overrides.invalidate(subjectId)
		}
	}

	// --------------------------
	// Authorization
	// --------------------------

	async getAuthUser(userId: number): Promise<AuthUser> {
		const now = Date.now()
		const cached = this.userRoleCache.get(userId)
		if (cached && cached.expiresAt > now) return { userId, roleIdsSorted: cached.roleIdsSorted }

		const roleIds = await this.store.listUserRoleIds(userId)
		const sorted = this.roles.sortRoleIds(this.applyDefaultRole(roleIds))
		const entry = { expiresAt: now + this.userRolesTtlMs, roleIdsSorted: sorted }
		this.userRoleCache.set(userId, entry)
		return { userId, roleIdsSorted: sorted }
	}

	/**
	 * Sync fast path:
	 * - returns null if required caches are missing/expired (caller should fall back to getAuthUser + AuthEngine.authorize)
	 */
	getAuthUserSync(userId: number): AuthUser | null {
		const now = Date.now()
		const cached = this.userRoleCache.get(userId)
		if (!cached || cached.expiresAt <= now) return null
		return { userId, roleIdsSorted: cached.roleIdsSorted }
	}

private async ensureDefaultRole(): Promise<void> {
	const roles = await this.store.listRoles()
	const existing = roles.find((role) => normalizeRoleName(role.name) === DEFAULT_ROLE_NAME)
		if (existing) {
			this.defaultRoleId = existing.roleId
			return
		}
		this.defaultRoleId = await this.store.createRole(null, 0, DEFAULT_ROLE_NAME)
	}

	private applyDefaultRole(roleIds: number[]): number[] {
		if (!this.defaultRoleId) return roleIds
		if (roleIds.length > 0) return roleIds
		return [this.defaultRoleId]
	}

	async authorizeUser(userId: number, node: string | NodeRef): Promise<Decision> {
		await this.ensureCatalogApplied()
		const user = await this.getAuthUser(userId)
		if (typeof node !== 'string') {
			const nowVer = this.registry.getNamespaceEpoch(node.nsIndex)
			if (node.ver !== nowVer) return Decision.Deny
		}
		return await this.engine.authorize(user, node as any)
	}

	/** Debug/UI: explain which layer/rule wins. Not intended for hot-path checks. */
	async explainUser(userId: number, node: string | NodeRef): Promise<AuthorizationExplanation> {
		await this.ensureCatalogApplied()
		const user = await this.getAuthUser(userId)
		if (typeof node !== 'string') {
			const nowVer = this.registry.getNamespaceEpoch(node.nsIndex)
			if (node.ver !== nowVer) {
				return { decision: Decision.Deny, layer: 'unresolved', node: '<NodeRef>', reason: 'stale_ref' }
			}
		}
		return await this.engine.authorizeWithTrace(user, node as any)
	}

	/**
	 * Sync fast path for hot permission checks (typically with a cached NodeRef / PermRef).
	 *
	 * Returns null on cache-miss/expired (unknown user roles/overrides) so callers can fall back to authorizeUser().
	 */
	authorizeUserSync(userId: number, node: string | NodeRef): Decision | null {
		if (this.catalogDirty) return null
		const ref = typeof node === 'string' ? this.resolver.resolve(node) : node
		if (!ref) return Decision.Deny
		const nowVer = this.registry.getNamespaceEpoch(ref.nsIndex)
		if (ref.ver !== nowVer) return Decision.Deny

		const ns = this.registry.getNamespaceByIndex(ref.nsIndex)
		if (!ns) return Decision.Deny

		const userProg = this.overrides.getProgramSync(userId, ref.nsIndex)
		if (userProg === undefined) return null
		if (userProg) {
			const d = userProg.decide(ref.path)
			if (d !== Decision.Unset) return d
		}

		const user = this.getAuthUserSync(userId)
		if (!user) return null
		for (let i = 0; i < user.roleIdsSorted.length; i++) {
			const roleId = user.roleIdsSorted[i]!
			const prog = this.roles.getEffectiveProgram(roleId, ref.nsIndex)
			if (!prog) continue
			const d = prog.decide(ref.path)
			if (d !== Decision.Unset) return d
		}

		const dDecl = ns.program.decide(ref.path)
		if (dDecl !== Decision.Unset) return dDecl

		return Decision.Deny
	}

	async authorizeUserFast(userId: number, node: string | NodeRef): Promise<Decision> {
		const d = this.authorizeUserSync(userId, node)
		if (d !== null) return d
		return await this.authorizeUser(userId, node)
	}

	async canUser(userId: number, node: string | NodeRef): Promise<boolean> {
		return (await this.authorizeUser(userId, node)) === Decision.Allow
	}

	async canUserFast(userId: number, node: string | NodeRef): Promise<boolean> {
		return (await this.authorizeUserFast(userId, node)) === Decision.Allow
	}
}

function parseGrantNodeUnchecked(
	node: string,
): { nsKey: string; kind: 'exact' | 'star'; local: string } | null {
	const s = node.trim()
	const dot = s.indexOf('.')
	if (dot <= 0 || dot === s.length - 1) return null
	const nsKey = s.slice(0, dot).trim()
	const localRaw = s.slice(dot + 1).trim()
	if (!nsKey || !localRaw) return null

	// wildcard validation:
	// - local=="*" => root-star
	// - local endsWith ".*" => prefix-star (prefix must be non-empty)
	// - else if local contains '*' => invalid
	// - else exact
	if (localRaw === '*') return { nsKey, kind: 'star', local: '' }
	if (localRaw.endsWith('.*')) {
		const prefix = localRaw.slice(0, -2)
		if (!prefix) return null
		if (prefix.includes('*')) return null
		return { nsKey, kind: 'star', local: prefix }
	}
	if (localRaw.includes('*')) return null
	return { nsKey, kind: 'exact', local: localRaw }
}

function normalizeRoleName(value: string | null | undefined): string | null {
	const trimmed = typeof value === 'string' ? value.trim() : ''
	return trimmed ? trimmed.toUpperCase() : null
}
