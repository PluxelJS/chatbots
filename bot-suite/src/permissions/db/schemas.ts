import { EntitySchema } from 'pluxel-plugin-mikro-orm/mikro-orm/core'

export type GrantSubjectType = 'user' | 'role'
export type GrantKind = 'exact' | 'star'
export type GrantEffect = 'allow' | 'deny'

export interface RoleRow {
	roleId: number
	name: string | null
	parentRoleId: number | null
	rank: number
	updatedAt: Date
}

export interface UserRoleRow {
	id: number
	userId: number
	roleId: number
}

export interface GrantRow {
	id: number
	subjectType: GrantSubjectType
	subjectId: number
	nsKey: string
	kind: GrantKind
	/** exact: full local ("a.b"); star: prefix local ("a" or "") */
	local: string
	effect: GrantEffect
	updatedAt: Date
}

export const RoleSchema = new EntitySchema<RoleRow>({
	name: 'PermissionRole',
	tableName: 'permission_roles',
	properties: {
		roleId: { primary: true, type: 'number', autoincrement: true },
		name: { type: 'string', nullable: true, index: true },
		parentRoleId: { type: 'number', nullable: true, index: true },
		rank: { type: 'number', default: 0, index: true },
		updatedAt: { type: 'Date' },
	},
})

export const UserRoleSchema = new EntitySchema<UserRoleRow>({
	name: 'PermissionUserRole',
	tableName: 'permission_user_roles',
	properties: {
		id: { primary: true, type: 'number', autoincrement: true },
		userId: { type: 'number', index: true },
		roleId: { type: 'number', index: true },
	},
	uniques: [{ properties: ['userId', 'roleId'] }],
})

export const GrantSchema = new EntitySchema<GrantRow>({
	name: 'PermissionGrant',
	tableName: 'permission_grants',
	properties: {
		id: { primary: true, type: 'number', autoincrement: true },
		subjectType: { type: 'string', enum: true, items: ['user', 'role'], index: true },
		subjectId: { type: 'number', index: true },
		nsKey: { type: 'string', index: true },
		kind: { type: 'string', enum: true, items: ['exact', 'star'], index: true },
		local: { type: 'string', index: true },
		effect: { type: 'string', enum: true, items: ['allow', 'deny'], index: true },
		updatedAt: { type: 'Date' },
	},
	uniques: [{ properties: ['subjectType', 'subjectId', 'nsKey', 'kind', 'local'] }],
})
