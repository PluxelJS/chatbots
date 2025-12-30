import type { Decision } from './decision'
import type { NodeRef } from './resolver'
import type { PermissionService, SubjectType } from './service'
import type { PermissionEffect, PermissionMeta } from './registry'
import { permResolved, type PermRef } from './ref'

export class ChatbotsPermissionApi {
	constructor(private readonly perms: PermissionService) {}

	// --------------------------
	// Catalog (in-memory)
	// --------------------------

	listNamespaces(): string[] {
		return this.perms.listNamespaces()
	}

	listPermissions(nsKey: string) {
		return this.perms.listPermissions(nsKey)
	}

	// --------------------------
	// Admin writes (DB-backed)
	// --------------------------

	grant(subjectType: SubjectType, subjectId: number, effect: PermissionEffect, node: string) {
		return this.perms.grant(subjectType, subjectId, effect, node)
	}

	revoke(subjectType: SubjectType, subjectId: number, node: string) {
		return this.perms.revoke(subjectType, subjectId, node)
	}

	createRole(parentRoleId: number | null = null, rank = 0, name?: string | null) {
		return this.perms.createRole(parentRoleId, rank, name)
	}

	updateRole(roleId: number, patch: { parentRoleId?: number | null; rank?: number; name?: string | null }) {
		return this.perms.updateRole(roleId, patch)
	}

	deleteRole(roleId: number) {
		return this.perms.deleteRole(roleId)
	}

	assignRoleToUser(userId: number, roleId: number) {
		return this.perms.assignRoleToUser(userId, roleId)
	}

	unassignRoleFromUser(userId: number, roleId: number) {
		return this.perms.unassignRoleFromUser(userId, roleId)
	}

	// --------------------------
	// Authorization
	// --------------------------

	authorizeUser(userId: number, node: string | NodeRef): Promise<Decision> {
		return this.perms.authorizeUser(userId, node)
	}

	canUser(userId: number, node: string | NodeRef): Promise<boolean> {
		return this.perms.canUser(userId, node)
	}
}

export const createPermissionApi = (perms: PermissionService) => new ChatbotsPermissionApi(perms)

/** Plugin-facing helpers (local-only; namespace inference is handled by Chatbots plugin). */
export interface ChatbotsPermissionPluginApi {
	declareExact: (local: string, def: { default: PermissionEffect } & PermissionMeta) => PermRef
	declareStar: (localPrefix: string, def: { default: PermissionEffect } & PermissionMeta) => void
	perm: (local: string) => PermRef
}

export type ChatbotsPermissionFacade = ChatbotsPermissionApi & ChatbotsPermissionPluginApi

/**
 * Compose a single facade for external usage:
 * - admin/catalog APIs from `ChatbotsPermissionApi`
 * - plugin-facing helpers with namespace inference (`declareExact/declareStar/perm`)
 */
export function createPermissionFacade(
	perms: PermissionService,
	requireNamespaceKey: (method: string) => string,
): ChatbotsPermissionFacade {
	const base = createPermissionApi(perms)
	return Object.assign(base, {
		declareExact(local: string, def: { default: PermissionEffect } & PermissionMeta): PermRef {
			const nsKey = requireNamespaceKey('permission.declareExact')
			perms.declareExact(nsKey, local, def)
			const node = `${nsKey}.${local}`
			const ref = perms.resolver.resolve(node)
			if (!ref) throw new Error(`[Permissions] permission.declareExact(): failed to resolve declared permission: ${node}`)
			return permResolved(node, ref)
		},
		declareStar(localPrefix: string, def: { default: PermissionEffect } & PermissionMeta): void {
			const nsKey = requireNamespaceKey('permission.declareStar')
			perms.declareStar(nsKey, localPrefix, def)
		},
		perm(local: string): PermRef {
			const nsKey = requireNamespaceKey('permission.perm')
			const node = `${nsKey}.${local}`
			const ref = perms.resolver.resolve(node)
			if (!ref) throw new Error(`[Permissions] permission.perm(): undeclared permission node: ${node}`)
			return permResolved(node, ref)
		},
	}) as ChatbotsPermissionFacade
}
