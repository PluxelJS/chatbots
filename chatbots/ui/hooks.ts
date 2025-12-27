import { hmrWebClient, rpcErrorMessage } from '@pluxel/hmr/web'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
	PermissionCatalogNamespace,
	PermissionGrantDto,
	PermissionRoleDto,
} from '../core/permissions-types'

export type PermissionEffect = 'allow' | 'deny'

export type PermissionInfo = {
	kind: 'exact' | 'star'
	default: PermissionEffect
	description?: string
	nsKey: string
}

export type UserSearchResult = {
	id: number
	displayName: string | null
	identities: { platform: string; platformUserId: string }[]
}

type PermissionsRpc = {
	catalog: () => Promise<PermissionCatalogNamespace[]>
	listRoles: () => Promise<PermissionRoleDto[]>
	listRoleGrants: (roleId: number) => Promise<PermissionGrantDto[]>
	listUserRoles: (userId: number) => Promise<number[]>
	listUserGrants: (userId: number) => Promise<PermissionGrantDto[]>
	createRole: (parentRoleId: number | null, rank: number, name?: string | null) => Promise<number>
	updateRole: (roleId: number, patch: { parentRoleId?: number | null; rank?: number; name?: string | null }) => Promise<void>
	assignRoleToUser: (userId: number, roleId: number) => Promise<void>
	unassignRoleFromUser: (userId: number, roleId: number) => Promise<void>
	grant: (subjectType: 'user' | 'role', subjectId: number, effect: PermissionEffect, node: string) => Promise<void>
	revoke: (subjectType: 'user' | 'role', subjectId: number, node: string) => Promise<void>
	searchUsers: (query: string, limit?: number) => Promise<UserSearchResult[]>
	getUser: (userId: number) => Promise<UserSearchResult | null>
}

export const getPermissionsRpc = (): PermissionsRpc =>
	(hmrWebClient.rpc as any).chatbots as PermissionsRpc

export const formatGrantNode = (grant: PermissionGrantDto) => {
	if (grant.kind === 'star') {
		return `${grant.nsKey}.${grant.local ? `${grant.local}.*` : '*'}`
	}
	return `${grant.nsKey}.${grant.local}`
}

export const formatTimestamp = (value: string) => {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return date.toLocaleString()
}

export function usePermissionCatalog() {
	const [catalog, setCatalog] = useState<PermissionCatalogNamespace[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			const data = await getPermissionsRpc().catalog()
			setCatalog(data)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load permission catalog'))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const nodes = useMemo(() => {
		const items = catalog.flatMap((ns) => ns.permissions.map((perm) => perm.node))
		return Array.from(new Set(items)).sort()
	}, [catalog])

	const infoByNode = useMemo(() => {
		const map = new Map<string, PermissionInfo>()
		for (const ns of catalog) {
			for (const perm of ns.permissions) {
				map.set(perm.node, {
					kind: perm.kind,
					default: perm.default,
					description: perm.meta?.description,
					nsKey: ns.nsKey,
				})
			}
		}
		return map
	}, [catalog])

	return { catalog, nodes, infoByNode, loading, error, refresh }
}

export function useRoles() {
	const [roles, setRoles] = useState<PermissionRoleDto[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			const data = await getPermissionsRpc().listRoles()
			setRoles(data)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load roles'))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const options = useMemo(
		() => roles.map((role) => ({
			value: String(role.roleId),
			label: role.name ? `${role.name} (#${role.roleId})` : `Role #${role.roleId}`,
		})),
		[roles],
	)

	const createRole = useCallback(async (parentRoleId: number | null, rank: number, name?: string | null) => {
		const id = await getPermissionsRpc().createRole(parentRoleId, rank, name)
		await refresh()
		return id
	}, [refresh])

	const updateRole = useCallback(
		async (roleId: number, patch: { parentRoleId?: number | null; rank?: number; name?: string | null }) => {
			await getPermissionsRpc().updateRole(roleId, patch)
			await refresh()
		},
		[refresh],
	)

	return { roles, options, loading, error, refresh, createRole, updateRole }
}

export function useRoleGrants(roleId: number | null) {
	const [grants, setGrants] = useState<PermissionGrantDto[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		if (roleId === null) {
			setGrants([])
			return
		}
		setLoading(true)
		try {
			const data = await getPermissionsRpc().listRoleGrants(roleId)
			setGrants(data)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load role grants'))
		} finally {
			setLoading(false)
		}
	}, [roleId])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const grant = useCallback(
		async (node: string, effect: PermissionEffect) => {
			if (roleId === null) return
			await getPermissionsRpc().grant('role', roleId, effect, node)
			await refresh()
		},
		[roleId, refresh],
	)

	const grantMany = useCallback(
		async (nodes: string[], effect: PermissionEffect) => {
			if (roleId === null || !nodes.length) return
			for (const node of nodes) {
				await getPermissionsRpc().grant('role', roleId, effect, node)
			}
			await refresh()
		},
		[roleId, refresh],
	)

	const revoke = useCallback(
		async (node: string) => {
			if (roleId === null) return
			await getPermissionsRpc().revoke('role', roleId, node)
			await refresh()
		},
		[roleId, refresh],
	)

	const revokeMany = useCallback(
		async (nodes: string[]) => {
			if (roleId === null || !nodes.length) return
			for (const node of nodes) {
				await getPermissionsRpc().revoke('role', roleId, node)
			}
			await refresh()
		},
		[roleId, refresh],
	)

	const toggleEffect = useCallback(
		async (grant: PermissionGrantDto) => {
			if (roleId === null) return
			const node = formatGrantNode(grant)
			const newEffect: PermissionEffect = grant.effect === 'allow' ? 'deny' : 'allow'
			await getPermissionsRpc().grant('role', roleId, newEffect, node)
			await refresh()
		},
		[roleId, refresh],
	)

	return { grants, loading, error, refresh, grant, grantMany, revoke, revokeMany, toggleEffect }
}

export function useUserPermissions(userId: number | null) {
	const [roleIds, setRoleIds] = useState<number[]>([])
	const [grants, setGrants] = useState<PermissionGrantDto[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		if (userId === null) {
			setRoleIds([])
			setGrants([])
			return
		}
		setLoading(true)
		try {
			const [rolesData, grantsData] = await Promise.all([
				getPermissionsRpc().listUserRoles(userId),
				getPermissionsRpc().listUserGrants(userId),
			])
			setRoleIds(rolesData)
			setGrants(grantsData)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load user permissions'))
		} finally {
			setLoading(false)
		}
	}, [userId])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const assignRole = useCallback(
		async (roleId: number) => {
			if (userId === null) return
			await getPermissionsRpc().assignRoleToUser(userId, roleId)
			await refresh()
		},
		[userId, refresh],
	)

	const unassignRole = useCallback(
		async (roleId: number) => {
			if (userId === null) return
			await getPermissionsRpc().unassignRoleFromUser(userId, roleId)
			await refresh()
		},
		[userId, refresh],
	)

	const grant = useCallback(
		async (node: string, effect: PermissionEffect) => {
			if (userId === null) return
			await getPermissionsRpc().grant('user', userId, effect, node)
			await refresh()
		},
		[userId, refresh],
	)

	const grantMany = useCallback(
		async (nodes: string[], effect: PermissionEffect) => {
			if (userId === null || !nodes.length) return
			for (const node of nodes) {
				await getPermissionsRpc().grant('user', userId, effect, node)
			}
			await refresh()
		},
		[userId, refresh],
	)

	const revoke = useCallback(
		async (node: string) => {
			if (userId === null) return
			await getPermissionsRpc().revoke('user', userId, node)
			await refresh()
		},
		[userId, refresh],
	)

	const revokeMany = useCallback(
		async (nodes: string[]) => {
			if (userId === null || !nodes.length) return
			for (const node of nodes) {
				await getPermissionsRpc().revoke('user', userId, node)
			}
			await refresh()
		},
		[userId, refresh],
	)

	const toggleEffect = useCallback(
		async (grant: PermissionGrantDto) => {
			if (userId === null) return
			const node = formatGrantNode(grant)
			const newEffect: PermissionEffect = grant.effect === 'allow' ? 'deny' : 'allow'
			await getPermissionsRpc().grant('user', userId, newEffect, node)
			await refresh()
		},
		[userId, refresh],
	)

	return {
		roleIds,
		grants,
		loading,
		error,
		refresh,
		assignRole,
		unassignRole,
		grant,
		grantMany,
		revoke,
		revokeMany,
		toggleEffect,
	}
}

export function useUserSearch() {
	const [results, setResults] = useState<UserSearchResult[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const search = useCallback(async (query: string) => {
		const trimmed = query.trim()
		if (!trimmed) {
			setResults([])
			return
		}
		setLoading(true)
		try {
			const data = await getPermissionsRpc().searchUsers(trimmed, 20)
			setResults(data)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to search users'))
		} finally {
			setLoading(false)
		}
	}, [])

	const getById = useCallback(async (userId: number): Promise<UserSearchResult | null> => {
		try {
			return await getPermissionsRpc().getUser(userId)
		} catch {
			return null
		}
	}, [])

	const clear = useCallback(() => {
		setResults([])
		setError(null)
	}, [])

	return { results, loading, error, search, getById, clear }
}
