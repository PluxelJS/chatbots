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
	type GlobalExtensionContext,
	type PluginExtensionContext,
	hmrWebClient,
} from '@pluxel/hmr/web'
import type { TelegramSnapshot } from '../telegram'
import type { CreateBotInput, UpdateBotInput } from '../runtime/bot-registry'

type Snapshot = TelegramSnapshot
type BotStatus = Snapshot['bots'][number]
type Overview = Snapshot['overview']
type BotMode = BotStatus['mode']

type RpcClient = {
	snapshot: () => Promise<Snapshot>
	connectBot: (id: string) => Promise<unknown>
	disconnectBot: (id: string) => Promise<unknown>
	deleteBot: (id: string) => Promise<unknown>
	updateBot: (id: string, patch: UpdateBotInput) => Promise<unknown>
	createBot: (input: CreateBotInput) => Promise<{ id: string }>
}

const rpc = (): RpcClient => (hmrWebClient.rpc as any).Telegram as RpcClient

const stateColors: Record<string, string> = {
	polling: 'teal',
	webhook: 'grape',
	api: 'gray',
	authenticating: 'yellow',
	initializing: 'yellow',
	error: 'red',
	stopped: 'gray',
}

const stateLabels: Partial<Record<string, string>> = {
	polling: '轮询',
	webhook: 'Webhook',
	api: '仅 API',
	authenticating: '鉴权中',
	initializing: '初始化',
	error: '异常',
	stopped: '停止',
}

const formatTime = (value?: number) => (value ? new Date(value).toLocaleTimeString() : '—')
const useTelegramSse = () => {
	const sse = useMemo(() => hmrWebClient.createSse({ namespaces: ['Telegram'] }), [])
	return sse
}

function useTelegramSnapshot() {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [overview, setOverview] = useState<Overview | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const sse = useTelegramSse()

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
				setError(rpcErrorMessage(err, '无法获取 Telegram 状态'))
			} finally {
				if (mounted) setLoading(false)
			}
		}
		void bootstrap()

		const off = sse.ns('Telegram').on((msg) => {
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
			setError(rpcErrorMessage(err, '无法获取 Telegram 状态'))
		} finally {
			setLoading(false)
		}
	}

	return { snapshot, overview, error, loading, setError, refresh }
}

function HeaderIndicator({ ctx }: { ctx: GlobalExtensionContext }) {
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
	onUpdate: (bot: BotStatus, patch: Partial<Pick<BotStatus, 'mode' | 'webhookUrl' | 'webhookSecretToken'>>) => Promise<void>
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
							label="Webhook Secret"
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
				<Group gap="lg" wrap="wrap" align="center">
					<Group gap="xs">
						<Text size="xs" c="dimmed">
							Webhook:
						</Text>
						<Text size="sm" truncate="end">
							{bot.webhookUrl ?? '—'}
						</Text>
						<Badge size="sm" variant="dot" color={bot.webhookSecretToken ? 'teal' : 'gray'}>
							Secret {bot.webhookSecretToken ? '已配置' : '未设'}
						</Badge>
					</Group>
					<Group gap="xs">
						<Text size="xs" c="dimmed">
							Token:
						</Text>
						<Text size="sm">{bot.tokenPreview}</Text>
					</Group>
					<Group gap="xs">
						<Text size="xs" c="dimmed">
							更新 {formatTime(bot.lastUpdateAt)}
						</Text>
						<Text size="xs" c="dimmed">
							Offset {bot.pollingOffset ?? '—'}
						</Text>
					</Group>
					{bot.lastError ? (
						<Text size="xs" c="red" lineClamp={2}>
							{bot.lastError}
						</Text>
					) : null}
				</Group>
			</Stack>
		</Card>
	)
}

function AddBotForm({ onCreate }: { onCreate: (input: Parameters<RpcClient['createBot']>[0]) => Promise<void> }) {
	const [token, setToken] = useState('')
	const [mode, setMode] = useState<BotMode>('polling')
	const [webhookUrl, setWebhookUrl] = useState('')
	const [secret, setSecret] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleSubmit = async () => {
		setError(null)
		if (!token.trim()) {
			setError('请输入 token')
			return
		}
		setSubmitting(true)
		try {
			await onCreate({
				token: token.trim(),
				mode,
				webhookUrl: webhookUrl.trim() || undefined,
				webhookSecretToken: secret.trim() || undefined,
			})
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
					<Text fw={700}>新增 Telegram Bot（加密存储 token）</Text>
				</Group>
				{error && (
					<Alert color="red" radius="md">
						{error}
					</Alert>
				)}
				<Group align="flex-end">
					<TextInput
						label="Token"
						placeholder="123:ABC..."
						value={token}
						onChange={(e) => setToken(e.currentTarget.value)}
						style={{ flex: 1 }}
					/>
					<Select
						label="连接模式"
						value={mode}
						data={[
							{ value: 'polling', label: 'polling' },
							{ value: 'webhook', label: 'webhook' },
							{ value: 'api', label: 'api' },
						]}
						onChange={(v) => setMode((v as BotMode) || 'polling')}
						w={180}
					/>
					<Button onClick={handleSubmit} loading={submitting} disabled={!token.trim()}>
						保存
					</Button>
				</Group>
				<Collapse in={mode === 'webhook'}>
					<Stack gap="xs">
						<TextInput
							label="Webhook URL"
							value={webhookUrl}
							onChange={(e) => setWebhookUrl(e.currentTarget.value)}
							placeholder="https://example.com/telegram/webhook"
						/>
						<TextInput
							label="Webhook Secret (可选)"
							value={secret}
							onChange={(e) => setSecret(e.currentTarget.value)}
						/>
					</Stack>
				</Collapse>
				<Text size="xs" c="dimmed">
					仅需 token，默认自动连接；模式/连接方式随时可在列表中修改。token 仅加密存储。
				</Text>
			</Stack>
		</Card>
	)
}

function StatusPanel({ ctx }: { ctx: PluginExtensionContext }) {
	const { snapshot, loading, error, setError, refresh } = useTelegramSnapshot()
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [updatingId, setUpdatingId] = useState<string | null>(null)

	const bots = snapshot?.bots ?? []
	const overview = snapshot?.overview

	const handleConnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc().connectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '连接失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const handleDisconnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc().disconnectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '断开失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const handleDelete = async (bot: BotStatus) => {
		setDeletingId(bot.id)
		try {
			await rpc().deleteBot(bot.id)
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
			await rpc().updateBot(bot.id, patch)
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
				const name = s.displayName ?? s.username ?? s.tokenPreview
				const hint = s.lastError ?? s.stateMessage ?? '等待事件'
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
						<Badge size="sm" variant="light" color={stateColors[s.state] ?? 'gray'}>
							{stateLabels[s.state] ?? s.state} / {s.mode}
						</Badge>
					),
					update: (
						<Stack gap={0}>
							<Text size="xs">{formatTime(s.lastUpdateAt)}</Text>
							<Text size="xs" c="dimmed" lineClamp={1}>
								Offset {s.pollingOffset ?? '—'}
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
							<IconRobotFace size={16} />
							<Text fw={700}>{ctx.pluginName} Bot 状态</Text>
						</Group>
						<Button
							variant="light"
							size="compact-sm"
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
							: '正在读取 Telegram Bot 信息'}
					</Text>
					{error && (
						<Alert color="red" radius="md" title="Telegram RPC 错误">
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
										<Table.Th>最近更新</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{rows.map((r) => (
										<Table.Tr key={r.key}>
											<Table.Td>{r.name}</Table.Td>
											<Table.Td>{r.state}</Table.Td>
											<Table.Td>{r.update}</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						) : (
							!loading && (
								<Text size="sm" c="dimmed">
									还没有运行中的 Telegram Bot。
								</Text>
							)
						)}
					</Stack>
				</Stack>
			</Paper>
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

function SummaryPanel({ ctx }: { ctx: PluginExtensionContext }) {
	const { snapshot, loading, error, refresh } = useTelegramSnapshot()
	const bots = (snapshot?.bots ?? []).slice(0, 3)
	const overview = snapshot?.overview

	return (
		<Paper withBorder radius="md" p="md">
			<Stack gap="sm">
				<Group justify="space-between">
						<Group gap="xs">
							<IconRobotFace size={16} />
							<Text fw={700}>{ctx.pluginName} 概览</Text>
						</Group>
						<Button
							variant="light"
							size="compact-sm"
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
						: '同步中...'}
				</Text>
				{error && (
					<Alert color="red" radius="md" title="Telegram 状态异常">
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

function ManageTab({ ctx }: { ctx: PluginExtensionContext }) {
	return (
		<Stack gap="md">
			<AddBotForm
				onCreate={async (input) => {
					const created = await rpc().createBot(input)
					await rpc().connectBot(created.id).catch(() => {})
				}}
			/>
			<StatusPanel ctx={ctx} />
		</Stack>
	)
}

const module = definePluginUIModule({
	extensions: [
		{
			point: 'plugin:tabs',
			id: 'telegram-tab-manage',
			priority: 10,
			meta: { label: '管理' },
			when: (ctx) => ctx.pluginName === 'Telegram',
			Component: ManageTab,
		},
		{
			point: 'plugin:info',
			id: 'telegram-summary',
			priority: 12,
			requireRunning: false,
			when: (ctx) => ctx.pluginName === 'Telegram',
			Component: SummaryPanel,
		},
	],
	setup() {
		console.log('[Telegram] status UI loaded')
	},
})

export const { extensions, setup } = module
export default module
