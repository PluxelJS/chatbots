import type { PermissionEffect, PermissionKind, PermissionMeta } from '../permissions/registry'

export type PermissionCatalogItem = {
	node: string
	kind: PermissionKind
	local: string
	default: PermissionEffect
	meta?: PermissionMeta
}

export type PermissionCatalogNamespace = {
	nsKey: string
	permissions: PermissionCatalogItem[]
}

export type PermissionExplainDecision = PermissionEffect

export type PermissionExplainMatchDto =
	| { kind: 'none' }
	| { kind: 'exact'; effect: PermissionExplainDecision }
	| { kind: 'star'; depth: number; effect: PermissionExplainDecision }

export type PermissionExplainDto =
	| {
			decision: 'deny'
			layer: 'unresolved'
			node: string
			reason: 'invalid_or_undeclared' | 'namespace_inactive' | 'stale_ref'
	  }
	| { decision: 'deny'; layer: 'default'; node: string; reason: 'no_match' }
	| {
			decision: PermissionExplainDecision
			layer: 'user' | 'declaration'
			node: string
			rule: string
			match: PermissionExplainMatchDto
	  }
	| {
			decision: PermissionExplainDecision
			layer: 'role'
			roleId: number
			node: string
			rule: string
			match: PermissionExplainMatchDto
	  }

export type PermissionRoleDto = {
	roleId: number
	name: string | null
	parentRoleId: number | null
	rank: number
	updatedAt: string
}

export type PermissionGrantDto = {
	id: number
	subjectType: 'user' | 'role'
	subjectId: number
	nsKey: string
	kind: PermissionKind
	local: string
	effect: PermissionEffect
	updatedAt: string
	node?: string
}
