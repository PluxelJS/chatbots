import { Decision } from './decision'
import type { PermissionRegistry } from './registry'
import type { Resolver, NodeRef } from './resolver'
import type { RoleTree } from './role_tree'
import type { UserOverridesCache } from './user_overrides_cache'

export interface AuthUser {
	userId: number
	/** already sorted by (rank desc, roleId asc) */
	roleIdsSorted: readonly number[]
}

export class AuthEngine {
	constructor(
		private readonly registry: PermissionRegistry,
		private readonly resolver: Resolver,
		private readonly roles: RoleTree,
		private readonly overrides: UserOverridesCache,
	) {}

	async authorize(user: AuthUser, node: string | NodeRef): Promise<Decision> {
		const ref = typeof node === 'string' ? this.resolver.resolve(node) : node
		if (!ref) return Decision.Deny

		const ns = this.registry.getNamespaceByIndex(ref.nsIndex)
		if (!ns) return Decision.Deny

		const userProg = await this.overrides.getProgram(user.userId, ref.nsIndex)
		if (userProg) {
			const d = userProg.decide(ref.path)
			if (d !== Decision.Unset) return d
		}

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
}

