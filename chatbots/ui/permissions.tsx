import {
	ActionIcon,
	Avatar,
	Badge,
	Box,
	Button,
	Checkbox,
	Collapse,
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
import { useDisclosure } from '@mantine/hooks'
import {
	IconCheck,
	IconChevronDown,
	IconChevronRight,
	IconKey,
	IconPlus,
	IconSearch,
	IconShield,
	IconTrash,
	IconUser,
	IconUsers,
	IconX,
} from '@tabler/icons-react'
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
// Types for Batch Mode
// ─────────────────────────────────────────────────────────────────────────────

type PendingChange = {
	type: 'grant' | 'revoke' | 'toggle'
	node: string
	effect?: PermissionEffect
	originalEffect?: PermissionEffect
}

type PendingRoleChange = {
	userId: number
	roleId: number
	action: 'assign' | 'unassign'
}

const getGrantNode = (grant: PermissionGrantDto & { node?: string }) => formatGrantNode(grant)

const applyPendingGrantSelection = (
	next: Map<string, PendingChange>,
	node: string,
	desiredEffect: PermissionEffect,
	existingGrant?: PermissionGrantDto,
) => {
	const existing = next.get(node)
	if (existingGrant) {
		const originalEffect = existingGrant.effect
		if (desiredEffect === originalEffect) {
			next.delete(node)
			return
		}
		if (existing?.type === 'toggle') {
			if (existing.originalEffect === desiredEffect) {
				next.delete(node)
			} else {
				next.set(node, { ...existing, effect: desiredEffect, originalEffect })
			}
			return
		}
		next.set(node, { type: 'toggle', node, effect: desiredEffect, originalEffect })
		return
	}
	if (existing?.type === 'grant') {
		next.set(node, { ...existing, effect: desiredEffect })
		return
	}
	next.set(node, { type: 'grant', node, effect: desiredEffect })
}

// ─────────────────────────────────────────────────────────────────────────────
// Roles Panel - 角色管理面板 (创建表单可折叠)
// ─────────────────────────────────────────────────────────────────────────────

type RolesPanelProps = {
	roles: ReturnType<typeof useRoles>
	selectedRoleId: number | null
	onSelectRole: (id: number) => void
}

function RolesPanel({ roles, selectedRoleId, onSelectRole }: RolesPanelProps) {
	const [createOpened, { toggle: toggleCreate }] = useDisclosure(false)
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
		<Panel title="Roles">
			{/* Collapsible Create Form */}
			<Box mb="sm">
				<Button
					variant="subtle"
					size="xs"
					fullWidth
					justify="space-between"
					rightSection={createOpened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
					leftSection={<IconPlus size={14} />}
					onClick={toggleCreate}
				>
					Create new role
				</Button>
				<Collapse in={createOpened}>
					<Paper withBorder p="xs" mt="xs" radius="md" style={{ borderColor: 'var(--mantine-color-teal-4)', borderStyle: 'dashed' }}>
						<Stack gap="xs">
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
							<Button size="xs" variant="light" color="teal" onClick={handleCreate} leftSection={<IconPlus size={14} />}>
								Create
							</Button>
						</Stack>
					</Paper>
				</Collapse>
			</Box>

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
// Role Grants Panel - 角色权限授权面板 (批次模式)
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
	const [showPendingOnly, setShowPendingOnly] = useState(false)

	// Batch mode: pending changes
	const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map())

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
		setPendingChanges(new Map())
		setShowPendingOnly(false)
	}, [roleId])

	// Merge grants with pending changes for display
	const displayGrants = useMemo(() => {
		const result: Array<PermissionGrantDto & { pending?: 'add' | 'remove' | 'modify'; node?: string }> = []
		const seen = new Set<string>()

		// Existing grants
		for (const g of grants.grants) {
			const node = getGrantNode(g)
			seen.add(node)
			const pending = pendingChanges.get(node)
			if (pending?.type === 'revoke') {
				result.push({ ...g, node, pending: 'remove' })
			} else if (pending?.type === 'toggle') {
				result.push({ ...g, node, effect: pending.effect!, pending: 'modify' })
			} else {
				result.push({ ...g, node })
			}
		}

		// New pending grants
		for (const [node, change] of pendingChanges) {
			if (change.type === 'grant' && !seen.has(node)) {
				result.push({
					id: -Date.now() - Math.random(), // Temp ID
					kind: node.endsWith('.*') ? 'star' : 'exact',
					node,
					effect: change.effect!,
					updatedAt: new Date().toISOString(),
					pending: 'add',
				})
			}
		}

		return result
	}, [grants.grants, pendingChanges])

	const visibleGrants = useMemo(() => {
		const q = search.trim().toLowerCase()
		const base = q ? displayGrants.filter((g) => getGrantNode(g).toLowerCase().includes(q)) : displayGrants
		const filtered = showPendingOnly ? base.filter((g) => g.pending) : base
		const pendingRank = (pending?: 'add' | 'remove' | 'modify') => {
			if (pending === 'add') return 0
			if (pending === 'modify') return 1
			if (pending === 'remove') return 2
			return 3
		}
		return [...filtered].sort((a, b) => {
			const rankDelta = pendingRank(a.pending) - pendingRank(b.pending)
			if (rankDelta !== 0) return rankDelta
			return getGrantNode(a).localeCompare(getGrantNode(b))
		})
	}, [displayGrants, search, showPendingOnly])

	const hasPendingChanges = pendingChanges.size > 0
	const existingByNode = useMemo(() => {
		const map = new Map<string, PermissionGrantDto>()
		for (const grant of grants.grants) {
			map.set(getGrantNode(grant), grant)
		}
		return map
	}, [grants.grants])

	// Add to pending (batch mode)
	const handleAdd = useCallback(() => {
		if (!selectedNodes.length) return
		setPendingChanges((prev) => {
			const next = new Map(prev)
			for (const node of selectedNodes) {
				applyPendingGrantSelection(next, node, effect, existingByNode.get(node))
			}
			return next
		})
		setSelectedNodes([])
	}, [effect, existingByNode, selectedNodes])

	// Toggle effect in pending
	const handleToggleEffect = useCallback((grant: PermissionGrantDto & { pending?: string }) => {
		const node = getGrantNode(grant)
		const newEffect = grant.effect === 'allow' ? 'deny' : 'allow'

		setPendingChanges((prev) => {
			const next = new Map(prev)
			const existing = prev.get(node)

			if (grant.pending === 'add') {
				// Modify pending add
				next.set(node, { type: 'grant', node, effect: newEffect })
			} else if (existing?.type === 'toggle') {
				// If toggling back to original, remove from pending
				if (existing.originalEffect === newEffect) {
					next.delete(node)
				} else {
					next.set(node, { ...existing, effect: newEffect })
				}
			} else {
				// New toggle
				next.set(node, { type: 'toggle', node, effect: newEffect, originalEffect: grant.effect })
			}
			return next
		})
	}, [])

	// Revoke in pending
	const handleRevoke = useCallback((grant: PermissionGrantDto & { pending?: string }) => {
		const node = getGrantNode(grant)

		setPendingChanges((prev) => {
			const next = new Map(prev)
			if (grant.pending === 'add' || grant.pending === 'remove') {
				// Cancel pending add
				next.delete(node)
			} else {
				// Mark for removal
				next.set(node, { type: 'revoke', node })
			}
			return next
		})
	}, [])

	// Bulk operations
	const handleBulkAllow = useCallback(() => {
		const nodes = displayGrants.filter((g) => selectedIds.has(g.id)).map(getGrantNode)
		setPendingChanges((prev) => {
			const next = new Map(prev)
			for (const node of nodes) {
				applyPendingGrantSelection(next, node, 'allow', existingByNode.get(node))
			}
			return next
		})
		setSelectedIds(new Set())
	}, [displayGrants, existingByNode, selectedIds])

	const handleBulkDeny = useCallback(() => {
		const nodes = displayGrants.filter((g) => selectedIds.has(g.id)).map(getGrantNode)
		setPendingChanges((prev) => {
			const next = new Map(prev)
			for (const node of nodes) {
				applyPendingGrantSelection(next, node, 'deny', existingByNode.get(node))
			}
			return next
		})
		setSelectedIds(new Set())
	}, [displayGrants, existingByNode, selectedIds])

	const handleBulkRevoke = useCallback(() => {
		const toRevoke = displayGrants.filter((g) => selectedIds.has(g.id))
		setPendingChanges((prev) => {
			const next = new Map(prev)
			for (const g of toRevoke) {
				const node = getGrantNode(g)
				if (g.pending === 'add') {
					next.delete(node)
				} else {
					next.set(node, { type: 'revoke', node })
				}
			}
			return next
		})
		setSelectedIds(new Set())
	}, [displayGrants, selectedIds])

	// Commit all pending changes
	const handleCommit = useCallback(async () => {
		const toGrant: Array<{ node: string; effect: PermissionEffect }> = []
		const toRevoke: string[] = []

		for (const [node, change] of pendingChanges) {
			if (change.type === 'grant' || change.type === 'toggle') {
				toGrant.push({ node, effect: change.effect! })
			} else if (change.type === 'revoke') {
				toRevoke.push(node)
			}
		}

		// Execute changes
		if (toRevoke.length) await grants.revokeMany(toRevoke)
		for (const { node, effect: eff } of toGrant) {
			await grants.grantMany([node], eff)
		}

		setPendingChanges(new Map())
	}, [grants, pendingChanges])

	// Discard all pending
	const handleDiscard = useCallback(() => {
		setPendingChanges(new Map())
	}, [])

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

				{/* Pending Changes Bar */}
				{hasPendingChanges && (
					<Paper withBorder radius="md" p="xs" style={{ borderColor: 'var(--mantine-color-orange-5)', background: 'var(--mantine-color-orange-light)' }}>
						<Group justify="space-between" align="center">
							<Group gap="xs">
								<Badge variant="filled" color="orange">
									{pendingChanges.size} pending changes
								</Badge>
								<Text size="xs" c="dimmed">
									Changes will not be saved until you commit
								</Text>
							</Group>
							<Group gap="xs">
								<Button size="xs" variant="light" color="gray" onClick={handleDiscard}>
									Discard
								</Button>
								<Button size="xs" variant="filled" color="teal" onClick={handleCommit}>
									Commit Changes
								</Button>
							</Group>
						</Group>
					</Paper>
				)}

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
					<Checkbox
						size="xs"
						label="Pending only"
						checked={showPendingOnly}
						onChange={(e) => setShowPendingOnly(e.currentTarget.checked)}
					/>
					<Text size="xs" c="dimmed">
						{visibleGrants.length}/{displayGrants.length} grants
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
					<GrantsTableWithPending
						grants={visibleGrants}
						selectedIds={selectedIds}
						onSelectChange={setSelectedIds}
						onToggleEffect={handleToggleEffect}
						onRevoke={handleRevoke}
					/>
				</ScrollArea>
			</Stack>
		</Panel>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Grants Table with Pending Indicators
// ─────────────────────────────────────────────────────────────────────────────

type GrantWithPending = PermissionGrantDto & { pending?: 'add' | 'remove' | 'modify'; node?: string }

type GrantsTableWithPendingProps = {
	grants: GrantWithPending[]
	selectedIds: Set<number>
	onSelectChange: (ids: Set<number>) => void
	onToggleEffect: (grant: GrantWithPending) => void
	onRevoke: (grant: GrantWithPending) => void
	disabled?: boolean
}

function GrantsTableWithPending({
	grants,
	selectedIds,
	onSelectChange,
	onToggleEffect,
	onRevoke,
	disabled,
}: GrantsTableWithPendingProps) {
	const allSelected = grants.length > 0 && grants.every((g) => selectedIds.has(g.id))
	const someSelected = grants.some((g) => selectedIds.has(g.id))

	const toggleAll = useCallback(() => {
		if (allSelected) {
			onSelectChange(new Set())
		} else {
			onSelectChange(new Set(grants.map((g) => g.id)))
		}
	}, [allSelected, grants, onSelectChange])

	const toggleOne = useCallback(
		(id: number) => {
			const next = new Set(selectedIds)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			onSelectChange(next)
		},
		[selectedIds, onSelectChange],
	)

	if (!grants.length) {
		return (
			<Text size="sm" c="dimmed" ta="center" py="lg">
				No grants yet.
			</Text>
		)
	}

	const getPendingStyle = (pending?: 'add' | 'remove' | 'modify') => {
		if (pending === 'add') return { borderLeft: '3px solid var(--mantine-color-teal-5)', background: 'var(--mantine-color-teal-light)' }
		if (pending === 'remove') return { borderLeft: '3px solid var(--mantine-color-red-5)', background: 'var(--mantine-color-red-light)', opacity: 0.7, textDecoration: 'line-through' }
		if (pending === 'modify') return { borderLeft: '3px solid var(--mantine-color-yellow-5)', background: 'var(--mantine-color-yellow-light)' }
		return {}
	}

	return (
		<Table striped highlightOnHover withTableBorder verticalSpacing="xs" horizontalSpacing="xs">
			<Table.Thead>
				<Table.Tr>
					<Table.Th w={40}>
						<Checkbox
							checked={allSelected}
							indeterminate={someSelected && !allSelected}
							onChange={toggleAll}
							disabled={disabled}
						/>
					</Table.Th>
					<Table.Th>Node</Table.Th>
					<Table.Th w={60}>Effect</Table.Th>
					<Table.Th w={70}>Status</Table.Th>
					<Table.Th w={50} />
				</Table.Tr>
			</Table.Thead>
			<Table.Tbody>
				{grants.map((grant) => (
					<Table.Tr key={grant.id} style={getPendingStyle(grant.pending)}>
						<Table.Td>
							<Checkbox
								checked={selectedIds.has(grant.id)}
								onChange={() => toggleOne(grant.id)}
								disabled={disabled}
							/>
						</Table.Td>
						<Table.Td>
							<Text size="sm" ff="monospace">
								{getGrantNode(grant)}
							</Text>
						</Table.Td>
						<Table.Td>
							<Tooltip label={`Click to ${grant.effect === 'allow' ? 'deny' : 'allow'}`}>
								<ActionIcon
									variant="light"
									size="sm"
									color={grant.effect === 'allow' ? 'teal' : 'red'}
									onClick={() => onToggleEffect(grant)}
									disabled={disabled || grant.pending === 'remove'}
								>
									{grant.effect === 'allow' ? <IconCheck size={14} /> : <IconX size={14} />}
								</ActionIcon>
							</Tooltip>
						</Table.Td>
						<Table.Td>
							{grant.pending === 'add' && <Badge size="xs" color="teal">New</Badge>}
							{grant.pending === 'modify' && <Badge size="xs" color="yellow">Modified</Badge>}
							{grant.pending === 'remove' && <Badge size="xs" color="red">Remove</Badge>}
							{!grant.pending && <Badge size="xs" variant="light" color="gray">Saved</Badge>}
						</Table.Td>
						<Table.Td>
							<Tooltip label={grant.pending === 'remove' ? 'Undo remove' : 'Revoke'}>
								<ActionIcon
									variant="subtle"
									color={grant.pending === 'remove' ? 'blue' : 'red'}
									size="sm"
									onClick={() => onRevoke(grant)}
									disabled={disabled}
								>
									<IconTrash size={14} />
								</ActionIcon>
							</Tooltip>
						</Table.Td>
					</Table.Tr>
				))}
			</Table.Tbody>
		</Table>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// User Queue Panel - 多用户选择队列
// ─────────────────────────────────────────────────────────────────────────────

type UserQueuePanelProps = {
	userSearch: ReturnType<typeof useUserSearch>
	selectedUsers: UserSearchResult[]
	onSelectedUsersChange: (users: UserSearchResult[]) => void
	activeUser: UserSearchResult | null
	onActiveUserChange: (user: UserSearchResult | null) => void
}

function UserQueuePanel({
	userSearch,
	selectedUsers,
	onSelectedUsersChange,
	activeUser,
	onActiveUserChange,
}: UserQueuePanelProps) {
	const [input, setInput] = useState('')

	const handleSearch = useCallback(() => {
		const trimmed = input.trim()
		if (!trimmed) return
		const parsed = Number(trimmed)
		if (Number.isFinite(parsed)) {
			userSearch.getById(parsed).then((user) => {
				if (user && !selectedUsers.some((u) => u.id === user.id)) {
					onSelectedUsersChange([...selectedUsers, user])
				}
			})
		} else {
			void userSearch.search(trimmed)
		}
	}, [input, userSearch, selectedUsers, onSelectedUsersChange])

	const handleAddToQueue = useCallback(
		(user: UserSearchResult) => {
			if (!selectedUsers.some((u) => u.id === user.id)) {
				onSelectedUsersChange([...selectedUsers, user])
			}
			userSearch.clear()
			setInput('')
		},
		[selectedUsers, onSelectedUsersChange, userSearch],
	)

	const handleRemoveFromQueue = useCallback(
		(userId: number) => {
			onSelectedUsersChange(selectedUsers.filter((u) => u.id !== userId))
			if (activeUser?.id === userId) {
				onActiveUserChange(null)
			}
		},
		[selectedUsers, onSelectedUsersChange, activeUser, onActiveUserChange],
	)

	const handleSelectActive = useCallback(
		(user: UserSearchResult) => {
			onActiveUserChange(user)
		},
		[onActiveUserChange],
	)

	return (
		<Panel title="User selection" icon={<IconUsers size={16} />}>
			<Stack gap="sm">
				{/* Search Input */}
				<Group gap="xs">
					<TextInput
						placeholder="User ID or display name"
						size="xs"
						style={{ flex: 1 }}
						value={input}
						onChange={(e) => setInput(e.currentTarget.value)}
						onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
						leftSection={<IconSearch size={14} />}
					/>
					<Button size="xs" variant="light" onClick={handleSearch} loading={userSearch.loading}>
						Search
					</Button>
				</Group>

				{/* Search Results */}
				{userSearch.results.length > 0 && (
					<Paper withBorder p="xs" radius="md">
						<Text fw={600} size="xs" mb="xs">
							Search results ({userSearch.results.length})
						</Text>
						<ScrollArea style={{ maxHeight: 140 }} type="auto" offsetScrollbars>
							<Stack gap={4}>
								{userSearch.results.map((user) => {
									const alreadyAdded = selectedUsers.some((u) => u.id === user.id)
									return (
										<Paper
											key={user.id}
											withBorder
											p="xs"
											radius="sm"
											style={{
												cursor: alreadyAdded ? 'default' : 'pointer',
												opacity: alreadyAdded ? 0.5 : 1,
											}}
											onClick={() => !alreadyAdded && handleAddToQueue(user)}
										>
											<Group justify="space-between" align="center" wrap="nowrap">
												<Group gap="xs" wrap="nowrap">
													<Avatar size="xs" radius="xl" color="blue">
														{(user.displayName?.[0] ?? '#').toUpperCase()}
													</Avatar>
													<Text size="xs" fw={500} lineClamp={1}>
														{user.displayName || <Text span c="dimmed">No name</Text>}
													</Text>
													<Badge size="xs" variant="light" color="gray">
														#{user.id}
													</Badge>
												</Group>
												{alreadyAdded ? (
													<Badge size="xs" color="gray">Added</Badge>
												) : (
													<ActionIcon size="xs" variant="light" color="teal">
														<IconPlus size={12} />
													</ActionIcon>
												)}
											</Group>
										</Paper>
									)
								})}
							</Stack>
						</ScrollArea>
					</Paper>
				)}

				{/* Selected Users Queue */}
				<Text fw={600} size="sm">
					Selected users ({selectedUsers.length})
				</Text>
				{selectedUsers.length === 0 ? (
					<Text size="xs" c="dimmed" ta="center" py="sm">
						Search and add users to edit their permissions in batch
					</Text>
				) : (
					<ScrollArea style={{ flex: 1, minHeight: 0, maxHeight: 300 }} type="auto" offsetScrollbars>
						<Stack gap={4}>
							{selectedUsers.map((user) => (
								<Paper
									key={user.id}
									withBorder
									p="xs"
									radius="sm"
									style={{
										cursor: 'pointer',
										borderColor: activeUser?.id === user.id ? 'var(--mantine-color-blue-5)' : undefined,
										background: activeUser?.id === user.id ? 'var(--mantine-color-blue-light)' : undefined,
									}}
									onClick={() => handleSelectActive(user)}
								>
									<Group justify="space-between" align="center" wrap="nowrap">
										<Group gap="xs" wrap="nowrap">
											<Avatar size="sm" radius="xl" color="blue">
												{(user.displayName?.[0] ?? '#').toUpperCase()}
											</Avatar>
											<Stack gap={0}>
												<Text size="sm" fw={500} lineClamp={1}>
													{user.displayName || <Text span c="dimmed">No name</Text>}
												</Text>
												<Group gap={4}>
													<Badge size="xs" variant="light" color="gray">
														#{user.id}
													</Badge>
													{user.identities.slice(0, 1).map((i) => (
														<Badge key={`${i.platform}:${i.platformUserId}`} size="xs" variant="outline" color="gray">
															{i.platform}
														</Badge>
													))}
												</Group>
											</Stack>
										</Group>
										<ActionIcon
											size="sm"
											variant="subtle"
											color="red"
											onClick={(e) => {
												e.stopPropagation()
												handleRemoveFromQueue(user.id)
											}}
										>
											<IconX size={14} />
										</ActionIcon>
									</Group>
								</Paper>
							))}
						</Stack>
					</ScrollArea>
				)}
			</Stack>
		</Panel>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// User Roles & Grants Panel - 用户权限编辑 (批次模式)
// ─────────────────────────────────────────────────────────────────────────────

type UserPermsPanelProps = {
	user: UserSearchResult | null
	selectedUsers: UserSearchResult[]
	roles: ReturnType<typeof useRoles>
	catalog: ReturnType<typeof usePermissionCatalog>
	userPerms: ReturnType<typeof useUserPermissions>
}

function UserPermsPanel({ user, selectedUsers, roles, catalog, userPerms }: UserPermsPanelProps) {
	const [selectedNodes, setSelectedNodes] = useState<string[]>([])
	const [effect, setEffect] = useState<PermissionEffect>('allow')
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
	const [search, setSearch] = useState('')
	const [showPendingOnly, setShowPendingOnly] = useState(false)

	// Batch pending changes
	const [pendingGrants, setPendingGrants] = useState<Map<string, PendingChange>>(new Map())
	const [pendingRoles, setPendingRoles] = useState<Map<string, PendingRoleChange>>(new Map())

	// Reset when user changes
	useEffect(() => {
		setSelectedIds(new Set())
		setSearch('')
		setPendingGrants(new Map())
		setPendingRoles(new Map())
		setShowPendingOnly(false)
	}, [user?.id])

	// Merge grants with pending
	const displayGrants = useMemo(() => {
		const result: Array<PermissionGrantDto & { pending?: 'add' | 'remove' | 'modify'; node?: string }> = []
		const seen = new Set<string>()

		for (const g of userPerms.grants) {
			const node = getGrantNode(g)
			seen.add(node)
			const pending = pendingGrants.get(node)
			if (pending?.type === 'revoke') {
				result.push({ ...g, node, pending: 'remove' })
			} else if (pending?.type === 'toggle') {
				result.push({ ...g, node, effect: pending.effect!, pending: 'modify' })
			} else {
				result.push({ ...g, node })
			}
		}

		for (const [node, change] of pendingGrants) {
			if (change.type === 'grant' && !seen.has(node)) {
				result.push({
					id: -Date.now() - Math.random(),
					kind: node.endsWith('.*') ? 'star' : 'exact',
					node,
					effect: change.effect!,
					updatedAt: new Date().toISOString(),
					pending: 'add',
				})
			}
		}

		return result
	}, [userPerms.grants, pendingGrants])

	const visibleGrants = useMemo(() => {
		const q = search.trim().toLowerCase()
		const base = q ? displayGrants.filter((g) => getGrantNode(g).toLowerCase().includes(q)) : displayGrants
		const filtered = showPendingOnly ? base.filter((g) => g.pending) : base
		const pendingRank = (pending?: 'add' | 'remove' | 'modify') => {
			if (pending === 'add') return 0
			if (pending === 'modify') return 1
			if (pending === 'remove') return 2
			return 3
		}
		return [...filtered].sort((a, b) => {
			const rankDelta = pendingRank(a.pending) - pendingRank(b.pending)
			if (rankDelta !== 0) return rankDelta
			return getGrantNode(a).localeCompare(getGrantNode(b))
		})
	}, [displayGrants, search, showPendingOnly])

	// Role assignments with pending
	const roleAssignments = useMemo(() => {
		return roles.roles.map((role) => {
			const assigned = userPerms.roleIds.includes(role.roleId)
			const pendingKey = `${user?.id ?? 0}:${role.roleId}`
			const pending = pendingRoles.get(pendingKey)
			let displayAssigned = assigned
			let pendingStatus: 'add' | 'remove' | undefined

			if (pending) {
				if (pending.action === 'assign') {
					displayAssigned = true
					pendingStatus = 'add'
				} else {
					displayAssigned = false
					pendingStatus = 'remove'
				}
			}

			return { role, assigned, displayAssigned, pendingStatus }
		})
	}, [roles.roles, userPerms.roleIds, pendingRoles, user?.id])

	const hasPendingChanges = pendingGrants.size > 0 || pendingRoles.size > 0
	const existingByNode = useMemo(() => {
		const map = new Map<string, PermissionGrantDto>()
		for (const grant of userPerms.grants) {
			map.set(getGrantNode(grant), grant)
		}
		return map
	}, [userPerms.grants])

	// Grant handlers
	const handleAdd = useCallback(() => {
		if (!selectedNodes.length) return
		setPendingGrants((prev) => {
			const next = new Map(prev)
			for (const node of selectedNodes) {
				applyPendingGrantSelection(next, node, effect, existingByNode.get(node))
			}
			return next
		})
		setSelectedNodes([])
	}, [effect, existingByNode, selectedNodes])

	const handleToggleEffect = useCallback((grant: GrantWithPending) => {
		const node = getGrantNode(grant)
		const newEffect = grant.effect === 'allow' ? 'deny' : 'allow'

		setPendingGrants((prev) => {
			const next = new Map(prev)
			const existing = prev.get(node)

			if (grant.pending === 'add') {
				next.set(node, { type: 'grant', node, effect: newEffect })
			} else if (existing?.type === 'toggle') {
				if (existing.originalEffect === newEffect) {
					next.delete(node)
				} else {
					next.set(node, { ...existing, effect: newEffect })
				}
			} else {
				next.set(node, { type: 'toggle', node, effect: newEffect, originalEffect: grant.effect })
			}
			return next
		})
	}, [])

	const handleRevoke = useCallback((grant: GrantWithPending) => {
		const node = getGrantNode(grant)
		setPendingGrants((prev) => {
			const next = new Map(prev)
			if (grant.pending === 'add' || grant.pending === 'remove') {
				next.delete(node)
			} else {
				next.set(node, { type: 'revoke', node })
			}
			return next
		})
	}, [])

	// Role toggle handler
	const handleToggleRole = useCallback((roleId: number, currentlyAssigned: boolean) => {
		if (!user) return
		const key = `${user.id}:${roleId}`

		setPendingRoles((prev) => {
			const next = new Map(prev)
			const existing = prev.get(key)

			if (existing) {
				// Toggle back = cancel pending
				next.delete(key)
			} else {
				// New pending change
				next.set(key, {
					userId: user.id,
					roleId,
					action: currentlyAssigned ? 'unassign' : 'assign',
				})
			}
			return next
		})
	}, [user])

	// Bulk operations
	const handleBulkAllow = useCallback(() => {
		const nodes = displayGrants.filter((g) => selectedIds.has(g.id)).map(getGrantNode)
		setPendingGrants((prev) => {
			const next = new Map(prev)
			for (const node of nodes) {
				applyPendingGrantSelection(next, node, 'allow', existingByNode.get(node))
			}
			return next
		})
		setSelectedIds(new Set())
	}, [displayGrants, existingByNode, selectedIds])

	const handleBulkDeny = useCallback(() => {
		const nodes = displayGrants.filter((g) => selectedIds.has(g.id)).map(getGrantNode)
		setPendingGrants((prev) => {
			const next = new Map(prev)
			for (const node of nodes) {
				applyPendingGrantSelection(next, node, 'deny', existingByNode.get(node))
			}
			return next
		})
		setSelectedIds(new Set())
	}, [displayGrants, existingByNode, selectedIds])

	const handleBulkRevoke = useCallback(() => {
		const toRevoke = displayGrants.filter((g) => selectedIds.has(g.id))
		setPendingGrants((prev) => {
			const next = new Map(prev)
			for (const g of toRevoke) {
				const node = getGrantNode(g)
				if (g.pending === 'add') {
					next.delete(node)
				} else {
					next.set(node, { type: 'revoke', node })
				}
			}
			return next
		})
		setSelectedIds(new Set())
	}, [displayGrants, selectedIds])

	// Commit changes
	const handleCommit = useCallback(async () => {
		// Grants
		const toGrant: Array<{ node: string; effect: PermissionEffect }> = []
		const toRevoke: string[] = []

		for (const [node, change] of pendingGrants) {
			if (change.type === 'grant' || change.type === 'toggle') {
				toGrant.push({ node, effect: change.effect! })
			} else if (change.type === 'revoke') {
				toRevoke.push(node)
			}
		}

		if (toRevoke.length) await userPerms.revokeMany(toRevoke)
		for (const { node, effect: eff } of toGrant) {
			await userPerms.grantMany([node], eff)
		}

		// Roles
		for (const change of pendingRoles.values()) {
			if (change.action === 'assign') {
				await userPerms.assignRole(change.roleId)
			} else {
				await userPerms.unassignRole(change.roleId)
			}
		}

		setPendingGrants(new Map())
		setPendingRoles(new Map())
	}, [userPerms, pendingGrants, pendingRoles])

	const handleDiscard = useCallback(() => {
		setPendingGrants(new Map())
		setPendingRoles(new Map())
	}, [])

	if (!user) {
		return (
			<Panel title="User permissions" icon={<IconKey size={16} />}>
				<Text size="sm" c="dimmed" ta="center" py="xl">
					{selectedUsers.length > 0
						? 'Click a user from the queue to edit permissions'
						: 'Search and add users to edit permissions'}
				</Text>
			</Panel>
		)
	}

	return (
		<Panel
			title="User permissions"
			icon={<IconKey size={16} />}
			badge={
				<Group gap="xs">
					<Avatar size="xs" radius="xl" color="blue">
						{(user.displayName?.[0] ?? '#').toUpperCase()}
					</Avatar>
					<Badge variant="light" color="gray">{user.displayName || `#${user.id}`}</Badge>
				</Group>
			}
		>
			<Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
				{/* Pending Changes Bar */}
				{hasPendingChanges && (
					<Paper withBorder radius="md" p="xs" style={{ borderColor: 'var(--mantine-color-orange-5)', background: 'var(--mantine-color-orange-light)' }}>
						<Group justify="space-between" align="center">
							<Group gap="xs">
								<Badge variant="filled" color="orange">
									{pendingGrants.size + pendingRoles.size} pending
								</Badge>
								<Text size="xs" c="dimmed">
									Commit to save changes
								</Text>
							</Group>
							<Group gap="xs">
								<Button size="xs" variant="light" color="gray" onClick={handleDiscard}>
									Discard
								</Button>
								<Button size="xs" variant="filled" color="teal" onClick={handleCommit}>
									Commit
								</Button>
							</Group>
						</Group>
					</Paper>
				)}

				{/* Role Assignments */}
				<Paper withBorder p="xs" radius="md">
					<Text fw={600} size="sm" mb="xs">
						Role assignments
					</Text>
					<ScrollArea style={{ maxHeight: 120 }} type="auto" offsetScrollbars>
						<Group gap="xs">
							{roleAssignments.map(({ role, assigned, displayAssigned, pendingStatus }) => (
								<Badge
									key={role.roleId}
									variant={displayAssigned ? 'filled' : 'outline'}
									color={pendingStatus === 'add' ? 'teal' : pendingStatus === 'remove' ? 'red' : displayAssigned ? 'blue' : 'gray'}
									style={{ cursor: 'pointer' }}
									onClick={() => handleToggleRole(role.roleId, assigned)}
									rightSection={
										pendingStatus && (
											<Text size="xs" span>
												{pendingStatus === 'add' ? '+' : '−'}
											</Text>
										)
									}
								>
									{role.name || `#${role.roleId}`}
								</Badge>
							))}
						</Group>
					</ScrollArea>
				</Paper>

				{/* Permission Picker */}
				<PermissionPicker
					nodes={catalog.nodes}
					infoByNode={catalog.infoByNode}
					value={selectedNodes}
					onChange={setSelectedNodes}
					effect={effect}
					onEffectChange={setEffect}
					onAdd={handleAdd}
				/>

				{/* Search + Stats */}
				<Group gap="sm" align="center">
					<TextInput
						placeholder="Search grants..."
						size="xs"
						leftSection={<IconSearch size={14} />}
						value={search}
						onChange={(e) => setSearch(e.currentTarget.value)}
						style={{ flex: 1, maxWidth: 240 }}
					/>
					<Checkbox
						size="xs"
						label="Pending only"
						checked={showPendingOnly}
						onChange={(e) => setShowPendingOnly(e.currentTarget.checked)}
					/>
					<Text size="xs" c="dimmed">
						{visibleGrants.length}/{displayGrants.length} grants
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
					<GrantsTableWithPending
						grants={visibleGrants}
						selectedIds={selectedIds}
						onSelectChange={setSelectedIds}
						onToggleEffect={handleToggleEffect}
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
	const [selectedUsers, setSelectedUsers] = useState<UserSearchResult[]>([])
	const [activeUser, setActiveUser] = useState<UserSearchResult | null>(null)

	const roleGrants = useRoleGrants(selectedRoleId)
	const userPerms = useUserPermissions(activeUser?.id ?? null)

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
		if (activeUser) await userPerms.refresh()
	}, [activeUser, catalog, roleGrants, roles, selectedRoleId, userPerms])

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
							gridTemplateColumns: 'minmax(0, 280px) minmax(0, 1fr)',
							gap: 16,
							height: '100%',
							minHeight: 0,
						}}
					>
						<UserQueuePanel
							userSearch={userSearch}
							selectedUsers={selectedUsers}
							onSelectedUsersChange={setSelectedUsers}
							activeUser={activeUser}
							onActiveUserChange={setActiveUser}
						/>
						<UserPermsPanel
							user={activeUser}
							selectedUsers={selectedUsers}
							roles={roles}
							catalog={catalog}
							userPerms={userPerms}
						/>
					</Box>
				</Tabs.Panel>
			</Tabs>
		</Box>
	)
}
