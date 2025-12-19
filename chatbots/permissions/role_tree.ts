import { Decision } from './decision'
import type { PermissionRegistry } from './registry'
import type { GrantsStoreApi } from './store'
import type { GrantRow, RoleRow } from './db/schemas'
import { TrieBuilder } from './trie_builder'
import { PermissionProgram } from './program'

export type RoleId = number

type RoleState = {
	roleId: number
	parentRoleId: number | null
	rank: number
	children: number[]
	/** effective programs by namespace index (sparse array) */
	effective: Array<PermissionProgram | null>
}

export class RoleTree {
	private readonly roles = new Map<number, RoleState>()

	constructor(
		private readonly registry: PermissionRegistry,
		private readonly store: GrantsStoreApi,
	) {}

	async refreshAll(): Promise<void> {
		const rows = await this.store.listRoles()
		this.syncRoleGraph(rows)

		const allRoleIds = rows.map((r) => r.roleId)
		const grants = await this.store.listRoleGrants(allRoleIds)
		const grantsByRole = groupByRoleId(grants)

		// rebuild from roots to cover entire forest once
		for (const roleId of allRoleIds) {
			const role = this.roles.get(roleId)
			if (!role) continue
			if (role.parentRoleId === null || !this.roles.has(role.parentRoleId)) {
				await this.rebuildSubtree(roleId, grantsByRole)
			}
		}
	}

	/** Rebuild the role itself + its descendants (subtree) after a grant or role update. */
	async refreshRoleSubtree(roleId: number): Promise<void> {
		const rows = await this.store.listRoles()
		this.syncRoleGraph(rows)

		const subtree = this.collectSubtree(roleId)
		const ancestors = this.collectAncestors(roleId)
		const needGrants = uniqueNumbers([...subtree, ...ancestors])
		const grants = await this.store.listRoleGrants(needGrants)
		const grantsByRole = groupByRoleId(grants)

		await this.rebuildSubtree(roleId, grantsByRole)
	}

	getRank(roleId: number): number {
		return this.roles.get(roleId)?.rank ?? 0
	}

	sortRoleIds(roleIds: number[]): number[] {
		roleIds.sort((a, b) => {
			const ra = this.getRank(a)
			const rb = this.getRank(b)
			if (ra !== rb) return rb - ra
			return a - b
		})
		return roleIds
	}

	getEffectiveProgram(roleId: number, nsIndex: number): PermissionProgram | null {
		const role = this.roles.get(roleId)
		if (!role) return null
		return role.effective[nsIndex] ?? null
	}

	private syncRoleGraph(rows: RoleRow[]) {
		const seen = new Set<number>()
		for (const r of rows) {
			seen.add(r.roleId)
			const existing = this.roles.get(r.roleId)
			if (existing) {
				existing.parentRoleId = r.parentRoleId ?? null
				existing.rank = r.rank ?? 0
				existing.children = []
			} else {
				this.roles.set(r.roleId, {
					roleId: r.roleId,
					parentRoleId: r.parentRoleId ?? null,
					rank: r.rank ?? 0,
					children: [],
					effective: [],
				})
			}
		}
		for (const id of this.roles.keys()) {
			if (!seen.has(id)) this.roles.delete(id)
		}
		for (const role of this.roles.values()) role.children = []
		for (const role of this.roles.values()) {
			if (role.parentRoleId !== null) {
				const parent = this.roles.get(role.parentRoleId)
				if (parent) parent.children.push(role.roleId)
			}
		}
	}

	private collectSubtree(rootRoleId: number): number[] {
		const out: number[] = []
		const seen = new Set<number>()
		const stack = [rootRoleId]
		while (stack.length) {
			const id = stack.pop()!
			if (seen.has(id)) continue
			seen.add(id)
			out.push(id)
			const role = this.roles.get(id)
			if (!role) continue
			for (const c of role.children) stack.push(c)
		}
		return out
	}

	private collectAncestors(roleId: number): number[] {
		const out: number[] = []
		const seen = new Set<number>()
		let cur = this.roles.get(roleId)?.parentRoleId ?? null
		while (cur !== null && !seen.has(cur)) {
			seen.add(cur)
			out.push(cur)
			cur = this.roles.get(cur)?.parentRoleId ?? null
		}
		return out
	}

	private async rebuildSubtree(rootRoleId: number, grantsByRole: Map<number, GrantRow[]>) {
		const stack = [rootRoleId]
		while (stack.length) {
			const roleId = stack.pop()!
			const role = this.roles.get(roleId)
			if (!role) continue

			role.effective = this.buildEffectivePrograms(roleId, grantsByRole)
			for (const c of role.children) stack.push(c)
		}
	}

	private buildEffectivePrograms(roleId: number, grantsByRole: Map<number, GrantRow[]>): Array<PermissionProgram | null> {
		const chain: number[] = []
		let cur: number | null = roleId
		while (cur !== null) {
			chain.push(cur)
			cur = this.roles.get(cur)?.parentRoleId ?? null
		}
		chain.reverse()

		const builders = new Map<number, TrieBuilder>()
		const pathCache = new Map<string, Uint32Array>()
		for (const rid of chain) {
			const grants = grantsByRole.get(rid)
			if (!grants) continue
			for (const g of grants) {
				const nsIndex = this.registry.getNamespaceIndex(g.nsKey)
				if (nsIndex === null) continue
				const ns = this.registry.getNamespaceByIndex(nsIndex)
				if (!ns) continue

				let b = builders.get(nsIndex)
				if (!b) {
					b = new TrieBuilder()
					builders.set(nsIndex, b)
				}

				const cacheKey = `${nsIndex}:${g.local}`
				let path = pathCache.get(cacheKey)
				if (!path) {
					path = ns.interner.compileLocal(g.local)
					pathCache.set(cacheKey, path)
				}
				const effect = g.effect === 'allow' ? Decision.Allow : Decision.Deny
				if (g.kind === 'star') b.setStar(effect, path)
				else b.setExact(effect, path)
			}
		}

		const out: Array<PermissionProgram | null> = []
		for (const [nsIndex, b] of builders) {
			out[nsIndex] = b.freeze()
		}
		return out
	}
}

function uniqueNumbers(nums: number[]): number[] {
	const out: number[] = []
	const seen = new Set<number>()
	for (let i = 0; i < nums.length; i++) {
		const n = nums[i]!
		if (seen.has(n)) continue
		seen.add(n)
		out.push(n)
	}
	return out
}

function groupByRoleId(grants: GrantRow[]): Map<number, GrantRow[]> {
	const map = new Map<number, GrantRow[]>()
	for (const g of grants) {
		if (g.subjectType !== 'role') continue
		let arr = map.get(g.subjectId)
		if (!arr) {
			arr = []
			map.set(g.subjectId, arr)
		}
		arr.push(g)
	}
	return map
}
