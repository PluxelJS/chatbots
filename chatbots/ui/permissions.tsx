import {
	Badge,
	Box,
	Button,
	Checkbox,
	Group,
	NumberInput,
	Paper,
	ScrollArea,
	Select,
	Stack,
	Table,
	Tabs,
	Text,
	TextInput,
	Tooltip,
} from '@mantine/core'
import { IconKey, IconPlus, IconSearch, IconShield, IconUser, IconUsers } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PermissionGrantDto } from '../core/permissions-types'
import {
	BulkActions,
	GrantsTable,
	PageHeader,
	Panel,
	PermissionPicker,
	RefreshButton,
} from './components'
import {
	formatGrantNode,
	usePermissionCatalog,
	useRoleGrants,
	useRoles,
	useUserPermissions,
	useUserSearch,
	type PermissionEffect,
	type UserSearchResult,
} from './hooks'
import { useChatUiColorScheme } from './styles'

// ─────────────────────────────────────────────────────────────────────────────
// Roles Panel - 角色管理面板
// ─────────────────────────────────────────────────────────────────────────────

type RolesPanelProps = {
	roles: ReturnType<typeof useRoles>
	selectedRoleId: number | null
	onSelectRole: (id: number) => void
}

function RolesPanel({ roles, selectedRoleId, onSelectRole }: RolesPanelProps) {
	const [newName, setNewName] = useState('')
	const [newRank, setNewRank] = useState<number | ''>(0)
	const [newParentId, setNewParentId] = useState<string | null>(null)

	const handleCreate = useCallback(async () => {
		const rank = typeof newRank === 'number' ? newRank : 0
		const parent = newParentId ? Number(newParentId) : null
		const name = newName.trim() || null
		const id = await roles.createRole(parent, rank, name)
		onSelectRole(id)
		setNewName('')
		setNewParentId(null)
		setNewRank(0)
	}, [newName, newParentId, newRank, onSelectRole, roles])

	return (
		<Panel
			title="Roles"
			actions={
				<Tooltip label="Create role">
					<Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={handleCreate}>
						Create
					</Button>
				</Tooltip>
			}
		>
			<Stack gap="xs" mb="sm">
				<TextInput
					label="Name"
					size="xs"
					placeholder="Optional role name"
					value={newName}
					onChange={(e) => setNewName(e.currentTarget.value)}
				/>
				<Select
					label="Parent role"
					size="xs"
					value={newParentId}
					data={[{ value: '', label: 'No parent' }, ...roles.options]}
					onChange={(v) => setNewParentId(v || null)}
				/>
				<NumberInput label="Rank" size="xs" value={newRank} onChange={setNewRank} min={0} />
			</Stack>
			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<Table highlightOnHover withTableBorder verticalSpacing="xs" horizontalSpacing="xs">
					<Table.Thead>
						<Table.Tr>
							<Table.Th>Name</Table.Th>
							<Table.Th>Parent</Table.Th>
							<Table.Th>Rank</Table.Th>
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{roles.roles.map((role) => (
							<Table.Tr
								key={role.roleId}
								onClick={() => onSelectRole(role.roleId)}
								style={{
									cursor: 'pointer',
									backgroundColor:
										role.roleId === selectedRoleId ? 'var(--mantine-color-blue-light)' : undefined,
								}}
							>
								<Table.Td>
									<Text size="sm" fw={500}>
										{role.name || <Text span c="dimmed">#{role.roleId}</Text>}
									</Text>
								</Table.Td>
								<Table.Td>
									<Text size="sm" c="dimmed">
										{role.parentRoleId ?? '—'}
									</Text>
								</Table.Td>
								<Table.Td>
									<Badge size="xs" variant="light" color="gray">
										{role.rank}
									</Badge>
								</Table.Td>
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			</ScrollArea>
		</Panel>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Role Grants Panel - 角色权限授权面板 (优化布局)
// ─────────────────────────────────────────────────────────────────────────────

type RoleGrantsPanelProps = {
	roleId: number | null
	roles: ReturnType<typeof useRoles>
	catalog: ReturnType<typeof usePermissionCatalog>
	grants: ReturnType<typeof useRoleGrants>
}

function RoleGrantsPanel({ roleId, roles, catalog, grants }: RoleGrantsPanelProps) {
	const role = useMemo(() => roles.roles.find((r) => r.roleId === roleId), [roleId, roles.roles])

	const [selectedNodes, setSelectedNodes] = useState<string[]>([])
	const [effect, setEffect] = useState<PermissionEffect>('allow')
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
	const [name, setName] = useState('')
	const [parentId, setParentId] = useState<string | null>(null)
	const [rank, setRank] = useState<number | ''>(0)
	const [search, setSearch] = useState('')

	useEffect(() => {
		if (!role) {
			setName('')
			setParentId(null)
			setRank('')
			return
		}
		setName(role.name ?? '')
		setParentId(role.parentRoleId === null ? null : String(role.parentRoleId))
		setRank(role.rank)
	}, [role])

	useEffect(() => {
		setSelectedIds(new Set())
		setSearch('')
	}, [roleId])

	// 过滤后的 grants
	const filteredGrants = useMemo(() => {
		if (!search.trim()) return grants.grants
		const q = search.toLowerCase()
		return grants.grants.filter((g) => formatGrantNode(g).toLowerCase().includes(q))
	}, [grants.grants, search])

	const handleAdd = useCallback(async () => {
		if (!selectedNodes.length) return
		await grants.grantMany(selectedNodes, effect)
		setSelectedNodes([])
	}, [effect, grants, selectedNodes])

	const handleBulkAllow = useCallback(async () => {
		const nodes = grants.grants.filter((g) => selectedIds.has(g.id)).map(formatGrantNode)
		await grants.grantMany(nodes, 'allow')
		setSelectedIds(new Set())
	}, [grants, selectedIds])

	const handleBulkDeny = useCallback(async () => {
		const nodes = grants.grants.filter((g) => selectedIds.has(g.id)).map(formatGrantNode)
		await grants.grantMany(nodes, 'deny')
		setSelectedIds(new Set())
	}, [grants, selectedIds])

	const handleBulkRevoke = useCallback(async () => {
		const nodes = grants.grants.filter((g) => selectedIds.has(g.id)).map(formatGrantNode)
		await grants.revokeMany(nodes)
		setSelectedIds(new Set())
	}, [grants, selectedIds])

	const handleRevoke = useCallback(
		(grant: PermissionGrantDto) => {
			void grants.revoke(formatGrantNode(grant))
		},
		[grants],
	)

	const handleSave = useCallback(async () => {
		if (!role) return
		await roles.updateRole(role.roleId, {
			name: name.trim() || null,
			parentRoleId: parentId ? Number(parentId) : null,
			rank: typeof rank === 'number' ? rank : role.rank,
		})
	}, [name, parentId, rank, role, roles])

	if (!role) {
		return (
			<Panel title="Role grants" icon={<IconKey size={16} />}>
				<Text size="sm" c="dimmed" ta="center" py="xl">
					Select a role to manage grants.
				</Text>
			</Panel>
		)
	}

	return (
		<Panel
			title="Role grants"
			icon={<IconKey size={16} />}
			badge={<Badge variant="light" color="gray">{role.name || `#${role.roleId}`}</Badge>}
		>
			<Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
				{/* 顶部：角色设置 + 添加权限 */}
				<Group align="flex-end" gap="sm" wrap="wrap">
					<TextInput
						label="Name"
						size="xs"
						style={{ width: 140 }}
						placeholder="Role name"
						value={name}
						onChange={(e) => setName(e.currentTarget.value)}
					/>
					<Select
						label="Parent"
						size="xs"
						style={{ width: 140 }}
						value={parentId ?? ''}
						data={[
							{ value: '', label: 'None' },
							...roles.options.filter((opt) => opt.value !== String(role.roleId)),
						]}
						onChange={(v) => setParentId(v || null)}
					/>
					<NumberInput label="Rank" size="xs" style={{ width: 80 }} value={rank} onChange={(v) => setRank(typeof v === 'number' ? v : '')} min={0} />
					<Button size="xs" variant="light" onClick={handleSave}>
						Save
					</Button>
				</Group>

				<PermissionPicker
					nodes={catalog.nodes}
					infoByNode={catalog.infoByNode}
					value={selectedNodes}
					onChange={setSelectedNodes}
					effect={effect}
					onEffectChange={setEffect}
					onAdd={handleAdd}
				/>

				{/* 搜索 + 批量操作 */}
				<Group gap="sm" align="center">
					<TextInput
						placeholder="Search grants..."
						size="xs"
						leftSection={<IconSearch size={14} />}
						value={search}
						onChange={(e) => setSearch(e.currentTarget.value)}
						style={{ flex: 1, maxWidth: 240 }}
					/>
					<Text size="xs" c="dimmed">
						{filteredGrants.length}/{grants.grants.length} grants
					</Text>
				</Group>

				<BulkActions
					selectedCount={selectedIds.size}
					onBulkAllow={handleBulkAllow}
					onBulkDeny={handleBulkDeny}
					onBulkRevoke={handleBulkRevoke}
					onClear={() => setSelectedIds(new Set())}
				/>

				<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
					<GrantsTable
						grants={filteredGrants}
						selectedIds={selectedIds}
						onSelectChange={setSelectedIds}
						onToggleEffect={grants.toggleEffect}
						onRevoke={handleRevoke}
					/>
				</ScrollArea>
			</Stack>
		</Panel>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// User Lookup Panel - 用户查找面板
// ─────────────────────────────────────────────────────────────────────────────

type UserLookupPanelProps = {
	userId: number | null
	onLoadUser: (id: number) => void
	roles: ReturnType<typeof useRoles>
	userPerms: ReturnType<typeof useUserPermissions>
	userSearch: ReturnType<typeof useUserSearch>
	activeUser: UserSearchResult | null
	onActiveUserChange: (user: UserSearchResult | null) => void
}

function UserLookupPanel({ userId, onLoadUser, roles, userPerms, userSearch, activeUser, onActiveUserChange }: UserLookupPanelProps) {
	const [input, setInput] = useState('')

	const handleSearch = useCallback(() => {
		const trimmed = input.trim()
		if (!trimmed) return
		const parsed = Number(trimmed)
		if (Number.isFinite(parsed)) {
			onLoadUser(parsed)
			userSearch.getById(parsed).then((user) => {
				onActiveUserChange(user)
			})
		} else {
			void userSearch.search(trimmed)
		}
	}, [input, onLoadUser, userSearch, onActiveUserChange])

	const handleSelectUser = useCallback(
		(user: UserSearchResult) => {
			onLoadUser(user.id)
			onActiveUserChange(user)
			userSearch.clear()
			setInput('')
		},
		[onLoadUser, onActiveUserChange, userSearch],
	)

	const handleToggleRole = useCallback(
		async (roleId: number, assigned: boolean) => {
			if (assigned) {
				await userPerms.unassignRole(roleId)
			} else {
				await userPerms.assignRole(roleId)
			}
		},
		[userPerms],
	)

	return (
		<Panel
			title="User lookup"
			actions={
				<Button size="xs" variant="light" onClick={handleSearch} loading={userSearch.loading}>
					Search
				</Button>
			}
		>
			<Stack gap="sm" mb="sm">
				<TextInput
					label="User ID or Name"
					size="xs"
					placeholder="Enter user id or display name"
					value={input}
					onChange={(e) => setInput(e.currentTarget.value)}
					onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
				/>
				{userId !== null && activeUser && (
					<Group gap="xs">
						<Badge variant="light" color="blue">
							#{userId}
						</Badge>
						{activeUser.displayName && (
							<Badge variant="light" color="grape">
								{activeUser.displayName}
							</Badge>
						)}
						{activeUser.identities.map((i) => (
							<Badge key={`${i.platform}:${i.platformUserId}`} variant="light" color="gray" size="xs">
								{i.platform}: {i.platformUserId}
							</Badge>
						))}
					</Group>
				)}
				{userId !== null && !activeUser && (
					<Badge variant="light" color="blue">
						Active: #{userId}
					</Badge>
				)}
			</Stack>

			{/* Search Results */}
			{userSearch.results.length > 0 && (
				<>
					<Text fw={600} size="sm" mb="xs">
						Search results ({userSearch.results.length})
					</Text>
					<ScrollArea style={{ maxHeight: 160 }} type="auto" offsetScrollbars mb="sm">
						<Stack gap="xs">
							{userSearch.results.map((user) => (
								<Paper
									key={user.id}
									withBorder
									p="xs"
									style={{ cursor: 'pointer' }}
									onClick={() => handleSelectUser(user)}
								>
									<Group justify="space-between" align="center">
										<Group gap="xs">
											<Text size="sm" fw={500}>
												{user.displayName || <Text span c="dimmed">No name</Text>}
											</Text>
											<Badge size="xs" variant="light" color="gray">
												#{user.id}
											</Badge>
										</Group>
										<Group gap={4}>
											{user.identities.slice(0, 2).map((i) => (
												<Badge key={`${i.platform}:${i.platformUserId}`} size="xs" variant="outline" color="gray">
													{i.platform}
												</Badge>
											))}
										</Group>
									</Group>
								</Paper>
							))}
						</Stack>
					</ScrollArea>
				</>
			)}

			<Text fw={600} size="sm" mb="xs">
				Role assignments
			</Text>
			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<Stack gap="xs">
					{roles.roles.map((role) => {
						const assigned = userPerms.roleIds.includes(role.roleId)
						return (
							<Group key={role.roleId} justify="space-between" align="center">
								<Group gap="xs">
									<Checkbox
										checked={assigned}
										disabled={userId === null}
										onChange={() => handleToggleRole(role.roleId, assigned)}
									/>
									<Text size="sm">{role.name || `Role #${role.roleId}`}</Text>
								</Group>
								<Badge size="xs" variant="light" color="gray">
									Rank {role.rank}
								</Badge>
							</Group>
						)
					})}
				</Stack>
			</ScrollArea>
		</Panel>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// User Grants Panel - 用户权限授权面板 (优化布局)
// ─────────────────────────────────────────────────────────────────────────────

type UserGrantsPanelProps = {
	userId: number | null
	catalog: ReturnType<typeof usePermissionCatalog>
	userPerms: ReturnType<typeof useUserPermissions>
}

function UserGrantsPanel({ userId, catalog, userPerms }: UserGrantsPanelProps) {
	const [selectedNodes, setSelectedNodes] = useState<string[]>([])
	const [effect, setEffect] = useState<PermissionEffect>('allow')
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
	const [search, setSearch] = useState('')

	useEffect(() => {
		setSelectedIds(new Set())
		setSearch('')
	}, [userId])

	// 过滤后的 grants
	const filteredGrants = useMemo(() => {
		if (!search.trim()) return userPerms.grants
		const q = search.toLowerCase()
		return userPerms.grants.filter((g) => formatGrantNode(g).toLowerCase().includes(q))
	}, [userPerms.grants, search])

	const handleAdd = useCallback(async () => {
		if (!selectedNodes.length) return
		await userPerms.grantMany(selectedNodes, effect)
		setSelectedNodes([])
	}, [effect, selectedNodes, userPerms])

	const handleBulkAllow = useCallback(async () => {
		const nodes = userPerms.grants.filter((g) => selectedIds.has(g.id)).map(formatGrantNode)
		await userPerms.grantMany(nodes, 'allow')
		setSelectedIds(new Set())
	}, [selectedIds, userPerms])

	const handleBulkDeny = useCallback(async () => {
		const nodes = userPerms.grants.filter((g) => selectedIds.has(g.id)).map(formatGrantNode)
		await userPerms.grantMany(nodes, 'deny')
		setSelectedIds(new Set())
	}, [selectedIds, userPerms])

	const handleBulkRevoke = useCallback(async () => {
		const nodes = userPerms.grants.filter((g) => selectedIds.has(g.id)).map(formatGrantNode)
		await userPerms.revokeMany(nodes)
		setSelectedIds(new Set())
	}, [selectedIds, userPerms])

	const handleRevoke = useCallback(
		(grant: PermissionGrantDto) => {
			void userPerms.revoke(formatGrantNode(grant))
		},
		[userPerms],
	)

	if (userId === null) {
		return (
			<Panel title="User grants" icon={<IconKey size={16} />}>
				<Text size="sm" c="dimmed" ta="center" py="xl">
					Load a user to manage grants.
				</Text>
			</Panel>
		)
	}

	return (
		<Panel
			title="User grants"
			icon={<IconKey size={16} />}
			badge={<Badge variant="light" color="gray">User #{userId}</Badge>}
		>
			<Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
				{/* 顶部：添加权限 */}
				<PermissionPicker
					nodes={catalog.nodes}
					infoByNode={catalog.infoByNode}
					value={selectedNodes}
					onChange={setSelectedNodes}
					effect={effect}
					onEffectChange={setEffect}
					onAdd={handleAdd}
				/>

				{/* 搜索 + 批量操作 */}
				<Group gap="sm" align="center">
					<TextInput
						placeholder="Search grants..."
						size="xs"
						leftSection={<IconSearch size={14} />}
						value={search}
						onChange={(e) => setSearch(e.currentTarget.value)}
						style={{ flex: 1, maxWidth: 240 }}
					/>
					<Text size="xs" c="dimmed">
						{filteredGrants.length}/{userPerms.grants.length} grants
					</Text>
				</Group>

				<BulkActions
					selectedCount={selectedIds.size}
					onBulkAllow={handleBulkAllow}
					onBulkDeny={handleBulkDeny}
					onBulkRevoke={handleBulkRevoke}
					onClear={() => setSelectedIds(new Set())}
				/>

				<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
					<GrantsTable
						grants={filteredGrants}
						selectedIds={selectedIds}
						onSelectChange={setSelectedIds}
						onToggleEffect={userPerms.toggleEffect}
						onRevoke={handleRevoke}
					/>
				</ScrollArea>
			</Stack>
		</Panel>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export function ChatbotsPermissionsPage() {
	useChatUiColorScheme()

	const catalog = usePermissionCatalog()
	const roles = useRoles()
	const userSearch = useUserSearch()

	const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
	const [activeUserId, setActiveUserId] = useState<number | null>(null)
	const [activeUser, setActiveUser] = useState<UserSearchResult | null>(null)

	const roleGrants = useRoleGrants(selectedRoleId)
	const userPerms = useUserPermissions(activeUserId)

	// Auto-select first role
	useEffect(() => {
		if (roles.roles.length && selectedRoleId === null) {
			setSelectedRoleId(roles.roles[0]!.roleId)
		}
	}, [roles.roles, selectedRoleId])

	const error = catalog.error || roles.error || roleGrants.error || userPerms.error
	const loading = catalog.loading || roles.loading

	const handleRefresh = useCallback(async () => {
		await Promise.all([catalog.refresh(), roles.refresh()])
		if (selectedRoleId) await roleGrants.refresh()
		if (activeUserId !== null) await userPerms.refresh()
	}, [activeUserId, catalog, roleGrants, roles, selectedRoleId, userPerms])

	return (
		<Box style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
			<PageHeader
				icon={<IconShield size={22} />}
				title="Permissions Console"
				subtitle="Manage roles, grants, and user assignments."
				badges={
					<Badge variant="light" color="grape">
						{catalog.nodes.length} nodes
					</Badge>
				}
				actions={<RefreshButton onClick={handleRefresh} loading={loading} />}
				error={error}
			/>

			<Tabs defaultValue="roles" variant="outline" radius="md" keepMounted={false} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
				<Tabs.List>
					<Tabs.Tab value="roles" leftSection={<IconUsers size={14} />}>
						Roles
					</Tabs.Tab>
					<Tabs.Tab value="users" leftSection={<IconUser size={14} />}>
						Users
					</Tabs.Tab>
				</Tabs.List>

				<Tabs.Panel value="roles" style={{ flex: 1, minHeight: 0 }}>
					<Box
						style={{
							display: 'grid',
							gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)',
							gap: 16,
							height: '100%',
							minHeight: 0,
						}}
					>
						<RolesPanel roles={roles} selectedRoleId={selectedRoleId} onSelectRole={setSelectedRoleId} />
						<RoleGrantsPanel
							roleId={selectedRoleId}
							roles={roles}
							catalog={catalog}
							grants={roleGrants}
						/>
					</Box>
				</Tabs.Panel>

				<Tabs.Panel value="users" style={{ flex: 1, minHeight: 0 }}>
					<Box
						style={{
							display: 'grid',
							gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)',
							gap: 16,
							height: '100%',
							minHeight: 0,
						}}
					>
						<UserLookupPanel
							userId={activeUserId}
							onLoadUser={setActiveUserId}
							roles={roles}
							userPerms={userPerms}
							userSearch={userSearch}
							activeUser={activeUser}
							onActiveUserChange={setActiveUser}
						/>
						<UserGrantsPanel userId={activeUserId} catalog={catalog} userPerms={userPerms} />
					</Box>
				</Tabs.Panel>
			</Tabs>
		</Box>
	)
}
