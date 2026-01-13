import { rpcErrorMessage } from '@pluxel/hmr/web'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useChatbotsRpc, type PermissionCatalogNamespace, type PermissionEffect, type PermissionExplainDto, type PermissionGrantDto, type PermissionRoleDto, type UnifiedUserDto } from '../../api'

export type PermissionInfo = {
	kind: 'exact' | 'star'
	default: PermissionEffect
	description?: string
	nsKey: string
}

type GrantNodeLike = {
	kind?: PermissionGrantDto['kind']
	nsKey?: string
	local?: string
	node?: string
}

const sanitizeNode = (node: string) => node.trim()

export const formatGrantNode = (grant: GrantNodeLike) => {
	if (typeof grant.node === 'string') {
		const node = sanitizeNode(grant.node)
		if (node) return node
	}
	const nsKey = typeof grant.nsKey === 'string' ? grant.nsKey.trim() : ''
	const local = typeof grant.local === 'string' ? grant.local.trim() : ''
	if (!nsKey) return local || '(unknown)'
	if (grant.kind === 'star') {
		return local ? `${nsKey}.${local}.*` : `${nsKey}.*`
	}
	return local ? `${nsKey}.${local}` : nsKey
}

export const formatTimestamp = (value: string) => {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return date.toLocaleString()
}

export function usePermissionCatalog() {
	const rpc = useChatbotsRpc()
	const [catalog, setCatalog] = useState<PermissionCatalogNamespace[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			const data = await rpc.catalog()
			setCatalog(data)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load permission catalog'))
		} finally {
			setLoading(false)
		}
	}, [rpc])

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
	const rpc = useChatbotsRpc()
	const [roles, setRoles] = useState<PermissionRoleDto[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		try {
			const data = await rpc.listRoles()
			const sorted = [...data].sort((a, b) => {
				const rankDelta = b.rank - a.rank
				if (rankDelta !== 0) return rankDelta
				return a.roleId - b.roleId
			})
			setRoles(sorted)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load roles'))
		} finally {
			setLoading(false)
		}
	}, [rpc])

	useEffect(() => {
		void refresh()
	}, [refresh])

		const options = useMemo(
			() => roles.map((role) => ({
				value: String(role.roleId),
				label: role.name ? `${role.name} · r${role.rank} · #${role.roleId}` : `#${role.roleId} · r${role.rank}`,
			})),
			[roles],
		)

	const createRole = useCallback(async (parentRoleId: number | null, rank: number, name?: string | null) => {
		const id = await rpc.createRole(parentRoleId, rank, name)
		await refresh()
		return id
	}, [refresh, rpc])

	const updateRole = useCallback(
		async (roleId: number, patch: { parentRoleId?: number | null; rank?: number; name?: string | null }) => {
			await rpc.updateRole(roleId, patch)
			await refresh()
		},
		[refresh, rpc],
	)

	const deleteRole = useCallback(async (roleId: number) => {
		await rpc.deleteRole(roleId)
		await refresh()
	}, [refresh, rpc])

	return { roles, options, loading, error, refresh, createRole, updateRole, deleteRole }
}

export function useRoleGrants(roleId: number | null) {
	const rpc = useChatbotsRpc()
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
			const data = await rpc.listRoleGrants(roleId)
			setGrants(data)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load role grants'))
		} finally {
			setLoading(false)
		}
	}, [roleId, rpc])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const grant = useCallback(
		async (node: string, effect: PermissionEffect) => {
			if (roleId === null) return
			await rpc.grant('role', roleId, effect, node)
			await refresh()
		},
		[roleId, refresh, rpc],
	)

	const grantMany = useCallback(
		async (nodes: string[], effect: PermissionEffect) => {
			if (roleId === null || !nodes.length) return
			await rpc.grantMany('role', roleId, effect, nodes)
			await refresh()
		},
		[roleId, refresh, rpc],
	)

	const revoke = useCallback(
		async (node: string) => {
			if (roleId === null) return
			await rpc.revoke('role', roleId, node)
			await refresh()
		},
		[roleId, refresh, rpc],
	)

	const revokeMany = useCallback(
		async (nodes: string[]) => {
			if (roleId === null || !nodes.length) return
			await rpc.revokeMany('role', roleId, nodes)
			await refresh()
		},
		[roleId, refresh, rpc],
	)

	const toggleEffect = useCallback(
		async (grant: PermissionGrantDto) => {
			if (roleId === null) return
			const node = formatGrantNode(grant)
			const newEffect: PermissionEffect = grant.effect === 'allow' ? 'deny' : 'allow'
			await rpc.grant('role', roleId, newEffect, node)
			await refresh()
		},
		[roleId, refresh, rpc],
	)

	return { grants, loading, error, refresh, grant, grantMany, revoke, revokeMany, toggleEffect }
}

export function useUserPermissions(userId: number | null) {
	const rpc = useChatbotsRpc()
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
				rpc.listUserRoles(userId),
				rpc.listUserGrants(userId),
			])
			setRoleIds(rolesData)
			setGrants(grantsData)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to load user permissions'))
		} finally {
			setLoading(false)
		}
	}, [rpc, userId])

	useEffect(() => {
		void refresh()
	}, [refresh])

	const assignRole = useCallback(
		async (roleId: number) => {
			if (userId === null) return
			await rpc.assignRoleToUser(userId, roleId)
			await refresh()
		},
		[userId, refresh, rpc],
	)

	const assignRoleMany = useCallback(async (roleIds: number[]) => {
		if (userId === null || !roleIds.length) return
		await rpc.assignRolesToUser(userId, roleIds)
		await refresh()
	}, [userId, refresh, rpc])

	const unassignRole = useCallback(
		async (roleId: number) => {
			if (userId === null) return
			await rpc.unassignRoleFromUser(userId, roleId)
			await refresh()
		},
		[userId, refresh, rpc],
	)

	const unassignRoleMany = useCallback(async (roleIds: number[]) => {
		if (userId === null || !roleIds.length) return
		await rpc.unassignRolesFromUser(userId, roleIds)
		await refresh()
	}, [userId, refresh, rpc])

	const grant = useCallback(
		async (node: string, effect: PermissionEffect) => {
			if (userId === null) return
			await rpc.grant('user', userId, effect, node)
			await refresh()
		},
		[userId, refresh, rpc],
	)

	const grantMany = useCallback(
		async (nodes: string[], effect: PermissionEffect) => {
			if (userId === null || !nodes.length) return
			await rpc.grantMany('user', userId, effect, nodes)
			await refresh()
		},
		[userId, refresh, rpc],
	)

	const revoke = useCallback(
		async (node: string) => {
			if (userId === null) return
			await rpc.revoke('user', userId, node)
			await refresh()
		},
		[userId, refresh, rpc],
	)

	const revokeMany = useCallback(
		async (nodes: string[]) => {
			if (userId === null || !nodes.length) return
			await rpc.revokeMany('user', userId, nodes)
			await refresh()
		},
		[userId, refresh, rpc],
	)

	const toggleEffect = useCallback(
		async (grant: PermissionGrantDto) => {
			if (userId === null) return
			const node = formatGrantNode(grant)
			const newEffect: PermissionEffect = grant.effect === 'allow' ? 'deny' : 'allow'
			await rpc.grant('user', userId, newEffect, node)
			await refresh()
		},
		[userId, refresh, rpc],
	)

	return {
		roleIds,
		grants,
		loading,
		error,
		refresh,
		assignRole,
		assignRoleMany,
		unassignRole,
		unassignRoleMany,
		grant,
		grantMany,
		revoke,
		revokeMany,
		toggleEffect,
	}
}

export function useUserPermissionExplain(userId: number | null) {
	const rpc = useChatbotsRpc()
	const [result, setResult] = useState<PermissionExplainDto | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const clear = useCallback(() => {
		setResult(null)
		setError(null)
	}, [])

	useEffect(() => {
		clear()
	}, [clear, userId])

	const explain = useCallback(
		async (node: string) => {
			if (userId === null) return
			setLoading(true)
			try {
				const data = await rpc.explainUser(userId, node)
				setResult(data)
				setError(null)
			} catch (err) {
				setError(rpcErrorMessage(err, 'Failed to explain permission'))
			} finally {
				setLoading(false)
			}
		},
		[rpc, userId],
	)

	return { result, loading, error, explain, clear }
}

export function useUserSearch() {
	const rpc = useChatbotsRpc()
	const [results, setResults] = useState<UnifiedUserDto[]>([])
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
			const data = await rpc.searchUsersByName(trimmed, 20)
			setResults(data)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to search users'))
		} finally {
			setLoading(false)
		}
	}, [rpc])

	const getById = useCallback(async (userId: number): Promise<UnifiedUserDto | null> => {
		try {
			return await rpc.getUser(userId)
		} catch {
			return null
		}
	}, [rpc])

	const clear = useCallback(() => {
		setResults([])
		setError(null)
	}, [])

	return { results, loading, error, search, getById, clear }
}

export function useBulkUserRoleAssignments(userIds: number[]) {
	const rpc = useChatbotsRpc()
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const assignRole = useCallback(async (roleId: number) => {
		if (!userIds.length) return
		setLoading(true)
		try {
			await rpc.assignRoleToUsers(userIds, roleId)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to assign role to users'))
		} finally {
			setLoading(false)
		}
	}, [rpc, userIds])

	const unassignRole = useCallback(async (roleId: number) => {
		if (!userIds.length) return
		setLoading(true)
		try {
			await rpc.unassignRoleFromUsers(userIds, roleId)
			setError(null)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to unassign role from users'))
		} finally {
			setLoading(false)
		}
	}, [rpc, userIds])

	return { loading, error, assignRole, unassignRole }
}
