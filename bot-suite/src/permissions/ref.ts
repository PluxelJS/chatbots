import type { NodeRef } from './resolver'
import type { PermissionService } from './service'

/** A stable permission reference for command integration; may cache a resolved NodeRef. */
export type PermRef = { node: string; _ref?: NodeRef }

export function perm(node: string): PermRef {
	return { node }
}

export function permResolved(node: string, ref: NodeRef): PermRef {
	return { node, _ref: ref }
}

export function resolvePermRef(perms: PermissionService, ref: PermRef): NodeRef | null {
	const cached = ref._ref
	if (cached) {
		const nowVer = perms.registry.getNamespaceEpoch(cached.nsIndex)
		if (cached.ver === nowVer) return cached
	}
	const resolved = perms.resolver.resolve(ref.node)
	if (!resolved) return null
	ref._ref = resolved
	return resolved
}

