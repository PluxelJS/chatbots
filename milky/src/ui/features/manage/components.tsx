import { useEffect, useState } from 'react'
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
import { IconPlugConnected, IconRefresh, IconRobotFace, IconRocket, IconTrash } from '@tabler/icons-react'
import { rpcErrorMessage } from '@pluxel/hmr/web'
import type { CreateBotInput, UpdateBotInput } from '../../../runtime/bot-registry'
import { useMilkyRuntime } from '../../app/runtime'
import type { BotStatus, Overview, Snapshot } from './types'
import { useMilkySnapshot } from './model'
import { formatTime, stateColors, stateLabels } from './consts'

function HeaderIndicator() {
	const { overview, error, loading } = useMilkySnapshot()

	const configured = overview?.configuredBots ?? 0
	const total = overview?.totalBots ?? configured
	const active = overview?.activeBots ?? 0
	const color = error ? 'red' : active > 0 ? 'teal' : total > 0 ? 'yellow' : 'blue'
	const label = error ? error : `${active}/${total || configured} 运行`

	return (
		<Tooltip label={error ?? 'Milky 状态监控'}>
			<Badge
				variant="light"
				color={color}
				size="sm"
				leftSection={loading ? <Loader size={12} /> : <IconPlugConnected size={12} />}
			>
				Milky · {label}
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
	onUpdate: (bot: BotStatus, patch: UpdateBotInput) => Promise<void>
	loadingId: string | null
	deletingId: string | null
	updatingId: string | null
}) {
	const busy = loadingId === bot.id
	const [editing, setEditing] = useState(false)
	const [name, setName] = useState(bot.name ?? '')
	const [baseUrl, setBaseUrl] = useState(bot.baseUrl)
	const [accessToken, setAccessToken] = useState('')

	useEffect(() => {
		setName(bot.name ?? '')
		setBaseUrl(bot.baseUrl)
		setAccessToken('')
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
								SSE
							</Badge>
							<Text fw={700}>
								{bot.name ?? bot.nickname ?? (String(bot.selfId ?? '') || bot.baseUrl)}
							</Text>
						</Group>
						<Text size="xs" c={bot.lastError ? 'red' : 'dimmed'} lineClamp={1}>
							{bot.lastError ?? bot.stateMessage ?? bot.lastEventType ?? '等待事件'}
						</Text>
					</Stack>
					<Group gap="xs" wrap="wrap" justify="flex-end">
						<Button
							size="sm"
							variant="filled"
							color="teal"
							loading={busy}
							onClick={() => onConnect(bot)}
							disabled={busy || bot.state === 'online' || bot.state === 'connecting'}
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

				<Table withTableBorder withColumnBorders>
					<Table.Tbody>
						<Table.Tr>
							<Table.Td>Self ID</Table.Td>
							<Table.Td>{bot.selfId ?? '—'}</Table.Td>
							<Table.Td>昵称</Table.Td>
							<Table.Td>{bot.nickname ?? '—'}</Table.Td>
						</Table.Tr>
						<Table.Tr>
							<Table.Td>Base URL</Table.Td>
							<Table.Td colSpan={3}>{bot.baseUrl}</Table.Td>
						</Table.Tr>
						<Table.Tr>
							<Table.Td>Token</Table.Td>
							<Table.Td>{bot.tokenPreview}</Table.Td>
							<Table.Td>Last Event</Table.Td>
							<Table.Td>
								{formatTime(bot.lastEventAt)}
								{bot.lastEventType ? ` (${bot.lastEventType})` : ''}
							</Table.Td>
						</Table.Tr>
						<Table.Tr>
							<Table.Td>Impl</Table.Td>
							<Table.Td colSpan={3}>
								{bot.implName ? `${bot.implName} ${bot.implVersion ?? ''}` : '—'}
							</Table.Td>
						</Table.Tr>
					</Table.Tbody>
				</Table>

				<Collapse in={editing}>
					<Paper withBorder p="md" radius="md">
						<Stack gap="sm">
							<TextInput
								label="显示名称（可选）"
								value={name}
								onChange={(e) => setName(e.currentTarget.value)}
								placeholder="例如：QQ 主号"
							/>
							<TextInput
								label="协议端 Base URL"
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.currentTarget.value)}
								placeholder="http://127.0.0.1:3000"
							/>
							<TextInput
								label="Access Token（可选）"
								value={accessToken}
								onChange={(e) => setAccessToken(e.currentTarget.value)}
								placeholder="协议端 access_token（只填写 token）"
							/>
							<Group justify="flex-end">
								<Button
									size="compact-xs"
									loading={updatingId === bot.id}
									onClick={() =>
										onUpdate(bot, {
											name: name.trim() || undefined,
											baseUrl: baseUrl.trim() || bot.baseUrl,
											accessToken: accessToken.trim() || undefined,
										})
									}
								>
									保存配置
								</Button>
							</Group>
						</Stack>
					</Paper>
				</Collapse>
			</Stack>
		</Card>
	)
}

function MainPanel() {
	const { rpc } = useMilkyRuntime()
	const { snapshot, overview, error, loading, setError, refresh } = useMilkySnapshot()

	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [updatingId, setUpdatingId] = useState<string | null>(null)

	const [newName, setNewName] = useState('')
	const [newBaseUrl, setNewBaseUrl] = useState('')
	const [newToken, setNewToken] = useState('')
	const [creating, setCreating] = useState(false)

	const bots = snapshot?.bots ?? []

	const onCreate = async () => {
		setCreating(true)
		try {
			const input: CreateBotInput = {
				name: newName.trim() || undefined,
				baseUrl: newBaseUrl.trim(),
				accessToken: newToken.trim() || undefined,
			}
			const created = await rpc.createBot(input)
			await rpc.connectBot(created.id).catch(() => {})
			setNewName('')
			setNewBaseUrl('')
			setNewToken('')
			await refresh()
		} catch (err) {
			setError(rpcErrorMessage(err, '创建失败'))
		} finally {
			setCreating(false)
		}
	}

	const onConnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc.connectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '连接失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const onDisconnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc.disconnectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '断开失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const onDelete = async (bot: BotStatus) => {
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

	const onUpdate = async (bot: BotStatus, patch: UpdateBotInput) => {
		setUpdatingId(bot.id)
		try {
			await rpc.updateBot(bot.id, patch)
			await refresh()
		} catch (err) {
			setError(rpcErrorMessage(err, '保存配置失败'))
		} finally {
			setUpdatingId(null)
		}
	}

	return (
		<Stack gap="md">
			<Paper withBorder p="md" radius="md">
				<Stack gap="sm">
					<Group justify="space-between" align="center" wrap="wrap">
						<Group gap="xs">
							<IconRobotFace size={18} />
							<Text fw={700}>Milky 管理</Text>
						</Group>
						<Group gap="xs">
							<Button
								size="xs"
								variant="light"
								leftSection={<IconRefresh size={14} />}
								onClick={() => void refresh()}
								disabled={loading}
							>
								刷新
							</Button>
						</Group>
					</Group>
					<Text size="xs" c="dimmed">
						{overview
							? `运行 ${overview.activeBots}/${overview.totalBots ?? overview.configuredBots ?? 0} · 配置 ${overview.configuredBots}`
							: '正在同步 Milky 状态'}
					</Text>
					{error ? (
						<Alert color="red" radius="md" title="Milky RPC 错误">
							{error}
						</Alert>
					) : null}
				</Stack>
			</Paper>

			<Paper withBorder p="md" radius="md">
				<Stack gap="sm">
					<Text fw={700}>添加 Bot</Text>
					<Group grow>
						<TextInput
							label="显示名称（可选）"
							value={newName}
							onChange={(e) => setNewName(e.currentTarget.value)}
							placeholder="例如：QQ 主号"
						/>
					</Group>
					<TextInput
						label="协议端 Base URL"
						value={newBaseUrl}
						onChange={(e) => setNewBaseUrl(e.currentTarget.value)}
						placeholder="http://127.0.0.1:3000"
					/>
					<TextInput
						label="Access Token（可选）"
						value={newToken}
						onChange={(e) => setNewToken(e.currentTarget.value)}
						placeholder="协议端 access_token（只填写 token）"
					/>
					<Group justify="flex-end">
						<Button
							leftSection={<IconRocket size={14} />}
							disabled={!newBaseUrl.trim()}
							loading={creating}
							onClick={() => void onCreate()}
						>
							创建
						</Button>
					</Group>
				</Stack>
			</Paper>

			<Stack gap="md">
				{bots.length === 0 ? (
					<Text c="dimmed" size="sm">
						暂无 Bot，请先添加一个。
					</Text>
				) : null}
				{bots.map((bot) => (
					<BotCard
						key={bot.id}
						bot={bot}
						onConnect={onConnect}
						onDisconnect={onDisconnect}
						onDelete={onDelete}
						onUpdate={onUpdate}
						loadingId={loadingId}
						deletingId={deletingId}
						updatingId={updatingId}
					/>
				))}
			</Stack>
		</Stack>
	)
}

export function ManageTab() {
	return <MainPanel />
}

export function SummaryPanel() {
	return (
		<Stack gap="sm">
			<HeaderIndicator />
		</Stack>
	)
}

