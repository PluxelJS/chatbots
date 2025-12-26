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

export type PermissionRoleDto = {
	roleId: number
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
}
