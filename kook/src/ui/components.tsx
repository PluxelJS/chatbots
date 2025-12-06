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
import { IconPlugConnected, IconRefresh, IconRobot, IconRocket, IconTrash } from '@tabler/icons-react'
import { rpc, rpcErrorMessage } from '@pluxel/hmr/web'
import type { ExtensionContext } from '@pluxel/hmr/web'
import type { BotMode, BotStatus, Overview, Snapshot } from './types'
import { useKookSse, useKookSnapshot } from './hooks'

const statusColors: Record<string, string> = {
	online: 'teal',
	weak: 'grape',
	handshaking: 'violet',
	connecting: 'yellow',
	resuming: 'indigo',
	backoff: 'orange',
	fetching_profile: 'gray',
	registering_gateway: 'gray',
	stopped: 'gray',
	error: 'red',
}

const statusLabels: Partial<Record<string, string>> = {
	online: '已连接',
	weak: '弱连接',
	handshaking: '握手中',
	connecting: '连接中',
	resuming: '恢复会话',
	backoff: '退避重试',
	fetching_profile: '准备中',
	registering_gateway: '等待网关',
	stopped: '已停止',
	error: '异常',
}

export const humanState = (state: BotStatus['state']) => statusLabels[state] ?? state
export const formatTime = (value?: number) => (value ? new Date(value).toLocaleTimeString() : '—')
const modeColors: Record<BotMode, string> = { gateway: 'indigo', webhook: 'grape', api: 'gray' }

export function HeaderIndicator({ ctx }: { ctx: ExtensionContext }) {
	const [overview, setOverview] = useState<Overview | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const sse = useKookSse()

	useEffect(() => {
		let mounted = true
		const bootstrap = async () => {
			setLoading(true)
			try {
				const snapshot = await rpc().KOOK.snapshot()
				if (!mounted) return
				setOverview(snapshot.overview)
				setError(null)
			} catch (err) {
				if (!mounted) return
				setError(rpcErrorMessage(err, '无法获取 KOOK Bot 状态'))
			} finally {
				if (mounted) setLoading(false)
			}
		}
		void bootstrap()

		const off = sse.KOOK.on((msg) => {
			const payload = msg.payload as Snapshot | undefined
			if (payload?.overview) {
				setOverview(payload.overview)
				setLoading(false)
			}
		}, ['cursor'])

		return () => {
			mounted = false
			off()
			sse.close()
		}
	}, [sse])

	const configured = overview?.configuredBots ?? 0
	const total = overview?.totalBots ?? configured
	const online = overview?.activeBots ?? 0
	const color =
		error ? 'red' : online > 0 ? 'teal' : total > 0 ? 'yellow' : configured > 0 ? 'gray' : 'blue'
	const label = error ? error : `${online}/${total || configured} 连接`

	return (
		<Tooltip label={error ?? `${ctx.pluginName} 状态监控`}>
			<Badge
				variant="light"
				color={color}
				size="sm"
				leftSection={loading ? <Loader size={12} /> : <IconPlugConnected size={12} />}
			>
				KOOK · {label}
			</Badge>
		</Tooltip>
	)
}

export function BotCard({
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
	onUpdate: (bot: BotStatus, patch: Partial<Pick<BotStatus, 'mode' | 'verifyToken'>>) => Promise<void>
	loadingId: string | null
	deletingId: string | null
	updatingId: string | null
}) {
	const busy = loadingId === bot.id
	const [editing, setEditing] = useState(false)
	const [mode, setMode] = useState<BotMode>(bot.mode)
	const [verifyToken, setVerifyToken] = useState(bot.verifyToken ?? '')

	useEffect(() => {
		setMode(bot.mode)
		setVerifyToken(bot.verifyToken ?? '')
	}, [bot])
	return (
		<Card withBorder radius="md" p="md">
			<Stack gap="sm">
				<Group justify="space-between" align="center">
					<Stack gap={4}>
						<Group gap="xs" align="center" wrap="wrap">
							<Badge size="sm" variant="filled" color={statusColors[bot.state] ?? 'gray'}>
								{humanState(bot.state)}
							</Badge>
							<Badge size="sm" variant="filled" color={modeColors[bot.mode] ?? 'gray'}>
								{bot.mode === 'gateway' ? 'Gateway' : bot.mode === 'webhook' ? 'Webhook' : 'API'}
							</Badge>
							<Text fw={700}>{bot.displayName ?? bot.username ?? bot.tokenPreview}</Text>
						</Group>
						<Text size="xs" c={bot.lastError ? 'red' : 'dimmed'} lineClamp={1}>
							{bot.lastError ?? bot.stateMessage ?? '等待网关反馈'}
						</Text>
					</Stack>
					<Group gap="xs" wrap="wrap" justify="flex-end">
						<Button
							size="sm"
							variant="filled"
							color="teal"
							loading={busy && bot.state !== 'stopped'}
							onClick={() => onConnect(bot)}
							disabled={busy || bot.state === 'online'}
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
								{ value: 'gateway', label: 'gateway' },
								{ value: 'webhook', label: 'webhook' },
								{ value: 'api', label: 'api' },
							]}
						/>
						<TextInput
							label="Verify Token (webhook)"
							value={verifyToken}
							onChange={(e) => setVerifyToken(e.currentTarget.value)}
							disabled={mode !== 'webhook'}
						/>
						<Group justify="flex-end">
							<Button
								size="compact-xs"
								loading={updatingId === bot.id}
								onClick={() =>
									onUpdate(bot, {
										mode,
										verifyToken: verifyToken.trim() || undefined,
									})
								}
							>
								保存配置
							</Button>
						</Group>
					</Stack>
				</Collapse>
				<Group gap="lg" wrap="wrap" align="center">
					{bot.mode === 'gateway' ? (
						<Group gap="xs">
							<Text size="xs" c="dimmed">
								Gateway:
							</Text>
							<Text size="sm">{bot.gateway?.state ?? '—'}</Text>
							<Text size="xs" c="dimmed">
								Session {bot.gateway?.sessionId ?? '—'}
							</Text>
						</Group>
					) : null}
					{bot.mode === 'webhook' ? (
						<Group gap="xs">
							<Text size="xs" c="dimmed">
								Verify:
							</Text>
							<Text size="sm">{bot.verifyToken ?? '未配置'}</Text>
						</Group>
					) : null}
					<Group gap="xs">
						<Text size="xs" c="dimmed">
							Token:
						</Text>
						<Text size="sm">{bot.tokenPreview}</Text>
					</Group>
					<Group gap="xs">
						<Text size="xs" c="dimmed">
							事件 {formatTime(bot.lastEventAt)}
						</Text>
						<Text size="xs" c="dimmed">
							SN {bot.lastSequence ?? '—'}
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

export function AddBotForm({ onCreate }: { onCreate: (input: Parameters<ReturnType<typeof rpc>['KOOK']['createBot']>[0]) => Promise<void> }) {
	const [token, setToken] = useState('')
	const [mode, setMode] = useState<BotMode>('gateway')
	const [verifyToken, setVerifyToken] = useState('')
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
				verifyToken: verifyToken.trim() || undefined,
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
					<Text fw={700}>新增 KOOK Bot（加密存储 token）</Text>
				</Group>
				{error && (
					<Alert color="red" radius="md">
						{error}
					</Alert>
				)}
				<Group align="flex-end">
					<TextInput
						label="Token"
						placeholder="Bot xxxxx"
						value={token}
						onChange={(e) => setToken(e.currentTarget.value)}
						style={{ flex: 1 }}
					/>
					<Select
						label="连接模式"
						value={mode}
						data={[
							{ value: 'gateway', label: 'gateway' },
							{ value: 'webhook', label: 'webhook' },
							{ value: 'api', label: 'api' },
						]}
						onChange={(v) => setMode((v as BotMode) || 'gateway')}
						w={160}
					/>
					<Button onClick={handleSubmit} loading={submitting} disabled={!token.trim()}>
						保存
					</Button>
				</Group>
				<Collapse in={mode === 'webhook'}>
					<TextInput
						label="Verify Token (webhook)"
						value={verifyToken}
						onChange={(e) => setVerifyToken(e.currentTarget.value)}
					/>
				</Collapse>
				<Text size="xs" c="dimmed">
					仅需 token，模式与 verify token 可在列表中修改；仅保存加密后的 token。
				</Text>
			</Stack>
		</Card>
	)
}

export function SummaryPanel({ ctx }: { ctx: ExtensionContext }) {
	const { snapshot, loading, error, refresh } = useKookSnapshot()
	const bots = (snapshot?.bots ?? []).slice(0, 3)
	const overview = snapshot?.overview

	return (
		<Paper withBorder radius="md" p="md">
			<Stack gap="sm">
				<Group justify="space-between">
					<Group gap="xs">
						<IconRobot size={16} />
						<Text fw={700}>{ctx.pluginName} 概览</Text>
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

export function StatusPanel({ ctx }: { ctx: ExtensionContext }) {
	const { snapshot, loading, error, refresh, setError } = useKookSnapshot()
	const [loadingId, setLoadingId] = useState<string | null>(null)
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [updatingId, setUpdatingId] = useState<string | null>(null)

	const bots = snapshot?.bots ?? []
	const overview = snapshot?.overview

	const handleCreate = async (input: Parameters<ReturnType<typeof rpc>['KOOK']['createBot']>[0]) => {
		const created = await rpc().KOOK.createBot(input)
		await rpc().KOOK.connectBot(created.id).catch(() => {})
		await refresh()
	}

	const handleConnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc().KOOK.connectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '连接失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const handleDisconnect = async (bot: BotStatus) => {
		setLoadingId(bot.id)
		try {
			await rpc().KOOK.disconnectBot(bot.id)
		} catch (err) {
			setError(rpcErrorMessage(err, '断开失败'))
		} finally {
			setLoadingId(null)
		}
	}

	const handleDelete = async (bot: BotStatus) => {
		setDeletingId(bot.id)
		try {
			await rpc().KOOK.deleteBot(bot.id)
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
			await rpc().KOOK.updateBot(bot.id, patch)
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
							<Text fw={700}>{ctx.pluginName} Bot 状态</Text>
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
