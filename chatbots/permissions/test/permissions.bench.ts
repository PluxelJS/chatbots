// bun run permissions/test/permissions.bench.ts

import { Decision } from '../decision'
import { SegmentInterner } from '../interner'
import { PermissionService } from '../service'
import { TrieBuilder } from '../trie_builder'
import type { NodeRef } from '../resolver'
import { resolvePermRef, type PermRef } from '../ref'
import type { GrantsStoreApi } from '../store'
import type { GrantEffect, GrantKind, GrantRow, GrantSubjectType, RoleRow } from '../db/schemas'

const nowNs = (): number => {
	// Bun.nanoseconds() is high-res; fallback to performance.now().
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const b: any = (globalThis as any).Bun
	if (b && typeof b.nanoseconds === 'function') return Number(b.nanoseconds())
	return performance.now() * 1e6
}

const envInt = (key: string, fallback: number) => {
	const v = Number(process.env[key] ?? '')
	return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

const N_DECIDE = envInt('N_DECIDE', 2_000_000)
const N_RESOLVE = envInt('N_RESOLVE', 500_000)
const N_AUTH_HOT = envInt('N_AUTH_HOT', 2_000_000)
const USERS = envInt('USERS', 20_000)
const PERMS = envInt('PERMS', 10_000)

function benchSync(name: string, n: number, fn: () => number) {
	const warm = Math.min(50_000, Math.max(10_000, Math.floor(n * 0.05)))
	let sink = 0
	for (let i = 0; i < warm; i++) sink ^= fn()

	const t0 = nowNs()
	for (let i = 0; i < n; i++) sink ^= fn()
	const t1 = nowNs()
	const ns = t1 - t0
	console.log({
		name,
		N: n,
		nsPerOp: ns / n,
		opsPerSec: (n * 1e9) / ns,
		sink,
	})
}

function makeRand(seed = 0x1234abcd) {
	let s = seed >>> 0
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0
		return s
	}
}

function declareBenchCatalog(perms: PermissionService, nsKey: string, permCount: number) {
	// ensure root-star / cmd.* exist for star grants + defaults
	perms.declareStar(nsKey, '', { default: 'deny', description: 'all' })
	perms.declareStar(nsKey, 'cmd', { default: 'deny', description: 'cmd.*' })
	for (let i = 0; i < permCount; i++) {
		perms.declareExact(nsKey, `cmd.${i}.run`, { default: 'deny' })
	}
}

function buildProgramForBench(interner: SegmentInterner, permCount: number) {
	const b = new TrieBuilder()
	for (let i = 0; i < permCount; i++) b.setExact(Decision.Allow, interner.compileLocal(`cmd.${i}.run`))
	b.setStar(Decision.Deny, interner.compileLocal('cmd'))
	return b.freeze()
}

async function main() {
	// --------------------------
	// 1) Baseline decide() only
	// --------------------------
	{
		const interner = new SegmentInterner()
		const program = buildProgramForBench(interner, PERMS)
		const paths: Uint32Array[] = []
		for (let i = 0; i < 4096; i++) paths.push(interner.compileLocal(`cmd.${i % PERMS}.run`))
		const rand = makeRand()

		let k = 0
		benchSync('program.decide hot', N_DECIDE, () => program.decide(paths[k = (k + 1) & 4095]!))
		benchSync('program.decide random', N_DECIDE, () => program.decide(paths[rand() & 4095]!))
	}

	// --------------------------
	// 2) Resolver resolve() hot/cold
	// --------------------------
	{
		const store = new BenchGrantsStore()
		const perms = await PermissionService.createWithStore(store, { resolverCacheMax: 50_000 })
		declareBenchCatalog(perms, 'bench', PERMS)

		// ensureCatalogApplied(): one authorize will trigger role refresh + clear dirty flag
		await store.assignRoleToUser(1, await store.createRole(null, 0))
		await perms.authorizeUser(1, 'bench.cmd.0.run')

		const hotNode = 'bench.cmd.123.run'
		const coldNodes: string[] = []
		for (let i = 0; i < Math.min(PERMS, 50_000); i++) coldNodes.push(`bench.cmd.${i}.run`)
		const rand = makeRand()

		benchSync('resolver.resolve hot', N_RESOLVE, () => (perms.resolver.resolve(hotNode) ? 1 : 0))
		benchSync('resolver.resolve cold', N_RESOLVE, () => (perms.resolver.resolve(coldNodes[rand() % coldNodes.length]!) ? 1 : 0))
	}

	// --------------------------
	// 3) authorizeUserSync() (realistic hot path)
	// --------------------------
	{
		const nsKey = 'bench'
		const store = new BenchGrantsStore()

		// roles: user <- mod <- admin
		const roleUser = await store.createRole(null, 0)
		const roleMod = await store.createRole(roleUser, 10)
		const roleAdmin = await store.createRole(roleMod, 100)

		// role grants
		await store.upsertGrant({ subjectType: 'role', subjectId: roleMod, nsKey, kind: 'star', local: 'cmd', effect: 'allow' })
		// add a few denies to introduce conflicts and exercise exact>star precedence
		for (let i = 0; i < 32; i++) {
			await store.upsertGrant({
				subjectType: 'role',
				subjectId: roleMod,
				nsKey,
				kind: 'exact',
				local: `cmd.${i}.run`,
				effect: 'deny',
			})
		}
		await store.upsertGrant({
			subjectType: 'role',
			subjectId: roleAdmin,
			nsKey,
			kind: 'star',
			local: '',
			effect: 'allow',
		})

		// assign roles to users
		for (let u = 1; u <= USERS; u++) {
			const r = u % 1000 === 0 ? roleAdmin : u % 10 === 0 ? roleMod : roleUser
			await store.assignRoleToUser(u, r)
			if (u % 37 === 0) await store.assignRoleToUser(u, roleMod) // multi-role case
		}

		// sparse user overrides: ~2.7%
		for (let u = 1; u <= USERS; u++) {
			if (u % 37 !== 0) continue
			const local = `cmd.${u % PERMS}.run`
			await store.upsertGrant({
				subjectType: 'user',
				subjectId: u,
				nsKey,
				kind: 'exact',
				local,
				effect: u % 2 ? 'deny' : 'allow',
			})
		}

		const perms = await PermissionService.createWithStore(store, {
			resolverCacheMax: 100_000,
			userRolesTtlMs: 60_000_000,
			userOverridesTtlMs: 60_000_000,
			userOverridesMax: Math.max(2000, USERS),
		})
		declareBenchCatalog(perms, nsKey, PERMS)

		// ensureCatalogApplied (namespace activation) + warm a little
		await perms.authorizeUser(1, `${nsKey}.cmd.0.run`)

		const nsIndex = perms.registry.getNamespaceIndex(nsKey)!
		// warm caches (to exercise authorizeUserSync fast path)
		for (let u = 1; u <= USERS; u++) {
			await perms.getAuthUser(u)
			await perms.overrides.getProgram(u, nsIndex)
		}

		const nodeRefs: NodeRef[] = []
		for (let i = 0; i < 4096; i++) nodeRefs.push(perms.resolver.resolve(`${nsKey}.cmd.${i % PERMS}.run`)!)

		const rand = makeRand()
		let idx = 0
		benchSync('authorizeUserSync hot (same user)', N_AUTH_HOT, () => {
			const d = perms.authorizeUserSync(1, nodeRefs[idx = (idx + 1) & 4095]!)
			return d ?? Decision.Unset
		})

		benchSync('authorizeUserSync mixed users+nodes', N_AUTH_HOT, () => {
			const userId = (rand() % USERS) + 1
			const ref = nodeRefs[rand() & 4095]!
			const d = perms.authorizeUserSync(userId, ref)
			return d ?? Decision.Unset
		})
	}

	// --------------------------
	// 4) PermRef cache hit (epoch-hit)
	// --------------------------
	{
		const store = new BenchGrantsStore()
		const perms = await PermissionService.createWithStore(store)
		declareBenchCatalog(perms, 'bench', Math.min(1000, PERMS))
		await store.assignRoleToUser(1, await store.createRole(null, 0))
		await perms.authorizeUser(1, 'bench.cmd.0.run')

		const node = 'bench.cmd.1.run'
		const ref = perms.resolver.resolve(node)!
		const permRef: PermRef = { node, _ref: ref }
		benchSync('PermRef resolve epoch-hit', N_RESOLVE, () => (resolvePermRef(perms, permRef) ? 1 : 0))
	}
}

void main()

class BenchGrantsStore implements GrantsStoreApi {
	private nextRoleId = 1
	private nextGrantId = 1

	private readonly roles = new Map<number, RoleRow>()
	private readonly userRoles = new Map<number, Set<number>>()
	private readonly grantsByUniqueKey = new Map<string, GrantRow>()
	private readonly grantsBySubject = new Map<string, GrantRow[]>()

	async listRoles(): Promise<RoleRow[]> {
		return [...this.roles.values()].sort((a, b) => a.roleId - b.roleId)
	}

	async createRole(parentRoleId: number | null, rank: number): Promise<number> {
		const roleId = this.nextRoleId++
		this.roles.set(roleId, { roleId, parentRoleId, rank, updatedAt: new Date() })
		return roleId
	}

	async updateRole(roleId: number, patch: { parentRoleId?: number | null; rank?: number }): Promise<void> {
		const existing = this.roles.get(roleId)
		if (!existing) throw new Error(`Role not found: ${roleId}`)
		this.roles.set(roleId, {
			...existing,
			...patch,
			updatedAt: new Date(),
		})
	}

	async listUserRoleIds(userId: number): Promise<number[]> {
		return [...(this.userRoles.get(userId) ?? [])]
	}

	async assignRoleToUser(userId: number, roleId: number): Promise<void> {
		let set = this.userRoles.get(userId)
		if (!set) {
			set = new Set()
			this.userRoles.set(userId, set)
		}
		set.add(roleId)
	}

	async unassignRoleFromUser(userId: number, roleId: number): Promise<void> {
		this.userRoles.get(userId)?.delete(roleId)
	}

	async listGrants(subjectType: GrantSubjectType, subjectId: number): Promise<GrantRow[]> {
		return this.grantsBySubject.get(`${subjectType}:${subjectId}`) ?? []
	}

	async listRoleGrants(roleIds: number[]): Promise<GrantRow[]> {
		if (!roleIds.length) return []
		const out: GrantRow[] = []
		for (let i = 0; i < roleIds.length; i++) {
			const roleId = roleIds[i]!
			const arr = this.grantsBySubject.get(`role:${roleId}`)
			if (arr) out.push(...arr)
		}
		out.sort((a, b) => a.id - b.id)
		return out
	}

	async upsertGrant(row: {
		subjectType: GrantSubjectType
		subjectId: number
		nsKey: string
		kind: GrantKind
		local: string
		effect: GrantEffect
	}): Promise<void> {
		const uniqueKey = `${row.subjectType}:${row.subjectId}:${row.nsKey}:${row.kind}:${row.local}`
		const existing = this.grantsByUniqueKey.get(uniqueKey)
		if (existing) {
			existing.effect = row.effect
			existing.updatedAt = new Date()
			return
		}

		const grant: GrantRow = {
			id: this.nextGrantId++,
			subjectType: row.subjectType,
			subjectId: row.subjectId,
			nsKey: row.nsKey,
			kind: row.kind,
			local: row.local,
			effect: row.effect,
			updatedAt: new Date(),
		}
		this.grantsByUniqueKey.set(uniqueKey, grant)

		const subjectKey = `${row.subjectType}:${row.subjectId}`
		let arr = this.grantsBySubject.get(subjectKey)
		if (!arr) {
			arr = []
			this.grantsBySubject.set(subjectKey, arr)
		}
		arr.push(grant)
	}

	async revokeGrant(row: {
		subjectType: GrantSubjectType
		subjectId: number
		nsKey: string
		kind: GrantKind
		local: string
	}): Promise<void> {
		const uniqueKey = `${row.subjectType}:${row.subjectId}:${row.nsKey}:${row.kind}:${row.local}`
		const existing = this.grantsByUniqueKey.get(uniqueKey)
		if (!existing) return
		this.grantsByUniqueKey.delete(uniqueKey)

		const subjectKey = `${row.subjectType}:${row.subjectId}`
		const arr = this.grantsBySubject.get(subjectKey)
		if (!arr) return
		const idx = arr.indexOf(existing)
		if (idx >= 0) arr.splice(idx, 1)
	}
}
