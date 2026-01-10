import { Decision } from './decision'
import type { PermissionRegistry } from './registry'
import type { Resolver, NodeRef } from './resolver'
import type { RoleTree } from './role_tree'
import type { UserOverridesCache } from './user_overrides_cache'
import type { ProgramMatch } from './program'

export interface AuthUser {
	userId: number
	/** already sorted by (rank desc, roleId asc) */
	roleIdsSorted: readonly number[]
}

export type AuthorizationLayer = 'unresolved' | 'user' | 'role' | 'declaration' | 'default'

export type AuthorizationExplanation =
	| {
			decision: Decision.Deny
			layer: 'unresolved'
			/** best-effort node string for UI/debug */
			node: string
			reason: 'invalid_or_undeclared' | 'namespace_inactive' | 'stale_ref'
	  }
	| {
			decision: Decision.Deny
			layer: 'default'
			node: string
			reason: 'no_match'
	  }
	| {
			decision: Decision.Allow | Decision.Deny
			layer: 'user' | 'declaration'
			node: string
			rule: string
			match: ProgramMatch
	  }
	| {
			decision: Decision.Allow | Decision.Deny
			layer: 'role'
			node: string
			roleId: number
			rule: string
			match: ProgramMatch
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

	/**
	 * Explain which layer/rule wins.
	 *
	 * This is intentionally separate from `authorize()` to keep the hot path minimal.
	 */
	async authorizeWithTrace(user: AuthUser, node: string | NodeRef): Promise<AuthorizationExplanation> {
		const ref = typeof node === 'string' ? this.resolver.resolve(node) : node
		const nodeString = typeof node === 'string' ? node.trim() : '<NodeRef>'
		if (!ref) {
			return { decision: Decision.Deny, layer: 'unresolved', node: nodeString, reason: 'invalid_or_undeclared' }
		}

		const ns = this.registry.getNamespaceByIndex(ref.nsIndex)
		if (!ns) {
			return { decision: Decision.Deny, layer: 'unresolved', node: nodeString, reason: 'namespace_inactive' }
		}

		const nsKey = ns.key
		const local = ns.interner.formatLocal(ref.path)
		const normalizedNode = `${nsKey}.${local}`

		const ruleFromMatch = (match: ProgramMatch): string => {
			if (match.kind === 'exact') return `${nsKey}.${local}`
			if (match.kind === 'star') {
				const prefix = ns.interner.formatLocal(ref.path, match.depth)
				return `${nsKey}.${prefix ? `${prefix}.*` : '*'}`
			}
			return normalizedNode
		}

		const userProg = await this.overrides.getProgram(user.userId, ref.nsIndex)
		if (userProg) {
			const exp = userProg.explain(ref.path)
			if (exp.decision !== Decision.Unset) {
				return {
					decision: exp.decision,
					layer: 'user',
					node: normalizedNode,
					rule: ruleFromMatch(exp.match),
					match: exp.match,
				}
			}
		}

		for (let i = 0; i < user.roleIdsSorted.length; i++) {
			const roleId = user.roleIdsSorted[i]!
			const prog = this.roles.getEffectiveProgram(roleId, ref.nsIndex)
			if (!prog) continue
			const exp = prog.explain(ref.path)
			if (exp.decision !== Decision.Unset) {
				return {
					decision: exp.decision,
					layer: 'role',
					roleId,
					node: normalizedNode,
					rule: ruleFromMatch(exp.match),
					match: exp.match,
				}
			}
		}

		const expDecl = ns.program.explain(ref.path)
		if (expDecl.decision !== Decision.Unset) {
			return {
				decision: expDecl.decision,
				layer: 'declaration',
				node: normalizedNode,
				rule: ruleFromMatch(expDecl.match),
				match: expDecl.match,
			}
		}

		return { decision: Decision.Deny, layer: 'default', node: normalizedNode, reason: 'no_match' }
	}
}
