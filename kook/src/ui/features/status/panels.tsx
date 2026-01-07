import { useMemo, useState } from 'react'
import {
	Alert,
	Badge,
	Button,
	Group,
	Loader,
	Paper,
	Stack,
	Table,
	Text,
} from '@mantine/core'
import { IconRefresh, IconRobot } from '@tabler/icons-react'
import { rpcErrorMessage } from '@pluxel/hmr/web'
import type { BotStatus } from './types'
import { useKookSnapshot } from './model'
import type { CreateBotInput, UpdateBotInput } from '../../../runtime/bot-registry'
import { useKookPluginName, useKookRuntime } from '../../app/runtime'
import { formatTime, humanState, statusColors } from './consts'
import { AddBotForm, BotCard, HeaderIndicator } from './components'

export function SummaryPanel() {
	const pluginName = useKookPluginName()
	const { snapshot, loading, error, refresh } = useKookSnapshot()
	const bots = (snapshot?.bots ?? []).slice(0, 3)
	const overview = snapshot?.overview

	return (
		<Paper withBorder radius="md" p="md">
			<Stack gap="sm">
				<Group justify="space-between">
					<Group gap="xs">
						<IconRobot size={16} />
						<Text fw={700}>{pluginName} 概览</Text>
					</Group>
					<Button
						variant="light"
						size="compact-xs"
						onClick={() => refresh()}
						leftSection={<IconRefresh size={14} />}
						loading={loading}
					>
						刷新
					</Button>
				</Group>
				<Text size="xs" c="dimmed">
					{overview
						? `配置 ${overview.configuredBots} 个，运行 ${overview.activeBots}/${overview.totalBots}`
						: '同步中...'}
				</Text>
				{error && (
					<Alert color="red" radius="md" title="KOOK 状态异常">
						{error}
					</Alert>
				)}
				<Stack gap="xs">
					{bots.length === 0 ? (
						<Text size="sm" c="dimmed">
							暂无 Bot，前往「管理」页签创建。
						</Text>
					) : (
						bots.map((bot) => (
							<Group key={bot.id} gap="xs" justify="space-between">
								<Stack gap={2} style={{ flex: 1 }}>
									<Group gap="xs">
										<Badge size="sm" variant="light" color={statusColors[bot.state] ?? 'gray'}>
											{humanState(bot.state)}
										</Badge>
										<Badge size="sm" variant="light" color="grape">
											{bot.mode}
										</Badge>
									</Group>
									<Text fw={600} size="sm">
										{bot.displayName ?? bot.username ?? bot.botId ?? bot.instanceId ?? bot.tokenPreview}
									</Text>
									<Text size="xs" c={bot.lastError ? 'red' : 'dimmed'} lineClamp={1}>
										{bot.lastError ?? bot.stateMessage ?? '等待网关反馈'}
									</Text>
								</Stack>
								<Stack gap={2} align="flex-end">
									<Text size="xs" c="dimmed">
										事件 {formatTime(bot.lastEventAt)}
									</Text>
									<Text size="xs" c="dimmed">
										SN {bot.lastSequence ?? '—'}
									</Text>
								</Stack>
							</Group>
						))
					)}
				</Stack>
				<Text size="xs" c="dimmed">
					更多操作（连接/断开/删除）请前往右侧「管理」标签。
				</Text>
			</Stack>
		</Paper>
	)
}

export function StatusPanel() {
	const pluginName = useKookPluginName()
	const { snapshot, loading, error, refresh, setError } = useKookSnapshot()
	const { rpc } = useKookRuntime()
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [updatingId, setUpdatingId] = useState<string | null>(null)

	const bots = snapshot?.bots ?? []
	const overview = snapshot?.overview

	const handleCreate = async (input: CreateBotInput) => {
		const created = await rpc.createBot(input)
		await rpc.connectBot(created.id).catch(() => {})
		await refresh()
	}

	const handleConnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc.connectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '连接失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const handleDisconnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc.disconnectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '断开失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const handleDelete = async (bot: BotStatus) => {
		setDeletingId(bot.id)
		try {
			await rpc.deleteBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '删除失败'))
		} finally {
			setDeletingId(null)
		}
	}

	const handleUpdate = async (
		bot: BotStatus,
		patch: Partial<Pick<BotStatus, 'mode' | 'verifyToken'>>,
	) => {
		setUpdatingId(bot.id)
		try {
			await rpc.updateBot(bot.id, patch)
			await refresh()
		} catch (err) {
			setError(rpcErrorMessage(err, '更新失败'))
		} finally {
			setUpdatingId(null)
		}
	}

	const rows = useMemo(
		() =>
			bots.map((s) => {
				const name = s.displayName ?? s.username ?? s.botId ?? s.instanceId ?? s.tokenPreview
				const hint = s.lastError ?? s.stateMessage ?? '等待网关反馈'
				return {
					key: s.id,
					name: (
						<Stack gap={2}>
							<Text fw={600} size="sm">
								{name}
							</Text>
							<Text size="xs" c={s.lastError ? 'red' : 'dimmed'} lineClamp={1}>
								{hint}
							</Text>
						</Stack>
					),
					state: (
						<Badge size="sm" variant="light" color={statusColors[s.state] ?? 'gray'}>
							{humanState(s.state)}
						</Badge>
					),
					gateway: (
						<Stack gap={0}>
							<Text size="xs">{formatTime(s.lastEventAt)}</Text>
							<Text size="xs" c="dimmed" lineClamp={1}>
								{[
									s.gateway?.sessionId ? `Session ${s.gateway.sessionId.slice(0, 6)}…` : null,
									s.lastSequence ? `SN ${s.lastSequence}` : null,
								]
									.filter(Boolean)
									.join(' · ') || '—'}
							</Text>
						</Stack>
					),
				}
			}),
		[bots],
	)

	return (
		<Stack gap="md">
			<Paper withBorder radius="md" p="md">
				<Stack gap="sm">
						<Group justify="space-between">
							<Group gap="xs">
								<IconRobot size={16} />
								<Text fw={700}>{pluginName} Bot 状态</Text>
							</Group>
							<Button
								variant="light"
								size="compact-xs"
							onClick={() => refresh()}
							leftSection={<IconRefresh size={14} />}
							loading={loading}
						>
							刷新
						</Button>
					</Group>
					<Text size="xs" c="dimmed">
						{overview
							? `运行 ${overview.activeBots}/${overview.totalBots ?? overview.configuredBots ?? 0} · 配置 ${overview.configuredBots}`
							: '正在同步 KOOK Bot 状态'}
					</Text>
					{error && (
						<Alert color="red" radius="md" title="KOOK RPC 错误">
							{error}
						</Alert>
					)}
					<Stack gap="sm">
						{rows.length > 0 ? (
							<Table striped highlightOnHover withTableBorder withColumnBorders horizontalSpacing="sm" verticalSpacing="xs">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>Bot</Table.Th>
										<Table.Th>状态 / 模式</Table.Th>
										<Table.Th>网关</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{rows.map((r) => (
										<Table.Tr key={r.key}>
											<Table.Td>{r.name}</Table.Td>
											<Table.Td>{r.state}</Table.Td>
											<Table.Td>{r.gateway}</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						) : (
							!loading && (
								<Text size="sm" c="dimmed">
									还没有成功启动的 KOOK Bot。
								</Text>
							)
						)}
					</Stack>
				</Stack>
			</Paper>
			<AddBotForm onCreate={handleCreate} />
			<Stack gap="sm">
				{bots.map((bot) => (
					<BotCard
						key={bot.id}
						bot={bot}
						onConnect={handleConnect}
						onDisconnect={handleDisconnect}
						onDelete={handleDelete}
						onUpdate={handleUpdate}
						loadingId={loadingId}
						deletingId={deletingId}
						updatingId={updatingId}
					/>
				))}
			</Stack>
		</Stack>
	)
}
