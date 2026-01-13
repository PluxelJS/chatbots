import {
	ActionIcon,
	Avatar,
	Badge,
	Box,
	Button,
	Checkbox,
	Collapse,
	Code,
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
	ThemeIcon,
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

import type { PermissionEffect, PermissionGrantDto, UnifiedUserDto } from '../../api'
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
	useBulkUserRoleAssignments,
	useUserPermissionExplain,
	useUserPermissions,
	useUserSearch,
} from './hooks'
import { useChatUiColorScheme } from '../../shared/styles/chatui'

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

const parseGrantNodeForUi = (value: string) => {
	const s = value.trim()
	const dot = s.indexOf('.')
	if (dot <= 0) return null
	const nsKey = s.slice(0, dot).trim()
	const localRaw = s.slice(dot + 1).trim()
	if (!nsKey || !localRaw) return null
	if (localRaw === '*') return { nsKey, kind: 'star' as const, local: '' }
	if (localRaw.endsWith('.*')) {
		const prefix = localRaw.slice(0, -2)
		if (!prefix) return null
		return { nsKey, kind: 'star' as const, local: prefix }
	}
	return { nsKey, kind: 'exact' as const, local: localRaw }
}

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
	const [roleSearch, setRoleSearch] = useState('')

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

	const visibleRoles = useMemo(() => {
		const q = roleSearch.trim().toLowerCase()
		if (!q) return roles.roles
		return roles.roles.filter((role) => {
			if (String(role.roleId).includes(q)) return true
			if (String(role.rank).includes(q)) return true
			if (role.parentRoleId !== null && String(role.parentRoleId).includes(q)) return true
			if ((role.name ?? '').toLowerCase().includes(q)) return true
			return false
		})
	}, [roleSearch, roles.roles])

	return (
		<Panel hideHeader>
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
							<NumberInput
								label="Rank"
								size="xs"
								value={newRank}
								onChange={(v) => setNewRank(typeof v === 'number' ? v : '')}
								min={0}
							/>
							<Button size="xs" variant="light" color="teal" onClick={handleCreate} leftSection={<IconPlus size={14} />}>
								Create
							</Button>
						</Stack>
					</Paper>
				</Collapse>
			</Box>

			<Group gap="xs" align="center" mb="xs">
				<TextInput
					placeholder="Filter roles…"
					size="xs"
					leftSection={<IconSearch size={14} />}
					value={roleSearch}
					onChange={(e) => setRoleSearch(e.currentTarget.value)}
					style={{ flex: 1 }}
				/>
				<Text size="xs" c="dimmed">
					{visibleRoles.length}/{roles.roles.length}
				</Text>
			</Group>

			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<Stack gap={6}>
					{visibleRoles.map((role) => {
						const selected = role.roleId === selectedRoleId
						const roleLabel = role.name?.trim() ? role.name.trim() : `#${role.roleId}`
						return (
							<Paper
								key={role.roleId}
								withBorder
								p="xs"
								radius="md"
								role="button"
								tabIndex={0}
								onClick={() => onSelectRole(role.roleId)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault()
										onSelectRole(role.roleId)
									}
								}}
								aria-label={`Role ${roleLabel}`}
								style={{
									cursor: 'pointer',
									backgroundColor: selected ? 'var(--mantine-color-teal-light)' : undefined,
									borderLeft: selected ? '3px solid var(--mantine-color-teal-6)' : '3px solid transparent',
								}}
							>
								<Group justify="space-between" align="center" wrap="nowrap">
									<Stack gap={0} style={{ minWidth: 0 }}>
										<Text size="sm" fw={600} lineClamp={1}>
											{roleLabel}
										</Text>
										{role.name?.trim() && (
											<Text size="xs" c="dimmed" lineClamp={1}>
												#{role.roleId}
											</Text>
										)}
									</Stack>
									<Group gap="xs" wrap="nowrap">
										{role.parentRoleId !== null && (
											<Badge size="xs" variant="light" color="gray">
												p#{role.parentRoleId}
											</Badge>
										)}
										<Badge size="xs" variant="light" color="gray">
											r{role.rank}
										</Badge>
									</Group>
								</Group>
							</Paper>
						)
					})}
				</Stack>
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
	const isDefaultRole = role ? (role.name ?? '').trim().toUpperCase() === 'DEFAULT' : false
	const [tab, setTab] = useState<'grants' | 'settings'>('grants')
	const [filtersOpened, filtersCtl] = useDisclosure(false)

	const [selectedNodes, setSelectedNodes] = useState<string[]>([])
	const [effect, setEffect] = useState<PermissionEffect>('allow')
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
	const [name, setName] = useState('')
	const [parentId, setParentId] = useState<string | null>(null)
	const [rank, setRank] = useState<number | ''>(0)
	const [search, setSearch] = useState('')
	const [showPendingOnly, setShowPendingOnly] = useState(false)
	const [filterNsKey, setFilterNsKey] = useState<string | null>(null)
	const [filterKind, setFilterKind] = useState<'all' | 'exact' | 'star'>('all')
	const [filterEffect, setFilterEffect] = useState<'all' | PermissionEffect>('all')

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
		setFilterNsKey(null)
		setFilterKind('all')
		setFilterEffect('all')
		filtersCtl.close()
		setSelectedNodes([])
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
				const parsed = parseGrantNodeForUi(node) ?? { nsKey: '', kind: node.endsWith('.*') ? ('star' as const) : ('exact' as const), local: '' }
				result.push({
					id: -Date.now() - Math.random(), // Temp ID
					subjectType: 'role',
					subjectId: roleId ?? 0,
					nsKey: parsed.nsKey,
					kind: parsed.kind,
					local: parsed.local,
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
		let base = q ? displayGrants.filter((g) => getGrantNode(g).toLowerCase().includes(q)) : displayGrants
		if (filterNsKey) base = base.filter((g) => g.nsKey === filterNsKey)
		if (filterKind !== 'all') base = base.filter((g) => g.kind === filterKind)
		if (filterEffect !== 'all') base = base.filter((g) => g.effect === filterEffect)
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
	}, [displayGrants, filterEffect, filterKind, filterNsKey, search, showPendingOnly])

	const nsKeyOptions = useMemo(() => {
		const keys = new Set<string>()
		for (const g of displayGrants) if (g.nsKey) keys.add(g.nsKey)
		return [...keys].sort().map((k) => ({ value: k, label: k }))
	}, [displayGrants])

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

	const handleSelectVisible = useCallback(() => {
		setSelectedIds(new Set(visibleGrants.map((g) => g.id)))
	}, [visibleGrants])

	const handleRevokeVisible = useCallback(() => {
		if (!visibleGrants.length) return
		if (!confirm(`Revoke all visible grants (${visibleGrants.length})?`)) return
		setPendingChanges((prev) => {
			const next = new Map(prev)
			for (const g of visibleGrants) {
				const node = getGrantNode(g)
				if (g.pending === 'add') {
					next.delete(node)
				} else if (g.pending === 'remove') {
					// already pending revoke
				} else {
					next.set(node, { type: 'revoke', node })
				}
			}
			return next
		})
		setSelectedIds(new Set())
	}, [visibleGrants])

	// Commit all pending changes
	const handleCommit = useCallback(async () => {
		try {
			const toGrantAllow: string[] = []
			const toGrantDeny: string[] = []
			const toRevoke: string[] = []

			for (const [node, change] of pendingChanges) {
				if (change.type === 'grant' || change.type === 'toggle') {
					if (change.effect === 'allow') toGrantAllow.push(node)
					else toGrantDeny.push(node)
				} else if (change.type === 'revoke') {
					toRevoke.push(node)
				}
			}

			if (toRevoke.length) await grants.revokeMany(toRevoke)
			if (toGrantAllow.length) await grants.grantMany(toGrantAllow, 'allow')
			if (toGrantDeny.length) await grants.grantMany(toGrantDeny, 'deny')

			setPendingChanges(new Map())
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err))
		}
	}, [grants, pendingChanges])

	// Discard all pending
	const handleDiscard = useCallback(() => {
		setPendingChanges(new Map())
	}, [])

	const handleSave = useCallback(async () => {
		if (!role) return
		try {
			await roles.updateRole(role.roleId, {
				name: name.trim() || null,
				parentRoleId: parentId ? Number(parentId) : null,
				rank: typeof rank === 'number' ? rank : role.rank,
			})
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err))
		}
	}, [name, parentId, rank, role, roles])

	const isRoleDirty = useMemo(() => {
		if (!role) return false
		const normalizeName = (value: string | null | undefined) => {
			const trimmed = typeof value === 'string' ? value.trim() : ''
			return trimmed ? trimmed : null
		}
		const nextName = normalizeName(name)
		const nextParent = parentId ? Number(parentId) : null
		const nextRank = typeof rank === 'number' ? rank : role.rank

		const curName = normalizeName(role.name)
		const curParent = role.parentRoleId ?? null
		const curRank = role.rank

		return nextName !== curName || nextParent !== curParent || nextRank !== curRank
	}, [name, parentId, rank, role])

	const handleDeleteRole = useCallback(async () => {
		if (!role) return
		if (isDefaultRole) {
			alert('DEFAULT role cannot be deleted.')
			return
		}
		const label = role.name?.trim() ? `"${role.name}"` : `#${role.roleId}`
		if (!confirm(`Delete role ${label}?\n\nThis will also remove:\n- all grants assigned to this role\n- all user assignments to this role\n\nChild roles will be re-parented.`)) return
		try {
			await roles.deleteRole(role.roleId)
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err))
		}
	}, [isDefaultRole, role, roles])

	if (!role) {
		return (
			<Panel hideHeader>
				<Text size="sm" c="dimmed" ta="center" py="xl">
					Select a role to manage grants.
				</Text>
			</Panel>
		)
	}

	return (
		<Panel hideHeader>
			<Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
				<Tabs value={tab} onChange={(v) => setTab((v as any) ?? 'grants')} keepMounted={false}>
					<Tabs.List>
						<Tabs.Tab value="grants" leftSection={<IconKey size={14} />}>
							Grants
						</Tabs.Tab>
						<Tabs.Tab value="settings" leftSection={<IconUsers size={14} />}>
							Settings
						</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel value="grants" pt="sm" style={{ flex: 1, minHeight: 0 }}>
						<Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
							<Paper withBorder p="xs" radius="md">
								<PermissionPicker
									nodes={catalog.nodes}
									infoByNode={catalog.infoByNode}
									value={selectedNodes}
									onChange={setSelectedNodes}
									effect={effect}
									onEffectChange={setEffect}
									onAdd={handleAdd}
								/>
							</Paper>

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
												Commit
											</Button>
										</Group>
									</Group>
								</Paper>
							)}

								{/* Search + Filters */}
								<Group gap="sm" align="center" wrap="wrap">
									<TextInput
										placeholder="Search grants..."
									size="xs"
									leftSection={<IconSearch size={14} />}
									value={search}
									onChange={(e) => setSearch(e.currentTarget.value)}
									style={{ flex: 1, maxWidth: 240 }}
								/>
									<Button size="xs" variant="subtle" color="gray" onClick={filtersCtl.toggle}>
										{filtersOpened ? 'Hide filters' : 'Filters'}
									</Button>
									<Text size="xs" c="dimmed" style={{ marginLeft: 'auto' }}>
										{visibleGrants.length}/{displayGrants.length}
									</Text>
								</Group>

							<Collapse in={filtersOpened}>
								<Stack gap="xs">
									<Group gap="sm" align="center" wrap="wrap">
										<Select
											size="xs"
											placeholder="Namespace"
											data={nsKeyOptions}
											value={filterNsKey}
											onChange={setFilterNsKey}
											clearable
											style={{ width: 200 }}
										/>
										<Select
											size="xs"
											placeholder="Kind"
											data={[
												{ value: 'all', label: 'All kinds' },
												{ value: 'exact', label: 'Exact' },
												{ value: 'star', label: 'Star' },
											]}
											value={filterKind}
											onChange={(v) => setFilterKind((v as any) ?? 'all')}
											style={{ width: 160 }}
										/>
										<Select
											size="xs"
											placeholder="Effect"
											data={[
												{ value: 'all', label: 'All effects' },
												{ value: 'allow', label: 'Allow' },
												{ value: 'deny', label: 'Deny' },
											]}
											value={filterEffect}
											onChange={(v) => setFilterEffect(((v as any) ?? 'all') as any)}
											style={{ width: 160 }}
										/>
										<Checkbox
											size="xs"
											label="Pending only"
											checked={showPendingOnly}
											onChange={(e) => setShowPendingOnly(e.currentTarget.checked)}
										/>
									</Group>

									<Group gap="xs">
										<Button size="xs" variant="light" color="gray" onClick={handleSelectVisible} disabled={!visibleGrants.length}>
											Select visible
										</Button>
										<Button size="xs" variant="subtle" color="gray" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>
											Clear selection
										</Button>
										<Button size="xs" variant="light" color="red" onClick={handleRevokeVisible} disabled={!visibleGrants.length}>
											Revoke visible
										</Button>
									</Group>
								</Stack>
							</Collapse>

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
					</Tabs.Panel>

					<Tabs.Panel value="settings" pt="sm">
						<Stack gap="sm">
							<Group align="flex-end" gap="sm" wrap="wrap">
								<TextInput
									label="Name"
									size="xs"
									style={{ width: 180 }}
									placeholder="Role name"
									value={name}
									onChange={(e) => setName(e.currentTarget.value)}
									onKeyDown={(e) => e.key === 'Enter' && handleSave()}
								/>
								<Select
									label="Parent"
									size="xs"
									style={{ width: 220 }}
									value={parentId ?? ''}
									data={[
										{ value: '', label: 'None' },
										...roles.options.filter((opt) => opt.value !== String(role.roleId)),
									]}
									onChange={(v) => setParentId(v || null)}
								/>
								<NumberInput
									label="Rank"
									size="xs"
									style={{ width: 120 }}
									value={rank}
									onChange={(v) => setRank(typeof v === 'number' ? v : '')}
									min={0}
								/>
								<Button size="xs" variant="light" onClick={handleSave} disabled={!isRoleDirty}>
									Save
								</Button>
								<Tooltip label={isDefaultRole ? 'DEFAULT role cannot be deleted' : 'Delete role'} disabled={!isDefaultRole}>
									<span>
										<Button
											size="xs"
											variant="light"
											color="red"
											onClick={handleDeleteRole}
											leftSection={<IconTrash size={14} />}
											disabled={isDefaultRole}
										>
											Delete
										</Button>
									</span>
								</Tooltip>
							</Group>

							<Text size="xs" c="dimmed">
								Role settings are independent from grants. Grants can be edited in the “Grants” tab.
							</Text>
						</Stack>
					</Tabs.Panel>
				</Tabs>
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
							aria-label={allSelected ? 'Deselect all grants' : 'Select all grants'}
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
								aria-label={`Select grant ${getGrantNode(grant)}`}
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
									aria-label={grant.effect === 'allow' ? 'Set effect to deny' : 'Set effect to allow'}
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
									color={grant.pending === 'remove' ? 'gray' : 'red'}
									size="sm"
									onClick={() => onRevoke(grant)}
									disabled={disabled}
									aria-label={grant.pending === 'remove' ? `Undo revoke ${getGrantNode(grant)}` : `Revoke ${getGrantNode(grant)}`}
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
	selectedUsers: UnifiedUserDto[]
	onSelectedUsersChange: (users: UnifiedUserDto[]) => void
	activeUser: UnifiedUserDto | null
	onActiveUserChange: (user: UnifiedUserDto | null) => void
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
		(user: UnifiedUserDto) => {
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
		(user: UnifiedUserDto) => {
			onActiveUserChange(user)
		},
		[onActiveUserChange],
	)

	return (
		<Panel hideHeader>
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
											onKeyDown={(e) => {
												if (alreadyAdded) return
												if (e.key === 'Enter' || e.key === ' ') {
													e.preventDefault()
													handleAddToQueue(user)
												}
											}}
											tabIndex={alreadyAdded ? -1 : 0}
											role="button"
											aria-disabled={alreadyAdded}
											aria-label={`${user.displayName || `User #${user.id}`}, #${user.id}${alreadyAdded ? ', already added' : ', add to queue'}`}
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
													<Avatar size="xs" radius="xl" color="gray">
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
													<Badge size="xs" variant="light" color="gray">
														Added
													</Badge>
												) : (
													<ThemeIcon size="sm" variant="light" color="teal" aria-hidden>
														<IconPlus size={12} />
													</ThemeIcon>
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
									onClick={() => handleSelectActive(user)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault()
											handleSelectActive(user)
										}
									}}
									tabIndex={0}
									role="button"
									aria-label={`Select user ${user.displayName || `#${user.id}`} (#${user.id})`}
									withBorder
									p="xs"
									radius="sm"
									style={{
										cursor: 'pointer',
										borderColor: activeUser?.id === user.id ? 'var(--mantine-color-teal-6)' : undefined,
										background: activeUser?.id === user.id ? 'var(--mantine-color-teal-light)' : undefined,
									}}
								>
									<Group justify="space-between" align="center" wrap="nowrap">
										<Group gap="xs" wrap="nowrap">
											<Avatar size="sm" radius="xl" color="gray">
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
											aria-label={`Remove user #${user.id} from selection`}
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
	user: UnifiedUserDto | null
	selectedUsers: UnifiedUserDto[]
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
	const [filterNsKey, setFilterNsKey] = useState<string | null>(null)
	const [filterKind, setFilterKind] = useState<'all' | 'exact' | 'star'>('all')
	const [filterEffect, setFilterEffect] = useState<'all' | PermissionEffect>('all')
	const [roleSearch, setRoleSearch] = useState('')
	const [showAssignedOnly, setShowAssignedOnly] = useState(false)
	const [tab, setTab] = useState<'grants' | 'roles' | 'explain'>('grants')
	const [grantFiltersOpened, grantFiltersCtl] = useDisclosure(false)
	const explain = useUserPermissionExplain(user?.id ?? null)
	const [explainNode, setExplainNode] = useState<string | null>(null)
	const targetUserIds = useMemo(() => selectedUsers.map((u) => u.id).sort((a, b) => a - b), [selectedUsers])
	const bulkRoles = useBulkUserRoleAssignments(targetUserIds)
	const [bulkRoleId, setBulkRoleId] = useState<string | null>(null)

	const explainNodes = useMemo(() => {
		const out: Array<{ value: string; label: string }> = []
		for (const node of catalog.nodes) {
			const info = catalog.infoByNode.get(node)
			if (info?.kind !== 'exact') continue
			out.push({ value: node, label: node })
		}
		return out
	}, [catalog.infoByNode, catalog.nodes])

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
		setFilterNsKey(null)
		setFilterKind('all')
		setFilterEffect('all')
		setTab('grants')
		grantFiltersCtl.close()
		setBulkRoleId(null)
		setExplainNode(explainNodes[0]?.value ?? null)
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
				const parsed = parseGrantNodeForUi(node) ?? { nsKey: '', kind: node.endsWith('.*') ? ('star' as const) : ('exact' as const), local: '' }
				result.push({
					id: -Date.now() - Math.random(),
					subjectType: 'user',
					subjectId: user?.id ?? 0,
					nsKey: parsed.nsKey,
					kind: parsed.kind,
					local: parsed.local,
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
		let base = q ? displayGrants.filter((g) => getGrantNode(g).toLowerCase().includes(q)) : displayGrants
		if (filterNsKey) base = base.filter((g) => g.nsKey === filterNsKey)
		if (filterKind !== 'all') base = base.filter((g) => g.kind === filterKind)
		if (filterEffect !== 'all') base = base.filter((g) => g.effect === filterEffect)
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
	}, [displayGrants, filterEffect, filterKind, filterNsKey, search, showPendingOnly])

	const nsKeyOptions = useMemo(() => {
		const keys = new Set<string>()
		for (const g of displayGrants) if (g.nsKey) keys.add(g.nsKey)
		return [...keys].sort().map((k) => ({ value: k, label: k }))
	}, [displayGrants])

	// Role assignments with pending
	const rawRoleAssignments = useMemo(() => {
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

	const defaultRole = useMemo(
		() => roles.roles.find((r) => (r.name ?? '').trim().toUpperCase() === 'DEFAULT') ?? null,
		[roles.roles],
	)

	const assignedCount = useMemo(
		() => rawRoleAssignments.reduce((acc, r) => acc + (r.displayAssigned ? 1 : 0), 0),
		[rawRoleAssignments],
	)

	const roleAssignments = useMemo(() => {
		const q = roleSearch.trim().toLowerCase()
		const roleMatches = (role: (typeof rawRoleAssignments)[number]['role']) => {
			if (!q) return true
			const name = (role.name ?? '').toLowerCase()
			if (name.includes(q)) return true
			if (String(role.roleId).includes(q)) return true
			if (`r${role.rank}`.includes(q) || String(role.rank).includes(q)) return true
			return false
		}

		const filtered = rawRoleAssignments.filter((r) => roleMatches(r.role)).filter((r) => !showAssignedOnly || r.displayAssigned)

		return [...filtered].sort((a, b) => {
			const assignedDelta = Number(b.displayAssigned) - Number(a.displayAssigned)
			if (assignedDelta !== 0) return assignedDelta
			const rankDelta = b.role.rank - a.role.rank
			if (rankDelta !== 0) return rankDelta
			return a.role.roleId - b.role.roleId
		})
	}, [rawRoleAssignments, roleSearch, showAssignedOnly])

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

	const handleClearRoles = useCallback(() => {
		if (!user) return
		if (!confirm(`Clear all explicit roles for ${user.displayName || `#${user.id}`}?\n\nDEFAULT will still apply implicitly.`)) return
		setPendingRoles((prev) => {
			const next = new Map(prev)
			const prefix = `${user.id}:`
			for (const key of next.keys()) {
				if (key.startsWith(prefix)) next.delete(key)
			}
			for (const roleId of userPerms.roleIds) {
				next.set(`${user.id}:${roleId}`, { userId: user.id, roleId, action: 'unassign' })
			}
			return next
		})
	}, [user, userPerms.roleIds])

	const applyPendingRoleSelection = useCallback((next: Map<string, PendingRoleChange>, roleId: number, desiredAssigned: boolean, currentlyAssigned: boolean) => {
		if (!user) return
		const key = `${user.id}:${roleId}`
		if (desiredAssigned === currentlyAssigned) {
			next.delete(key)
			return
		}
		next.set(key, { userId: user.id, roleId, action: desiredAssigned ? 'assign' : 'unassign' })
	}, [user])

	const handleAssignFilteredRoles = useCallback(() => {
		if (!user) return
		setPendingRoles((prev) => {
			const next = new Map(prev)
			for (const { role, assigned } of roleAssignments) {
				applyPendingRoleSelection(next, role.roleId, true, assigned)
			}
			return next
		})
	}, [applyPendingRoleSelection, roleAssignments, user])

	const handleUnassignFilteredRoles = useCallback(() => {
		if (!user) return
		setPendingRoles((prev) => {
			const next = new Map(prev)
			for (const { role, assigned } of roleAssignments) {
				applyPendingRoleSelection(next, role.roleId, false, assigned)
			}
			return next
		})
	}, [applyPendingRoleSelection, roleAssignments, user])

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

	const handleSelectVisible = useCallback(() => {
		setSelectedIds(new Set(visibleGrants.map((g) => g.id)))
	}, [visibleGrants])

	const handleRevokeVisible = useCallback(() => {
		if (!visibleGrants.length) return
		if (!confirm(`Revoke all visible grants (${visibleGrants.length})?`)) return
		setPendingGrants((prev) => {
			const next = new Map(prev)
			for (const g of visibleGrants) {
				const node = getGrantNode(g)
				if (g.pending === 'add') {
					next.delete(node)
				} else if (g.pending === 'remove') {
					// already pending revoke
				} else {
					next.set(node, { type: 'revoke', node })
				}
			}
			return next
		})
		setSelectedIds(new Set())
	}, [visibleGrants])

	// Commit changes
	const handleCommit = useCallback(async () => {
		try {
			// Grants
			const toGrantAllow: string[] = []
			const toGrantDeny: string[] = []
			const toRevoke: string[] = []

			for (const [node, change] of pendingGrants) {
				if (change.type === 'grant' || change.type === 'toggle') {
					if (change.effect === 'allow') toGrantAllow.push(node)
					else toGrantDeny.push(node)
				} else if (change.type === 'revoke') {
					toRevoke.push(node)
				}
			}

			if (toRevoke.length) await userPerms.revokeMany(toRevoke)
			if (toGrantAllow.length) await userPerms.grantMany(toGrantAllow, 'allow')
			if (toGrantDeny.length) await userPerms.grantMany(toGrantDeny, 'deny')

			// Roles
			const toAssign: number[] = []
			const toUnassign: number[] = []
			for (const change of pendingRoles.values()) {
				if (change.action === 'assign') toAssign.push(change.roleId)
				else toUnassign.push(change.roleId)
			}
			if (toAssign.length) await userPerms.assignRoleMany(toAssign)
			if (toUnassign.length) await userPerms.unassignRoleMany(toUnassign)

			setPendingGrants(new Map())
			setPendingRoles(new Map())
		} catch (err) {
			alert(err instanceof Error ? err.message : String(err))
		}
	}, [userPerms, pendingGrants, pendingRoles])

	const handleDiscard = useCallback(() => {
		setPendingGrants(new Map())
		setPendingRoles(new Map())
	}, [])

	if (!user) {
		return (
			<Panel hideHeader>
				<Text size="sm" c="dimmed" ta="center" py="xl">
					{selectedUsers.length > 0
						? 'Click a user from the queue to edit permissions'
						: 'Search and add users to edit permissions'}
				</Text>
			</Panel>
		)
	}

	return (
		<Panel hideHeader>
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

				<Tabs
					value={tab}
					onChange={(v) => setTab((v as any) ?? 'grants')}
					keepMounted={false}
					style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
				>
					<Tabs.List>
						<Tabs.Tab value="grants" leftSection={<IconKey size={14} />}>
							Grants
						</Tabs.Tab>
						<Tabs.Tab value="roles" leftSection={<IconUsers size={14} />}>
							Roles
						</Tabs.Tab>
						<Tabs.Tab value="explain" leftSection={<IconShield size={14} />}>
							Explain
						</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel value="grants" pt="sm" style={{ flex: 1, minHeight: 0 }}>
						<Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
							<Paper withBorder p="xs" radius="md">
								<PermissionPicker
									nodes={catalog.nodes}
									infoByNode={catalog.infoByNode}
									value={selectedNodes}
									onChange={setSelectedNodes}
									effect={effect}
									onEffectChange={setEffect}
									onAdd={handleAdd}
								/>
							</Paper>

							<Group gap="sm" align="center" wrap="wrap">
								<TextInput
									placeholder="Search grants..."
									size="xs"
									leftSection={<IconSearch size={14} />}
									value={search}
									onChange={(e) => setSearch(e.currentTarget.value)}
									style={{ flex: 1, maxWidth: 240 }}
								/>
								<Button size="xs" variant="subtle" color="gray" onClick={grantFiltersCtl.toggle}>
									{grantFiltersOpened ? 'Hide filters' : 'Filters'}
								</Button>
								<Text size="xs" c="dimmed" style={{ marginLeft: 'auto' }}>
									{visibleGrants.length}/{displayGrants.length}
								</Text>
							</Group>

							<Collapse in={grantFiltersOpened}>
								<Stack gap="xs">
									<Group gap="sm" align="center" wrap="wrap">
										<Select
											size="xs"
											placeholder="Namespace"
											data={nsKeyOptions}
											value={filterNsKey}
											onChange={setFilterNsKey}
											clearable
											style={{ width: 200 }}
										/>
										<Select
											size="xs"
											placeholder="Kind"
											data={[
												{ value: 'all', label: 'All kinds' },
												{ value: 'exact', label: 'Exact' },
												{ value: 'star', label: 'Star' },
											]}
											value={filterKind}
											onChange={(v) => setFilterKind((v as any) ?? 'all')}
											style={{ width: 160 }}
										/>
										<Select
											size="xs"
											placeholder="Effect"
											data={[
												{ value: 'all', label: 'All effects' },
												{ value: 'allow', label: 'Allow' },
												{ value: 'deny', label: 'Deny' },
											]}
											value={filterEffect}
											onChange={(v) => setFilterEffect(((v as any) ?? 'all') as any)}
											style={{ width: 160 }}
										/>
										<Checkbox
											size="xs"
											label="Pending only"
											checked={showPendingOnly}
											onChange={(e) => setShowPendingOnly(e.currentTarget.checked)}
										/>
									</Group>
									<Group gap="xs">
										<Button size="xs" variant="light" color="gray" onClick={handleSelectVisible} disabled={!visibleGrants.length}>
											Select visible
										</Button>
										<Button size="xs" variant="subtle" color="gray" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>
											Clear selection
										</Button>
										<Button size="xs" variant="light" color="red" onClick={handleRevokeVisible} disabled={!visibleGrants.length}>
											Revoke visible
										</Button>
									</Group>
								</Stack>
							</Collapse>

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
					</Tabs.Panel>

					<Tabs.Panel value="roles" pt="sm" style={{ flex: 1, minHeight: 0 }}>
						<Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
							{targetUserIds.length > 1 && (
								<Paper withBorder p="xs" radius="md">
									<Stack gap="xs">
										<Group justify="space-between" align="center" wrap="wrap">
											<Group gap="xs" align="center" wrap="wrap">
												<Text fw={600} size="sm">
													Batch apply role
												</Text>
												<Badge variant="light" color="gray">
													{targetUserIds.length} users
												</Badge>
											</Group>
											<Button size="xs" variant="subtle" color="gray" onClick={() => setBulkRoleId(null)} disabled={bulkRoles.loading}>
												Reset
											</Button>
										</Group>
										<Group gap="sm" align="flex-end" wrap="wrap">
											<Select
												label="Role"
												size="xs"
												placeholder="Select a role"
												data={roles.options}
												value={bulkRoleId}
												onChange={setBulkRoleId}
												searchable
												clearable
												style={{ width: 320, maxWidth: '100%' }}
											/>
											<Button
												size="xs"
												variant="light"
												color="teal"
												loading={bulkRoles.loading}
												disabled={!bulkRoleId}
												onClick={async () => {
													const roleId = bulkRoleId ? Number(bulkRoleId) : NaN
													if (!Number.isFinite(roleId)) return
													if (!confirm(`Assign role #${roleId} to ${targetUserIds.length} users?`)) return
													await bulkRoles.assignRole(roleId)
													if (user) await userPerms.refresh()
												}}
											>
												Assign to all targets
											</Button>
											<Button
												size="xs"
												variant="light"
												color="red"
												loading={bulkRoles.loading}
												disabled={!bulkRoleId}
												onClick={async () => {
													const roleId = bulkRoleId ? Number(bulkRoleId) : NaN
													if (!Number.isFinite(roleId)) return
													if (!confirm(`Unassign role #${roleId} from ${targetUserIds.length} users?`)) return
													await bulkRoles.unassignRole(roleId)
													if (user) await userPerms.refresh()
												}}
											>
												Unassign from all targets
											</Button>
										</Group>
										{bulkRoles.error && (
											<Text size="xs" c="red">
												{bulkRoles.error}
											</Text>
										)}
									</Stack>
								</Paper>
							)}

							<Group gap="sm" align="center" wrap="wrap">
								<TextInput
									placeholder="Filter roles…"
									size="xs"
									leftSection={<IconSearch size={14} />}
									value={roleSearch}
									onChange={(e) => setRoleSearch(e.currentTarget.value)}
									style={{ flex: 1, maxWidth: 240 }}
								/>
								<Checkbox
									size="xs"
									label="Assigned only"
									checked={showAssignedOnly}
									onChange={(e) => setShowAssignedOnly(e.currentTarget.checked)}
								/>
								<Button
									size="xs"
									variant="light"
									color="gray"
									onClick={handleClearRoles}
									disabled={assignedCount === 0 && pendingRoles.size === 0}
								>
									Clear roles
								</Button>
								<Text size="xs" c="dimmed">
									{roleAssignments.length}/{roles.roles.length}
								</Text>
							</Group>

							{assignedCount === 0 && defaultRole && (
								<Text size="xs" c="dimmed">
									No explicit roles assigned. DEFAULT role ({defaultRole.name || `#${defaultRole.roleId}`} · r{defaultRole.rank}) applies implicitly.
								</Text>
							)}

							<Group gap="xs">
								<Button size="xs" variant="light" color="teal" onClick={handleAssignFilteredRoles} disabled={!roleAssignments.length}>
									Assign filtered
								</Button>
								<Button size="xs" variant="light" color="red" onClick={handleUnassignFilteredRoles} disabled={!roleAssignments.length}>
									Unassign filtered
								</Button>
							</Group>

							<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
								<Stack gap="xs">
									{roleAssignments.map(({ role, assigned, displayAssigned, pendingStatus }) => {
										const bg =
											pendingStatus === 'add'
												? 'var(--mantine-color-teal-light)'
												: pendingStatus === 'remove'
													? 'var(--mantine-color-red-light)'
													: displayAssigned
														? 'var(--mantine-color-gray-light)'
														: undefined
										const border =
											pendingStatus === 'add'
												? 'var(--mantine-color-teal-6)'
												: pendingStatus === 'remove'
													? 'var(--mantine-color-red-6)'
													: displayAssigned
														? 'var(--mantine-color-gray-4)'
														: 'var(--mantine-color-gray-3)'

										return (
											<Paper
												key={role.roleId}
												withBorder
												radius="md"
												p="xs"
												onClick={() => handleToggleRole(role.roleId, assigned)}
												style={{
													cursor: 'pointer',
													background: bg,
													borderColor: border,
													borderLeftWidth: displayAssigned ? 3 : 1,
													opacity: pendingStatus === 'remove' ? 0.8 : 1,
												}}
											>
												<Group justify="space-between" align="center" wrap="nowrap">
													<Group gap="sm" align="center" wrap="nowrap" style={{ minWidth: 0 }}>
														<Checkbox
															checked={displayAssigned}
															onChange={() => handleToggleRole(role.roleId, assigned)}
															onClick={(e) => e.stopPropagation()}
															aria-label={`${role.name?.trim() ? role.name : `Role #${role.roleId}`}: ${displayAssigned ? 'assigned' : 'not assigned'}`}
														/>
														<Tooltip
															label={[
																role.name?.trim() ? `${role.name}` : `Role #${role.roleId}`,
																`#${role.roleId}`,
																`r${role.rank}`,
																role.parentRoleId === null ? null : `parent #${role.parentRoleId}`,
															].filter(Boolean).join(' · ')}
														>
															<Stack gap={0} style={{ minWidth: 0 }}>
																<Text size="sm" fw={600} lineClamp={1}>
																	{role.name || `Role #${role.roleId}`}
																</Text>
																<Text size="xs" c="dimmed" lineClamp={1}>
																	#{role.roleId} · r{role.rank}
																	{role.parentRoleId === null ? '' : ` · parent #${role.parentRoleId}`}
																</Text>
															</Stack>
														</Tooltip>
													</Group>
													{pendingStatus ? (
														<Text size="xs" c={pendingStatus === 'add' ? 'teal' : 'red'}>
															{pendingStatus === 'add' ? 'pending assign' : 'pending unassign'}
														</Text>
													) : displayAssigned ? (
														<Text size="xs" c="dimmed">
															assigned
														</Text>
													) : (
														<Text size="xs" c="dimmed">
															—
														</Text>
													)}
												</Group>
											</Paper>
										)
									})}
								</Stack>
							</ScrollArea>
						</Stack>
					</Tabs.Panel>

					<Tabs.Panel value="explain" pt="sm">
						<Paper withBorder p="xs" radius="md">
								<Stack gap="xs">
									<Group gap="sm" align="flex-end" wrap="nowrap">
										<Box style={{ flex: 1, minWidth: 240 }}>
											<Select
												aria-label="Explain node"
												size="xs"
												placeholder="Explain node…"
												data={explainNodes}
												value={explainNode}
												onChange={(v) => setExplainNode(v)}
												searchable
											clearable
											nothingFoundMessage="No exact nodes in catalog"
										/>
									</Box>
									<Button
										size="xs"
										variant="light"
										loading={explain.loading}
										disabled={!explainNode}
										onClick={() => explainNode && void explain.explain(explainNode)}
									>
										Explain
									</Button>
									<Button size="xs" variant="subtle" color="gray" onClick={explain.clear} disabled={explain.loading}>
										Clear
									</Button>
								</Group>

								{explain.error && (
									<Text size="xs" c="red">
										{explain.error}
									</Text>
								)}

									{explain.result && (
										<Paper withBorder radius="md" p="xs" style={{ background: 'var(--mantine-color-gray-light)' }}>
											<Group gap="xs" wrap="wrap">
												<Badge size="sm" variant="filled" color={explain.result.decision === 'allow' ? 'teal' : 'red'}>
													{explain.result.decision.toUpperCase()}
												</Badge>
												<Badge size="sm" variant="light" color="gray">
													layer={explain.result.layer}
												</Badge>
												{'roleId' in explain.result && (
													<Badge size="sm" variant="light" color="gray">
														roleId={explain.result.roleId}
													</Badge>
												)}
												{'match' in explain.result && (
													<Badge size="sm" variant="light" color="gray">
														match={explain.result.match.kind === 'star' ? `star@${explain.result.match.depth}` : explain.result.match.kind}
													</Badge>
												)}
												{'reason' in explain.result && (
													<Badge size="sm" variant="light" color="gray">
														reason={explain.result.reason}
													</Badge>
												)}
											</Group>
										<Stack gap={4} mt="xs">
											<Group gap="xs" wrap="nowrap">
												<Text size="xs" c="dimmed" w={42}>
													Node
												</Text>
												<Code style={{ flex: 1 }}>{explain.result.node}</Code>
											</Group>
											{'rule' in explain.result && (
												<Group gap="xs" wrap="nowrap">
													<Text size="xs" c="dimmed" w={42}>
														Rule
													</Text>
													<Code style={{ flex: 1 }}>{explain.result.rule}</Code>
												</Group>
											)}
										</Stack>
									</Paper>
								)}
							</Stack>
						</Paper>
					</Tabs.Panel>
				</Tabs>
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
	const [selectedUsers, setSelectedUsers] = useState<UnifiedUserDto[]>([])
	const [activeUser, setActiveUser] = useState<UnifiedUserDto | null>(null)

	const roleGrants = useRoleGrants(selectedRoleId)
	const userPerms = useUserPermissions(activeUser?.id ?? null)

	// Auto-select first role (and recover if selection was deleted)
	useEffect(() => {
		if (!roles.roles.length) {
			if (selectedRoleId !== null) setSelectedRoleId(null)
			return
		}
		if (selectedRoleId === null || !roles.roles.some((r) => r.roleId === selectedRoleId)) {
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
