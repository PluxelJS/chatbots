import {
	ActionIcon,
	Alert,
	Badge,
	Box,
	Button,
	Checkbox,
	Code,
	Divider,
	Group,
	MultiSelect,
	Paper,
	ScrollArea,
	Stack,
	Table,
	Text,
	Tooltip,
} from '@mantine/core'
import {
	IconAlertCircle,
	IconAsterisk,
	IconCheck,
	IconCircleDot,
	IconClock,
	IconRefresh,
	IconTrash,
	IconX,
} from '@tabler/icons-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type { PermissionGrantDto } from '../core/permissions-types'
import { formatGrantNode, formatTimestamp, type PermissionEffect, type PermissionInfo } from './hooks'

// ─────────────────────────────────────────────────────────────────────────────
// Effect Toggle - 可点击切换的 allow/deny 图标
// ─────────────────────────────────────────────────────────────────────────────

type EffectToggleProps = {
	effect: PermissionEffect
	onClick?: () => void
	disabled?: boolean
	size?: 'xs' | 'sm' | 'md'
}

export function EffectToggle({ effect, onClick, disabled, size = 'sm' }: EffectToggleProps) {
	const isAllow = effect === 'allow'
	return (
		<Tooltip label={`Click to ${isAllow ? 'deny' : 'allow'}`}>
			<ActionIcon
				variant="light"
				size={size}
				color={isAllow ? 'teal' : 'red'}
				onClick={onClick}
				disabled={disabled}
				aria-label={isAllow ? 'Set effect to deny' : 'Set effect to allow'}
				style={{ cursor: disabled ? 'default' : 'pointer' }}
			>
				{isAllow ? <IconCheck size={14} /> : <IconX size={14} />}
			</ActionIcon>
		</Tooltip>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Kind Badge - 权限类型标识 (exact/star)
// ─────────────────────────────────────────────────────────────────────────────

type KindBadgeProps = {
	kind: 'exact' | 'star'
}

export function KindBadge({ kind }: KindBadgeProps) {
	return (
		<Tooltip label={kind === 'star' ? 'Wildcard' : 'Exact'}>
			<ActionIcon variant="subtle" size="sm" color="gray" aria-label={kind === 'star' ? 'Wildcard permission' : 'Exact permission'}>
				{kind === 'star' ? <IconAsterisk size={12} /> : <IconCircleDot size={12} />}
			</ActionIcon>
		</Tooltip>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission Node Picker - 支持多选的权限节点选择器
// ─────────────────────────────────────────────────────────────────────────────

type PermissionPickerProps = {
	nodes: string[]
	infoByNode: Map<string, PermissionInfo>
	value: string[]
	onChange: (value: string[]) => void
	effect: PermissionEffect
	onEffectChange: (effect: PermissionEffect) => void
	onAdd: () => void
	disabled?: boolean
	label?: string
}

export function PermissionPicker({
	nodes,
	infoByNode,
	value,
	onChange,
	effect,
	onEffectChange,
	onAdd,
	disabled,
	label = 'Permission nodes',
}: PermissionPickerProps) {
	const data = useMemo(
		() =>
			nodes.map((node) => {
				const info = infoByNode.get(node)
				return {
					value: node,
					label: node,
					description: info?.description,
				}
			}),
		[nodes, infoByNode],
	)

	const toggleEffect = useCallback(() => {
		onEffectChange(effect === 'allow' ? 'deny' : 'allow')
	}, [effect, onEffectChange])

	return (
		<Group gap="sm" align="flex-end">
			<Box style={{ flex: 1, minWidth: 200 }}>
				<MultiSelect
					label={label}
					placeholder="Select permission nodes"
					data={data}
					value={value}
					onChange={onChange}
					searchable
					clearable
					maxDropdownHeight={280}
					disabled={disabled}
					renderOption={({ option }) => {
						const info = infoByNode.get(option.value)
						return (
							<Group justify="space-between" w="100%" wrap="nowrap">
								<Group gap="xs" wrap="nowrap">
									{info && <KindBadge kind={info.kind} />}
									<Text size="sm">{option.value}</Text>
								</Group>
								{info?.description && (
									<Text size="xs" c="dimmed" lineClamp={1}>
										{info.description}
									</Text>
								)}
							</Group>
						)
					}}
				/>
			</Box>
			<EffectToggle effect={effect} onClick={toggleEffect} size="md" />
			<Button variant="light" onClick={onAdd} disabled={disabled || !value.length}>
				Add {value.length > 1 ? `(${value.length})` : ''}
			</Button>
		</Group>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Grants Table - 权限授权表格 (支持多选)
// ─────────────────────────────────────────────────────────────────────────────

type GrantsTableProps = {
	grants: PermissionGrantDto[]
	selectedIds: Set<number>
	onSelectChange: (ids: Set<number>) => void
	onToggleEffect: (grant: PermissionGrantDto) => void
	onRevoke: (grant: PermissionGrantDto) => void
	disabled?: boolean
}

export function GrantsTable({
	grants,
	selectedIds,
	onSelectChange,
	onToggleEffect,
	onRevoke,
	disabled,
}: GrantsTableProps) {
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
					<Table.Th w={50} />
				</Table.Tr>
			</Table.Thead>
			<Table.Tbody>
				{grants.map((grant) => (
					<Table.Tr key={grant.id}>
						<Table.Td>
							<Checkbox
								checked={selectedIds.has(grant.id)}
								onChange={() => toggleOne(grant.id)}
								disabled={disabled}
								aria-label={`Select grant ${formatGrantNode(grant)}`}
							/>
						</Table.Td>
						<Table.Td>
							<Group gap="xs" wrap="nowrap">
								<KindBadge kind={grant.kind} />
								<Code>{formatGrantNode(grant)}</Code>
								<Tooltip label={formatTimestamp(grant.updatedAt)}>
									<ActionIcon variant="subtle" size="xs" color="gray" aria-label="Show last updated time">
										<IconClock size={10} />
									</ActionIcon>
								</Tooltip>
							</Group>
						</Table.Td>
						<Table.Td>
							<EffectToggle
								effect={grant.effect}
								onClick={() => onToggleEffect(grant)}
								disabled={disabled}
							/>
						</Table.Td>
						<Table.Td>
							<Tooltip label="Revoke">
								<ActionIcon
									variant="subtle"
									color="red"
									size="sm"
									onClick={() => onRevoke(grant)}
									disabled={disabled}
									aria-label={`Revoke grant ${formatGrantNode(grant)}`}
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
// Bulk Actions Toolbar - 批量操作工具栏
// ─────────────────────────────────────────────────────────────────────────────

type BulkActionsProps = {
	selectedCount: number
	onBulkAllow: () => void
	onBulkDeny: () => void
	onBulkRevoke: () => void
	onClear: () => void
	disabled?: boolean
}

export function BulkActions({
	selectedCount,
	onBulkAllow,
	onBulkDeny,
	onBulkRevoke,
	onClear,
	disabled,
}: BulkActionsProps) {
	if (selectedCount === 0) return null

	return (
		<Paper withBorder radius="md" p="xs" style={{ background: 'var(--mantine-color-gray-light)' }}>
			<Group justify="space-between" align="center">
				<Group gap="xs">
					<Badge variant="light" color="gray">
						{selectedCount} selected
					</Badge>
					<Button size="xs" variant="light" color="teal" onClick={onBulkAllow} disabled={disabled}>
						Set Allow
					</Button>
					<Button size="xs" variant="light" color="red" onClick={onBulkDeny} disabled={disabled}>
						Set Deny
					</Button>
					<Button size="xs" variant="light" color="gray" onClick={onBulkRevoke} disabled={disabled}>
						Revoke All
					</Button>
				</Group>
				<Button size="xs" variant="subtle" onClick={onClear}>
					Clear
				</Button>
			</Group>
		</Paper>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Page Header - 统一的页面头部组件
// ─────────────────────────────────────────────────────────────────────────────

type PageHeaderProps = {
	icon: ReactNode
	title: string
	subtitle?: string
	badges?: ReactNode
	actions?: ReactNode
	error?: string | null
	onDismissError?: () => void
}

export function PageHeader({
	icon,
	title,
	subtitle,
	badges,
	actions,
	error,
	onDismissError,
}: PageHeaderProps) {
	return (
		<Paper withBorder radius="lg" p="sm">
			<Group justify="space-between" align="center">
				<Group gap="sm" align="center">
					{icon}
					<Stack gap={0}>
						<Text size="lg" fw={700}>
							{title}
						</Text>
						{subtitle && (
							<Text size="xs" c="dimmed">
								{subtitle}
							</Text>
						)}
					</Stack>
				</Group>
				<Group gap="xs">
					{badges}
					{actions}
				</Group>
			</Group>
			{error && (
				<Alert
					mt="sm"
					color="red"
					icon={<IconAlertCircle size={16} />}
					title="Error"
					withCloseButton={!!onDismissError}
					onClose={onDismissError}
				>
					{error}
				</Alert>
			)}
		</Paper>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel - 通用面板容器
// ─────────────────────────────────────────────────────────────────────────────

type PanelProps = {
	title: string
	icon?: ReactNode
	badge?: ReactNode
	actions?: ReactNode
	children: ReactNode
}

export function Panel({ title, icon, badge, actions, children }: PanelProps) {
	return (
		<Paper withBorder radius="lg" p="sm" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
			<Group justify="space-between" align="center">
				<Group gap="xs" align="center">
					{icon}
					<Text fw={600}>{title}</Text>
				</Group>
				<Group gap="xs">
					{badge}
					{actions}
				</Group>
			</Group>
			<Divider my="sm" />
			<Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
				{children}
			</Box>
		</Paper>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh Button - 刷新按钮
// ─────────────────────────────────────────────────────────────────────────────

type RefreshButtonProps = {
	onClick: () => void
	loading?: boolean
}

export function RefreshButton({ onClick, loading }: RefreshButtonProps) {
	return (
		<Tooltip label="Refresh">
			<ActionIcon variant="light" size="sm" onClick={onClick} loading={loading} aria-label="Refresh">
				<IconRefresh size={14} />
			</ActionIcon>
		</Tooltip>
	)
}
