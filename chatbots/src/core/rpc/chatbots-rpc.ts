import { RpcTarget } from '@pluxel/hmr/capnweb'
import type { Platform } from '@pluxel/bot-layer'

import type {
	PermissionEffect,
	PermissionSubjectType,
	RolePatch,
} from '../api'
import type { PermissionCatalogNamespace, PermissionGrantDto, PermissionRoleDto } from '../permissions-types'
import type {
	SandboxCommandsSnapshot,
	SandboxSendInput,
	SandboxSendResult,
	SandboxSnapshot,
} from '../sandbox/types'
import type { PermissionService } from '../../permissions/service'
import type { UnifiedUserDto } from '../user-types'
import type { UserDirectory } from '../users/directory'
import type { GrantRow, RoleRow } from '../../permissions/db/schemas'

type SandboxApi = {
	snapshot: () => SandboxSnapshot
	reset: () => SandboxSnapshot
	commands: () => SandboxCommandsSnapshot
	send: (input: SandboxSendInput) => Promise<SandboxSendResult>
}

export class ChatbotsRpc extends RpcTarget {
	constructor(
		private readonly sandbox: SandboxApi,
		private readonly permissions: PermissionService,
		private readonly users: UserDirectory,
	) {
		super()
	}

	async snapshot(): Promise<SandboxSnapshot> {
		return this.sandbox.snapshot()
	}

	async reset(): Promise<SandboxSnapshot> {
		return this.sandbox.reset()
	}

	async commands(): Promise<SandboxCommandsSnapshot> {
		return this.sandbox.commands()
	}

	async send(input: SandboxSendInput): Promise<SandboxSendResult> {
		return await this.sandbox.send(input)
	}

	async catalog(): Promise<PermissionCatalogNamespace[]> {
		const namespaces = this.permissions.listNamespaces().sort()
		return namespaces.map((nsKey) => ({
			nsKey,
			permissions: this.permissions.listPermissions(nsKey),
		}))
	}

	async listRoles(): Promise<PermissionRoleDto[]> {
		const rows = await this.permissions.listRoles()
		return rows.map(serializeRole)
	}

	async listRoleGrants(roleId: number): Promise<PermissionGrantDto[]> {
		const rows = await this.permissions.listGrants('role', roleId)
		return rows.map(serializeGrant)
	}

	async listUserRoles(userId: number): Promise<number[]> {
		return await this.permissions.listUserRoleIds(userId)
	}

	async listUserGrants(userId: number): Promise<PermissionGrantDto[]> {
		const rows = await this.permissions.listGrants('user', userId)
		return rows.map(serializeGrant)
	}

	async createRole(parentRoleId: number | null, rank: number, name?: string | null): Promise<number> {
		return await this.permissions.createRole(parentRoleId, rank, name)
	}

	async updateRole(roleId: number, patch: RolePatch): Promise<void> {
		await this.permissions.updateRole(roleId, patch)
	}

	async deleteRole(roleId: number): Promise<void> {
		await this.permissions.deleteRole(roleId)
	}

	async assignRoleToUser(userId: number, roleId: number): Promise<void> {
		await this.permissions.assignRoleToUser(userId, roleId)
	}

	async unassignRoleFromUser(userId: number, roleId: number): Promise<void> {
		await this.permissions.unassignRoleFromUser(userId, roleId)
	}

	async grant(
		subjectType: PermissionSubjectType,
		subjectId: number,
		effect: PermissionEffect,
		node: string,
	): Promise<void> {
		await this.permissions.grant(subjectType, subjectId, effect, node)
	}

	async revoke(subjectType: PermissionSubjectType, subjectId: number, node: string): Promise<void> {
		await this.permissions.revoke(subjectType, subjectId, node)
	}

	async getUser(userId: number): Promise<UnifiedUserDto | null> {
		const user = await this.users.getUserById(userId)
		return user ? serializeUser(user) : null
	}

	async findUserByPlatformIdentity(
		platform: Platform,
		platformUserId: string | number,
	): Promise<UnifiedUserDto | null> {
		const user = await this.users.findUserByIdentity(platform, String(platformUserId))
		return user ? serializeUser(user) : null
	}

	async searchUsersByName(query: string, limit?: number): Promise<UnifiedUserDto[]> {
		const users = await this.users.searchUsersByName(query, limit)
		return users.map(serializeUser)
	}

	async updateUserDisplayName(userId: number, displayName: string | null): Promise<void> {
		await this.users.updateUserDisplayName(userId, displayName)
	}
}

const toIso = (value: Date | string) => (typeof value === 'string' ? value : value.toISOString())

const serializeRole = (row: RoleRow): PermissionRoleDto => ({
	roleId: row.roleId,
	name: row.name ?? null,
	parentRoleId: row.parentRoleId,
	rank: row.rank,
	updatedAt: toIso(row.updatedAt),
})

const serializeGrant = (row: GrantRow): PermissionGrantDto => ({
	id: row.id,
	subjectType: row.subjectType,
	subjectId: row.subjectId,
	nsKey: row.nsKey,
	kind: row.kind,
	local: row.local,
	effect: row.effect,
	updatedAt: toIso(row.updatedAt),
	node: row.kind === 'star' ? `${row.nsKey}.${row.local ? `${row.local}.*` : '*'}` : `${row.nsKey}.${row.local}`,
})

const serializeUser = (user: {
	id: number
	displayName: string | null
	createdAt: Date
	identities: Array<{ platform: Platform; platformUserId: string }>
}): UnifiedUserDto => ({
	id: user.id,
	displayName: user.displayName ?? null,
	createdAt: toIso(user.createdAt),
	identities: user.identities.map((identity) => ({
		platform: identity.platform,
		platformUserId: identity.platformUserId,
	})),
})
