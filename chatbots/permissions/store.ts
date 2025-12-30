import type { GrantEffect, GrantKind, GrantRow, GrantSubjectType, RoleRow } from './db/schemas'

export interface GrantsStoreApi {
	listRoles(): Promise<RoleRow[]>
	createRole(parentRoleId: number | null, rank: number, name?: string | null): Promise<number>
	updateRole(roleId: number, patch: { parentRoleId?: number | null; rank?: number; name?: string | null }): Promise<void>
	deleteRole(roleId: number): Promise<void>

	listUserRoleIds(userId: number): Promise<number[]>
	assignRoleToUser(userId: number, roleId: number): Promise<void>
	unassignRoleFromUser(userId: number, roleId: number): Promise<void>

	listGrants(subjectType: GrantSubjectType, subjectId: number): Promise<GrantRow[]>
	listRoleGrants(roleIds: number[]): Promise<GrantRow[]>

	upsertGrant(row: {
		subjectType: GrantSubjectType
		subjectId: number
		nsKey: string
		kind: GrantKind
		local: string
		effect: GrantEffect
	}): Promise<void>

	revokeGrant(row: {
		subjectType: GrantSubjectType
		subjectId: number
		nsKey: string
		kind: GrantKind
		local: string
	}): Promise<void>
}
