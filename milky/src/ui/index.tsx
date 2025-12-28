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
import { IconPlugConnected, IconRefresh, IconRobotFace, IconRocket, IconTrash } from '@tabler/icons-react'
import {
	definePluginUIModule,
	rpcErrorMessage,
	hmrWebClient,
	type PluginExtensionContext,
} from '@pluxel/hmr/web'
import type { MilkySnapshot } from '../runtime'
import type { CreateBotInput, UpdateBotInput } from '../runtime/bot-registry'
import type { MilkyEventTransport } from '../config'

type Snapshot = MilkySnapshot
type BotStatus = Snapshot['bots'][number]
type Overview = Snapshot['overview']

type RpcClient = {
	snapshot: () => Promise<Snapshot>
	connectBot: (id: string) => Promise<unknown>
	disconnectBot: (id: string) => Promise<unknown>
	deleteBot: (id: string) => Promise<unknown>
	updateBot: (id: string, patch: UpdateBotInput) => Promise<unknown>
	createBot: (input: CreateBotInput) => Promise<BotStatus>
}

const rpc = (): RpcClient => (hmrWebClient.rpc as any).Milky as RpcClient

const stateColors: Record<string, string> = {
	initializing: 'yellow',
	connecting: 'yellow',
	online: 'teal',
	error: 'red',
	stopped: 'gray',
}

const stateLabels: Partial<Record<string, string>> = {
	initializing: '初始化',
	connecting: '连接中',
	online: '在线',
	error: '异常',
	stopped: '停止',
}

const formatTime = (value?: number) => (value ? new Date(value).toLocaleTimeString() : '—')

const useMilkySse = () => useMemo(() => hmrWebClient.createSse({ namespaces: ['Milky'] }), [])

function useMilkySnapshot() {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [overview, setOverview] = useState<Overview | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const sse = useMilkySse()

	useEffect(() => {
		let mounted = true

		const bootstrap = async () => {
			setLoading(true)
			try {
				const snap = await rpc().snapshot()
				if (!mounted) return
				setSnapshot(snap)
				setOverview(snap.overview)
				setError(null)
			} catch (err: any) {
				if (err?.name === 'AbortError') return
				if (!mounted) return
				setError(rpcErrorMessage(err, '无法获取 Milky 状态'))
			} finally {
				if (mounted) setLoading(false)
			}
		}

		void bootstrap()

		const off = sse.ns('Milky').on((msg) => {
			const payload = msg.payload as Snapshot | undefined
			if (payload?.overview) {
				setSnapshot(payload)
				setOverview(payload.overview)
				setLoading(false)
			}
		}, ['cursor', 'ready'])

		return () => {
			mounted = false
			off()
			sse.close()
		}
	}, [sse])

	const refresh = async () => {
		setLoading(true)
		try {
			const snap = await rpc().snapshot()
			setSnapshot(snap)
			setOverview(snap.overview)
			setError(null)
		} catch (err: any) {
			if (err?.name === 'AbortError') return
			setError(rpcErrorMessage(err, '无法获取 Milky 状态'))
		} finally {
			setLoading(false)
		}
	}

	return { snapshot, overview, error, loading, setError, refresh }
}

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
	const [transport, setTransport] = useState<MilkyEventTransport>(bot.transport as MilkyEventTransport)
	const [accessToken, setAccessToken] = useState('')

	useEffect(() => {
		setName(bot.name ?? '')
		setBaseUrl(bot.baseUrl)
		setTransport(bot.transport as MilkyEventTransport)
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
								{bot.transport.toUpperCase()}
							</Badge>
							<Text fw={700}>
								{bot.name ?? bot.nickname ?? (String(bot.selfId ?? '') || bot.baseUrl)}
							</Text>
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
							<Table.Td>{formatTime(bot.lastEventAt)}</Table.Td>
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
							<Select
								label="事件连接方式"
								value={transport}
								onChange={(v) => setTransport((v as MilkyEventTransport) ?? 'sse')}
								data={[
									{ value: 'sse', label: 'SSE' },
									{ value: 'ws', label: 'WebSocket' },
								]}
							/>
							<TextInput
								label="Access Token（留空表示不改）"
								value={accessToken}
								onChange={(e) => setAccessToken(e.currentTarget.value)}
								placeholder="Bearer token（只填写 token）"
							/>
							<Group justify="flex-end">
								<Button
									size="sm"
									variant="filled"
									loading={updatingId === bot.id}
									onClick={() =>
										onUpdate(bot, {
											name,
											baseUrl,
											transport,
											...(accessToken ? { accessToken } : {}),
										})
									}
								>
									保存
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
	const { snapshot, overview, error, loading, setError, refresh } = useMilkySnapshot()
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [updatingId, setUpdatingId] = useState<string | null>(null)
	const [creating, setCreating] = useState(false)

	const [newName, setNewName] = useState('')
	const [newBaseUrl, setNewBaseUrl] = useState('')
	const [newToken, setNewToken] = useState('')
	const [newTransport, setNewTransport] = useState<MilkyEventTransport>('sse')

	const bots = snapshot?.bots ?? []

	const onConnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc().connectBot(bot.id)
			setError(null)
		} catch (err: any) {
			setError(rpcErrorMessage(err, '连接失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const onDisconnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc().disconnectBot(bot.id)
			setError(null)
		} catch (err: any) {
			setError(rpcErrorMessage(err, '断开失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const onDelete = async (bot: BotStatus) => {
		setDeletingId(bot.id)
		try {
			await rpc().deleteBot(bot.id)
			setError(null)
		} catch (err: any) {
			setError(rpcErrorMessage(err, '删除失败'))
		} finally {
			setDeletingId(null)
		}
	}

	const onUpdate = async (bot: BotStatus, patch: UpdateBotInput) => {
		setUpdatingId(bot.id)
		try {
			await rpc().updateBot(bot.id, patch)
			setError(null)
		} catch (err: any) {
			setError(rpcErrorMessage(err, '更新失败'))
		} finally {
			setUpdatingId(null)
		}
	}

	const onCreate = async () => {
		setCreating(true)
		try {
			await rpc().createBot({
				name: newName || undefined,
				baseUrl: newBaseUrl,
				accessToken: newToken || undefined,
				transport: newTransport,
			})
			setNewName('')
			setNewBaseUrl('')
			setNewToken('')
			setNewTransport('sse')
			setError(null)
			await refresh()
		} catch (err: any) {
			setError(rpcErrorMessage(err, '创建失败'))
		} finally {
			setCreating(false)
		}
	}

	return (
		<Stack gap="md">
			<Group justify="space-between" align="center">
				<Group gap="sm" align="center">
					<IconRobotFace />
					<Text fw={700}>Milky</Text>
					{overview ? (
						<Text c="dimmed" size="sm">
							{overview.activeBots}/{overview.totalBots} 运行
						</Text>
					) : null}
				</Group>
				<Group gap="xs">
					<Button
						size="sm"
						variant="light"
						leftSection={<IconRefresh size={14} />}
						loading={loading}
						onClick={() => refresh()}
					>
						刷新
					</Button>
				</Group>
			</Group>

			{error ? (
				<Alert color="red" withCloseButton onClose={() => setError(null)}>
					{error}
				</Alert>
			) : null}

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
						<Select
							label="事件连接方式"
							value={newTransport}
							onChange={(v) => setNewTransport((v as MilkyEventTransport) ?? 'sse')}
							data={[
								{ value: 'sse', label: 'SSE' },
								{ value: 'ws', label: 'WebSocket' },
							]}
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
							onClick={() => onCreate()}
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

function ManageTab(_props: { ctx: PluginExtensionContext }) {
	return <MainPanel />
}

function SummaryPanel(_props: { ctx: PluginExtensionContext }) {
	return (
		<Stack gap="sm">
			<HeaderIndicator />
		</Stack>
	)
}

const module = definePluginUIModule({
	extensions: [
		{
			point: 'plugin:tabs',
			id: 'milky-tab-manage',
			priority: 12,
			meta: { label: '管理' },
			when: (ctx) => ctx.pluginName === 'Milky',
			Component: ManageTab,
		},
		{
			point: 'plugin:info',
			id: 'milky-info',
			priority: 10,
			requireRunning: false,
			when: (ctx) => ctx.pluginName === 'Milky',
			Component: SummaryPanel,
		},
	],
	setup() {
		console.log('[Milky] status UI loaded')
	},
})

export const { extensions, setup } = module
export default module
