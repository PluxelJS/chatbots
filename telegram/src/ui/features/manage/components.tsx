import { useEffect, useMemo, useState } from 'react'
import {
	Alert,
	Badge,
	Button,
	Card,
	Collapse,
	Group,
	Loader,
	Paper,
	Select,
	Stack,
	Table,
	Text,
	TextInput,
	Tooltip,
} from '@mantine/core'
import { IconPlugConnected, IconRefresh, IconRocket, IconTrash } from '@tabler/icons-react'
import { rpcErrorMessage } from '@pluxel/hmr/web'

import type { CreateBotInput, UpdateBotInput } from '../../../runtime/bot-registry'
import { useTelegramRuntime } from '../../app/runtime'
import { useTelegramSnapshot } from './model'
import { formatTime, stateColors, stateLabels } from './consts'
import type { BotMode, BotStatus } from './types'

function HeaderIndicator() {
	const { overview, error, loading } = useTelegramSnapshot()

	const configured = overview?.configuredBots ?? 0
	const total = overview?.totalBots ?? configured
	const active = overview?.activeBots ?? 0
	const color = error ? 'red' : active > 0 ? 'teal' : total > 0 ? 'yellow' : 'blue'
	const label = error ? error : `${active}/${total || configured} 运行`

	return (
		<Tooltip label={error ?? 'Telegram 状态监控'}>
			<Badge
				variant="light"
				color={color}
				size="sm"
				leftSection={loading ? <Loader size={12} /> : <IconPlugConnected size={12} />}
			>
				Telegram · {label}
			</Badge>
		</Tooltip>
	)
}

function BotCard({
	bot,
	onConnect,
	onDisconnect,
	onDelete,
	onUpdate,
	loadingId,
	deletingId,
	updatingId,
}: {
	bot: BotStatus
	onConnect: (bot: BotStatus) => Promise<void>
	onDisconnect: (bot: BotStatus) => Promise<void>
	onDelete: (bot: BotStatus) => Promise<void>
	onUpdate: (
		bot: BotStatus,
		patch: Partial<Pick<BotStatus, 'mode' | 'webhookUrl' | 'webhookSecretToken'>>,
	) => Promise<void>
	loadingId: string | null
	deletingId: string | null
	updatingId: string | null
}) {
	const busy = loadingId === bot.id
	const [editing, setEditing] = useState(false)
	const [mode, setMode] = useState<BotMode>(bot.mode)
	const [webhookUrl, setWebhookUrl] = useState(bot.webhookUrl ?? '')
	const [secret, setSecret] = useState(bot.webhookSecretToken ?? '')

	useEffect(() => {
		setMode(bot.mode)
		setWebhookUrl(bot.webhookUrl ?? '')
		setSecret(bot.webhookSecretToken ?? '')
	}, [bot])

	return (
		<Card withBorder radius="md" p="md">
			<Stack gap="sm">
				<Group justify="space-between" align="center">
					<Stack gap={4}>
						<Group gap="xs" align="center" wrap="wrap">
							<Badge size="sm" variant="filled" color={stateColors[bot.state] ?? 'gray'}>
								{stateLabels[bot.state] ?? bot.state}
							</Badge>
							<Badge size="sm" variant="filled" color="indigo">
								{bot.mode}
							</Badge>
							<Text fw={700}>{bot.displayName ?? bot.username ?? bot.tokenPreview}</Text>
						</Group>
						<Text size="xs" c={bot.lastError ? 'red' : 'dimmed'} lineClamp={1}>
							{bot.lastError ?? bot.stateMessage ?? '等待事件'}
						</Text>
					</Stack>
					<Group gap="xs" wrap="wrap" justify="flex-end">
						<Button
							size="sm"
							variant="filled"
							color="teal"
							loading={busy}
							onClick={() => onConnect(bot)}
							disabled={busy || bot.state === 'polling' || bot.state === 'webhook'}
						>
							连接
						</Button>
						<Button
							size="sm"
							variant="filled"
							color="orange"
							onClick={() => onDisconnect(bot)}
							loading={busy}
							disabled={busy || bot.state === 'stopped'}
						>
							断开
						</Button>
						<Button
							size="sm"
							variant="light"
							color="red"
							onClick={() => onDelete(bot)}
							loading={deletingId === bot.id}
							disabled={busy}
							leftSection={<IconTrash size={14} />}
						>
							删除
						</Button>
						<Button size="sm" variant="light" onClick={() => setEditing((v) => !v)}>
							{editing ? '收起' : '编辑配置'}
						</Button>
					</Group>
				</Group>

				<Collapse in={editing}>
					<Stack gap="xs">
						<Select
							label="模式"
							value={mode}
							onChange={(v) => setMode((v as BotMode) || bot.mode)}
							data={[
								{ value: 'polling', label: 'polling' },
								{ value: 'webhook', label: 'webhook' },
								{ value: 'api', label: 'api' },
							]}
						/>
						<TextInput
							label="Webhook URL"
							value={webhookUrl}
							onChange={(e) => setWebhookUrl(e.currentTarget.value)}
							disabled={mode !== 'webhook'}
						/>
						<TextInput
							label="Secret Token (webhook)"
							value={secret}
							onChange={(e) => setSecret(e.currentTarget.value)}
							disabled={mode !== 'webhook'}
						/>
						<Group justify="flex-end">
							<Button
								size="compact-xs"
								loading={updatingId === bot.id}
								onClick={() =>
									onUpdate(bot, {
										mode,
										webhookUrl: webhookUrl.trim() || undefined,
										webhookSecretToken: secret.trim() || undefined,
									})
								}
							>
								保存配置
							</Button>
						</Group>
					</Stack>
				</Collapse>

				<Table withTableBorder withColumnBorders>
					<Table.Tbody>
						<Table.Tr>
							<Table.Td>Token</Table.Td>
							<Table.Td>{bot.tokenPreview}</Table.Td>
							<Table.Td>更新</Table.Td>
							<Table.Td>{formatTime(bot.lastUpdateAt)}</Table.Td>
						</Table.Tr>
						<Table.Tr>
							<Table.Td>Offset</Table.Td>
							<Table.Td>{bot.pollingOffset ?? '—'}</Table.Td>
							<Table.Td>Webhook</Table.Td>
							<Table.Td>{bot.webhookUrl ?? '—'}</Table.Td>
						</Table.Tr>
					</Table.Tbody>
				</Table>
			</Stack>
		</Card>
	)
}

function AddBotForm({ onCreate }: { onCreate: (input: CreateBotInput) => Promise<void> }) {
	const [token, setToken] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleSubmit = async () => {
		setError(null)
		const trimmed = token.trim()
		if (!trimmed) {
			setError('请输入 token')
			return
		}
		setSubmitting(true)
		try {
			await onCreate({ token: trimmed })
			setToken('')
		} catch (err) {
			setError(rpcErrorMessage(err, '创建失败'))
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<Card withBorder radius="md" p="md" shadow="xs">
			<Stack gap="sm">
				<Group gap="xs">
					<IconRocket size={16} />
					<Text fw={700}>新增 Telegram Bot（安全存储 token）</Text>
				</Group>
				{error && (
					<Alert color="red" radius="md">
						{error}
					</Alert>
				)}
				<Group align="flex-end" wrap="wrap">
					<TextInput
						label="Token"
						placeholder="123456:ABC..."
						value={token}
						onChange={(e) => setToken(e.currentTarget.value)}
						style={{ flex: 1, minWidth: 280 }}
					/>
					<Button onClick={handleSubmit} loading={submitting} disabled={!token.trim()}>
						保存
					</Button>
				</Group>
				<Text size="xs" c="dimmed">
					更多连接方式（polling/webhook）可在 Bot 卡片中切换并保存。
				</Text>
			</Stack>
		</Card>
	)
}

function ManageDashboard({
	overview,
	bots,
	loading,
	error,
	onRefresh,
}: {
	overview: ReturnType<typeof useTelegramSnapshot>['overview']
	bots: BotStatus[]
	loading: boolean
	error: string | null
	onRefresh: () => Promise<void>
}) {
	const rows = useMemo(() => {
		return bots.map((bot) => ({
			key: bot.id,
			name: bot.displayName ?? bot.username ?? bot.tokenPreview,
			state: stateLabels[bot.state] ?? bot.state,
			mode: bot.mode,
		}))
	}, [bots])

	return (
		<Paper withBorder p="md" radius="md">
			<Stack gap="sm">
				<Group justify="space-between" align="center" wrap="wrap">
					<Text fw={700}>Telegram 管理</Text>
					<Button
						size="xs"
						variant="light"
						leftSection={<IconRefresh size={14} />}
						onClick={() => void onRefresh()}
						disabled={loading}
					>
						刷新
					</Button>
				</Group>
				<Text size="xs" c="dimmed">
					{overview
						? `运行 ${overview.activeBots}/${overview.totalBots ?? overview.configuredBots ?? 0} · 配置 ${overview.configuredBots}`
						: '正在同步 Telegram 状态'}
				</Text>
				{error && (
					<Alert color="red" radius="md" title="Telegram RPC 错误">
						{error}
					</Alert>
				)}

				{rows.length > 0 ? (
					<Table
						striped
						highlightOnHover
						withTableBorder
						withColumnBorders
						horizontalSpacing="sm"
						verticalSpacing="xs"
					>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Bot</Table.Th>
								<Table.Th>状态</Table.Th>
								<Table.Th>模式</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{rows.map((r) => (
								<Table.Tr key={r.key}>
									<Table.Td>{r.name}</Table.Td>
									<Table.Td>{r.state}</Table.Td>
									<Table.Td>{r.mode}</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				) : (
					!loading && (
						<Text size="sm" c="dimmed">
							还没有成功启动的 Telegram Bot。
						</Text>
					)
				)}
			</Stack>
		</Paper>
	)
}

function StatusPanel() {
	const { rpc } = useTelegramRuntime()
	const { snapshot, overview, error, loading, setError, refresh } = useTelegramSnapshot()
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [updatingId, setUpdatingId] = useState<string | null>(null)

	const bots = snapshot?.bots ?? []

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
			await refresh()
		} catch (err) {
			setError(rpcErrorMessage(err, '删除失败'))
		} finally {
			setDeletingId(null)
		}
	}

	const handleUpdate = async (
		bot: BotStatus,
		patch: Partial<Pick<BotStatus, 'mode' | 'webhookUrl' | 'webhookSecretToken'>>,
	) => {
		setUpdatingId(bot.id)
		try {
			const next: UpdateBotInput = {
				mode: patch.mode,
				webhookUrl: patch.webhookUrl,
				webhookSecretToken: patch.webhookSecretToken,
			}
			await rpc.updateBot(bot.id, next)
			await refresh()
		} catch (err) {
			setError(rpcErrorMessage(err, '保存配置失败'))
		} finally {
			setUpdatingId(null)
		}
	}

	return (
		<Stack gap="md">
			<ManageDashboard overview={overview} bots={bots} loading={loading} error={error} onRefresh={refresh} />
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

export function SummaryPanel() {
	const { snapshot, overview, error } = useTelegramSnapshot()
	const bots = (snapshot?.bots ?? []).slice(0, 3)

	return (
		<Paper withBorder p="md" radius="md">
			<Stack gap="sm">
				<HeaderIndicator />
				<Text size="xs" c="dimmed">
					{overview
						? `运行 ${overview.activeBots}/${overview.totalBots ?? overview.configuredBots ?? 0}`
						: '正在加载…'}
				</Text>
				{error ? (
					<Alert color="red" radius="md">
						{error}
					</Alert>
				) : null}
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
										<Badge size="sm" variant="light" color={stateColors[bot.state] ?? 'gray'}>
											{stateLabels[bot.state] ?? bot.state}
										</Badge>
										<Badge size="sm" variant="light" color="indigo">
											{bot.mode}
										</Badge>
									</Group>
									<Text fw={600} size="sm">
										{bot.displayName ?? bot.username ?? bot.tokenPreview}
									</Text>
									<Text size="xs" c={bot.lastError ? 'red' : 'dimmed'} lineClamp={1}>
										{bot.lastError ?? bot.stateMessage ?? '等待事件'}
									</Text>
								</Stack>
								<Stack gap={2} align="flex-end">
									<Text size="xs" c="dimmed">
										更新 {formatTime(bot.lastUpdateAt)}
									</Text>
									<Text size="xs" c="dimmed">
										Offset {bot.pollingOffset ?? '—'}
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

export function ManageTab() {
	return <StatusPanel />
}
