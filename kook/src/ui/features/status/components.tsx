import { useEffect, useState } from 'react'
import {
	Alert,
	Badge,
	Button,
	Card,
	Collapse,
	Group,
	Loader,
	Select,
	Stack,
	Text,
	TextInput,
	Tooltip,
} from '@mantine/core'
import { IconPlugConnected, IconRocket, IconTrash } from '@tabler/icons-react'
import { rpcErrorMessage } from '@pluxel/hmr/web'
import type { BotMode, BotStatus, Overview, Snapshot } from './types'
import type { CreateBotInput, UpdateBotInput } from '../../../runtime/bot-registry'
import { useKookRuntime } from '../../app/runtime'
import { formatTime, humanState, modeColors, statusColors } from './consts'

export function HeaderIndicator() {
	const { rpc, sse } = useKookRuntime()
	const [overview, setOverview] = useState<Overview | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let mounted = true
		const bootstrap = async () => {
			setLoading(true)
			try {
				const snapshot = await rpc.snapshot()
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

		const off = sse.KOOK.on(
			(msg) => {
				const payload = msg.payload as Snapshot | undefined
				if (payload?.overview) {
					setOverview(payload.overview)
					setLoading(false)
				}
			},
			['cursor'],
		)

		return () => {
			mounted = false
			off()
		}
	}, [rpc, sse])

	const configured = overview?.configuredBots ?? 0
	const total = overview?.totalBots ?? configured
	const online = overview?.activeBots ?? 0
	const color =
		error ? 'red' : online > 0 ? 'teal' : total > 0 ? 'yellow' : configured > 0 ? 'gray' : 'blue'
	const label = error ? error : `${online}/${total || configured} 连接`

	return (
		<Tooltip label={error ?? 'KOOK 状态监控'}>
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

export function AddBotForm({ onCreate }: { onCreate: (input: CreateBotInput) => Promise<void> }) {
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
					<Text fw={700}>新增 KOOK Bot（安全存储 token）</Text>
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
					仅需 token，模式与 verify token 可在列表中修改；token 由内核 Vault 安全存储。
				</Text>
			</Stack>
		</Card>
	)
}
