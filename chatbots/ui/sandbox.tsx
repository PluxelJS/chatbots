import Chat, {
	Bubble,
	List,
	ListItem,
	QuickReplies,
	SystemMessage,
	Tag,
	Text as ChatText,
} from '@chatui/core/es'
import type { MessageProps, QuickReplyItemProps } from '@chatui/core'
import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Collapse,
	Divider,
	Group,
	Paper,
	ScrollArea,
	Select,
	Stack,
	Switch,
	Tabs,
	Text,
	TextInput,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconMessage2, IconPlus, IconTrash } from '@tabler/icons-react'
import { hmrWebClient, rpcErrorMessage } from '@pluxel/hmr/web'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Part } from '@pluxel/bot-layer'
import { normalizeMessageContent } from '@pluxel/parts'
import {
	PartsMessage,
	PartsShowcasePanel,
	quickReplies,
	sampleInputs,
	sampleSections,
} from '@pluxel/parts/ui-chatui'
import { PageHeader } from './components'
import { useChatUiColorScheme } from './styles'

import type {
	SandboxCommand,
	SandboxCommandsSnapshot,
	SandboxEvent,
	SandboxMessage,
	SandboxPart,
	SandboxSendInput,
	SandboxSnapshot,
} from '../sandbox-types'

// ─────────────────────────────────────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────────────────────────────────────

type RpcClient = {
	snapshot: () => Promise<SandboxSnapshot>
	reset: () => Promise<SandboxSnapshot>
	commands: () => Promise<SandboxCommandsSnapshot>
	send: (input: SandboxSendInput) => Promise<{ messages: SandboxMessage[] }>
}

type SandboxSession = {
	id: string
	label: string
	platform: string
	userId: string
	channelId: string
	draft: string
}

const rpc = (): RpcClient => (hmrWebClient.rpc as any).chatbots as RpcClient

const PLATFORM_OPTIONS = [
	{ value: 'kook', label: 'KOOK' },
	{ value: 'telegram', label: 'Telegram' },
]

const IDENTITY_PRESETS = [
	{ value: 'sandbox', label: 'Sandbox User', userId: 'sandbox-user' },
	{ value: 'member', label: 'Member (id: 1)', userId: '1' },
	{ value: 'admin', label: 'Admin (id: 2)', userId: '2' },
	{ value: 'custom', label: 'Custom', userId: '' },
]

const DEFAULT_SESSION: SandboxSession = {
	id: 'session-1',
	label: 'Default',
	platform: PLATFORM_OPTIONS[0].value,
	userId: 'sandbox-user',
	channelId: 'sandbox-channel',
	draft: '',
}

const SESSION_STORAGE_KEY = 'chatbots.sandbox.sessions.v1'

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const sanitizeSession = (input: any): SandboxSession | null => {
	if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !input.id) return null
	return {
		id: input.id,
		label: typeof input.label === 'string' && input.label ? input.label : 'Session',
		platform: typeof input.platform === 'string' ? input.platform : PLATFORM_OPTIONS[0].value,
		userId: typeof input.userId === 'string' ? input.userId : 'sandbox-user',
		channelId: typeof input.channelId === 'string' ? input.channelId : 'sandbox-channel',
		draft: typeof input.draft === 'string' ? input.draft : '',
	}
}

const extractSessionSeq = (id: string) => {
	const match = id.match(/session-(\d+)/)
	return match ? Number(match[1]) || 0 : 0
}

const toKey = (value: string | number | null | undefined) =>
	value == null ? null : String(value)

const coerceId = (value: string | null | undefined) => {
	const trimmed = value?.trim()
	if (!trimmed) return undefined
	const num = Number(trimmed)
	return Number.isNaN(num) ? trimmed : num
}

const serializeBinary = (data: Uint8Array | ArrayBufferLike): string => {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
	return btoa(String.fromCharCode(...bytes))
}

const decodeBinary = (value: unknown): Uint8Array | undefined => {
	if (!value) return undefined
	if (value instanceof Uint8Array) return value
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
	}
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (Array.isArray(value)) return Uint8Array.from(value)
	if (typeof value === 'string') {
		const binary = atob(value)
		return Uint8Array.from(binary, (c) => c.charCodeAt(0))
	}
	return undefined
}

const serializeParts = (parts: Part[]): SandboxPart[] =>
	parts.map((part) => {
		if ((part.type === 'image' || part.type === 'file') && part.data) {
			return { ...part, data: serializeBinary(part.data) }
		}
		return part
	})

const deserializeParts = (parts: SandboxPart[]): Part[] =>
	parts.map((part) => {
		if ((part.type === 'image' || part.type === 'file') && part.data) {
			const decoded = decodeBinary(part.data)
			if (decoded) return { ...part, data: decoded }
		}
		return part as Part
	})

const mergeMessages = (prev: SandboxMessage[], incoming: SandboxMessage[]) => {
	if (!incoming.length) return prev
	const byId = new Map(prev.map((m) => [m.id, m]))
	for (const m of incoming) byId.set(m.id, m)
	return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}

const toChatUiMessage = (msg: SandboxMessage): MessageProps & { _id: string } => {
	if (msg.role === 'system') {
		return { _id: msg.id, type: 'system', position: 'center', content: { text: msg.text } }
	}
	return {
		_id: msg.id,
		type: 'parts',
		position: msg.role === 'user' ? 'right' : 'left',
		user: { name: msg.role === 'user' ? 'You' : 'Chatbots' },
		content: { parts: deserializeParts(msg.parts) },
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Hooks
// ─────────────────────────────────────────────────────────────────────────────

function useSandboxSessions() {
	const [sessions, setSessions] = useState<SandboxSession[]>([DEFAULT_SESSION])
	const [activeId, setActiveId] = useState(DEFAULT_SESSION.id)
	const seq = useRef(1)
	const hydrated = useRef(false)

	useEffect(() => {
		if (typeof window === 'undefined') return
		const stored = window.localStorage.getItem(SESSION_STORAGE_KEY)
		if (!stored) {
			hydrated.current = true
			return
		}
		try {
			const parsed = JSON.parse(stored) as { sessions?: unknown; activeSessionId?: unknown } | null
			const list = Array.isArray(parsed?.sessions)
				? (parsed.sessions.map(sanitizeSession).filter(Boolean) as SandboxSession[])
				: []
			if (list.length) {
				setSessions(list)
				const active =
					typeof parsed?.activeSessionId === 'string' && list.some((s) => s.id === parsed.activeSessionId)
						? parsed.activeSessionId
						: list[0]!.id
				setActiveId(active)
				seq.current = Math.max(1, ...list.map(extractSessionSeq))
			}
		} catch {
			// ignore
		} finally {
			hydrated.current = true
		}
	}, [])

	useEffect(() => {
		if (typeof window === 'undefined' || !hydrated.current) return
		window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessions, activeSessionId: activeId }))
	}, [activeId, sessions])

	const active = useMemo(
		() => sessions.find((s) => s.id === activeId) ?? sessions[0] ?? DEFAULT_SESSION,
		[activeId, sessions],
	)

	const update = useCallback(
		(patch: Partial<SandboxSession>) => {
			setSessions((prev) => prev.map((s) => (s.id === activeId ? { ...s, ...patch } : s)))
		},
		[activeId],
	)

	const create = useCallback(() => {
		seq.current += 1
		const id = `session-${seq.current}`
		const base = active ?? DEFAULT_SESSION
		const newSession: SandboxSession = {
			id,
			label: `Session ${seq.current}`,
			platform: base.platform,
			userId: base.userId,
			channelId: `sandbox-${seq.current}`,
			draft: '',
		}
		setSessions((prev) => [...prev, newSession])
		setActiveId(id)
	}, [active])

	const remove = useCallback(
		(id: string) => {
			setSessions((prev) => {
				if (prev.length <= 1) return prev
				const next = prev.filter((s) => s.id !== id)
				if (id === activeId) setActiveId(next[0]!.id)
				return next
			})
		},
		[activeId],
	)

	return { sessions, active, activeId, setActiveId, update, create, remove }
}

function useSandboxData() {
	const [messages, setMessages] = useState<SandboxMessage[]>([])
	const [commands, setCommands] = useState<SandboxCommand[]>([])
	const [cmdPrefix, setCmdPrefix] = useState('/')
	const [connected, setConnected] = useState(false)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const sse = useMemo(() => hmrWebClient.createSse({ namespaces: ['chatbots'] }), [])

	useEffect(() => {
		let mounted = true
		const bootstrap = async () => {
			const [snapRes, cmdRes] = await Promise.allSettled([rpc().snapshot(), rpc().commands()])
			if (!mounted) return
			if (snapRes.status === 'fulfilled') {
				setMessages(snapRes.value.messages)
			} else {
				setError(rpcErrorMessage(snapRes.reason, 'Failed to load sandbox snapshot'))
			}
			if (cmdRes.status === 'fulfilled') {
				setCommands(cmdRes.value.commands)
				setCmdPrefix(cmdRes.value.prefix || '/')
			} else {
				setError(rpcErrorMessage(cmdRes.reason, 'Failed to load command list'))
			}
			setLoading(false)
		}
		bootstrap()
		return () => {
			mounted = false
		}
	}, [])

	useEffect(() => {
		const offOpen = sse.onOpen(() => setConnected(true))
		const offError = sse.onError(() => setConnected(false))
		const off = sse.ns('chatbots').on(
			(msg: { payload?: SandboxEvent }) => {
				const p = msg.payload
				if (p?.type === 'sync') setMessages(p.messages)
				else if (p?.type === 'append') setMessages((prev) => mergeMessages(prev, p.messages))
			},
			['sync', 'append'],
		)
		return () => {
			offOpen()
			offError()
			off()
			sse.close()
		}
	}, [sse])

	const reset = useCallback(async () => {
		setError(null)
		try {
			const snap = await rpc().reset()
			setMessages(snap.messages)
		} catch (err) {
			setError(rpcErrorMessage(err, 'Failed to reset sandbox'))
		}
	}, [])

	const appendMessages = useCallback((incoming: SandboxMessage[]) => {
		setMessages((prev) => mergeMessages(prev, incoming))
	}, [])

	return { messages, commands, cmdPrefix, connected, loading, error, setError, reset, appendMessages }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

type SessionTabsProps = {
	sessions: SandboxSession[]
	activeId: string
	onChange: (id: string) => void
	onCreate: () => void
	onRemove: (id: string) => void
}

function SessionTabs({ sessions, activeId, onChange, onCreate, onRemove }: SessionTabsProps) {
	const handleChange = useCallback(
		(value: string | null) => {
			if (!value) return
			if (value === '__new__') onCreate()
			else onChange(value)
		},
		[onChange, onCreate],
	)

	return (
		<ScrollArea style={{ flex: 1, minWidth: 0 }} type="auto" scrollbarSize={4}>
			<Tabs value={activeId} onChange={handleChange} variant="outline" radius="md" keepMounted={false}>
				<Tabs.List>
					{sessions.map((s) => (
						<Tabs.Tab key={s.id} value={s.id}>
							<Group gap="xs" wrap="nowrap">
								<Text size="sm">{s.label}</Text>
								{sessions.length > 1 && (
									<ActionIcon
										size="xs"
										variant="subtle"
										color="gray"
										onClick={(e) => {
											e.stopPropagation()
											onRemove(s.id)
										}}
									>
										<IconTrash size={12} />
									</ActionIcon>
								)}
							</Group>
						</Tabs.Tab>
					))}
					<Tabs.Tab value="__new__">
						<IconPlus size={14} />
					</Tabs.Tab>
				</Tabs.List>
			</Tabs>
		</ScrollArea>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ChatbotsSandboxPage() {
	useChatUiColorScheme()

	const isStacked = useMediaQuery('(max-width: 1200px)', undefined, { getInitialValueInEffect: true })
	const session = useSandboxSessions()
	const data = useSandboxData()
	const [showParts, setShowParts] = useState(false)

	const partsCount = useMemo(() => sampleSections.reduce((acc, s) => acc + s.items.length, 0), [])

	const chatMessages = useMemo(() => {
		const channelKey = toKey(session.active?.channelId)
		const platform = session.active?.platform
		return data.messages
			.filter((m) => {
				const channelOk = !channelKey || m.channelId === undefined || toKey(m.channelId) === channelKey
				const platformOk = !platform || m.platform === undefined || m.platform === platform
				return channelOk && platformOk
			})
			.map(toChatUiMessage)
	}, [data.messages, session.active?.channelId, session.active?.platform])

	const sendToSandbox = useCallback(
		async (content: SandboxSendInput['content']) => {
			data.setError(null)
			if (!session.active) return
			try {
				const result = await rpc().send({
					content,
					platform: session.active.platform,
					userId: coerceId(session.active.userId),
					channelId: coerceId(session.active.channelId),
				})
				session.update({ draft: '' })
				if (result?.messages?.length) data.appendMessages(result.messages)
			} catch (err) {
				data.setError(rpcErrorMessage(err, 'Send failed'))
			}
		},
		[data, session],
	)

	const handleSend = useCallback(
		(type: string, value: string) => {
			if (type !== 'text') return
			const text = value.trim()
			if (text) void sendToSandbox(text)
		},
		[sendToSandbox],
	)

	const handleInputChange = useCallback(
		(value: string) => session.update({ draft: value }),
		[session],
	)

	const commandQuery = useMemo(() => {
		const trimmed = (session.active?.draft ?? '').trimStart()
		return trimmed.startsWith(data.cmdPrefix) ? trimmed.slice(data.cmdPrefix.length) : null
	}, [data.cmdPrefix, session.active?.draft])

	const commandSuggestions = useMemo(() => {
		if (commandQuery === null) return []
		const head = commandQuery.split(/\s+/)[0]?.toLowerCase() ?? ''
		return data.commands
			.filter((c) => !head || c.name.toLowerCase().startsWith(head) || c.aliases.some((a) => a.toLowerCase().startsWith(head)))
			.slice(0, 8)
	}, [commandQuery, data.commands])

	const applyCommand = useCallback(
		(cmd: SandboxCommand) => {
			const base = `${data.cmdPrefix}${cmd.name}`
			session.update({ draft: base.endsWith(' ') ? base : `${base} ` })
		},
		[data.cmdPrefix, session],
	)

	const handleQuickReplyClick = useCallback(
		(item: QuickReplyItemProps) => {
			const input = sampleInputs[item.code ?? 'text']
			if (!input) return
			void sendToSandbox(serializeParts(normalizeMessageContent(input)))
		},
		[sendToSandbox],
	)

	const handleUseSample = useCallback(
		(input: unknown) => {
			void sendToSandbox(serializeParts(normalizeMessageContent(input as any)))
		},
		[sendToSandbox],
	)

	const renderMessageContent = useCallback((msg: MessageProps) => {
		if (msg.type === 'system') return <SystemMessage content={msg.content?.text ?? ''} />
		if (msg.type === 'parts') return <PartsMessage parts={msg.content?.parts ?? []} mode="chat" />
		return <Bubble content={msg.content?.text ?? ''} />
	}, [])

	const quickItems = useMemo(
		() => quickReplies.filter((i) => Boolean(sampleInputs[i.code ?? ''])).map((i) => ({ ...i })),
		[],
	)

	const activePreset = useMemo(
		() => IDENTITY_PRESETS.find((p) => p.userId === session.active?.userId)?.value ?? 'custom',
		[session.active?.userId],
	)

	const renderQuickReplies = useCallback(() => {
		if (commandQuery !== null) {
			if (!commandSuggestions.length) {
				return (
					<List bordered variant="buttons">
						<ListItem content={<ChatText>No commands match.</ChatText>} />
					</List>
				)
			}
			return (
				<List bordered variant="buttons">
					{commandSuggestions.map((cmd) => (
						<ListItem
							key={cmd.name}
							onClick={() => applyCommand(cmd)}
							content={
								<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
										<ChatText>{data.cmdPrefix}{cmd.usage || cmd.name}</ChatText>
										{cmd.group && <Tag color="primary">{cmd.group}</Tag>}
									</div>
									{cmd.desc && <ChatText><span style={{ color: '#6b7280' }}>{cmd.desc}</span></ChatText>}
								</div>
							}
						/>
					))}
				</List>
			)
		}
		return <QuickReplies items={quickItems} visible onClick={handleQuickReplyClick} />
	}, [applyCommand, commandQuery, commandSuggestions, data.cmdPrefix, handleQuickReplyClick, quickItems])

	const chatPanel = (
		<Paper withBorder radius="lg" p="sm" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
			<Group justify="space-between" align="center" mb="xs" wrap="nowrap">
				<Group gap="sm" align="center" style={{ flex: 1, minWidth: 0 }}>
					<Text fw={600}>Sessions</Text>
					<SessionTabs
						sessions={session.sessions}
						activeId={session.activeId}
						onChange={session.setActiveId}
						onCreate={session.create}
						onRemove={session.remove}
					/>
				</Group>
				<Badge variant="light" color={data.connected ? 'teal' : 'gray'}>
					{data.connected ? 'Connected' : 'Offline'}
				</Badge>
			</Group>
			<Divider mb="sm" />
			<Box style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
				<Chat
					navbar={{ title: 'Chatbots Sandbox' }}
					messages={chatMessages}
					renderMessageContent={renderMessageContent}
					onSend={handleSend}
					text={session.active?.draft ?? ''}
					onInputChange={handleInputChange}
					placeholder={`Type ${data.cmdPrefix}help or another command`}
					renderQuickReplies={renderQuickReplies}
					wideBreakpoint="900px"
					style={{ height: '100%' }}
				/>
			</Box>
		</Paper>
	)

	const configPanel = (
		<Paper withBorder radius="lg" p="md" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<Stack gap="md">
					<PageHeader
						icon={<IconMessage2 size={20} />}
						title="Chatbots Sandbox"
						subtitle="Simulate command flows and Parts rendering."
						badges={
							<>
								<Badge variant="light" color={data.connected ? 'teal' : 'gray'}>
									{data.connected ? 'SSE Online' : 'SSE Offline'}
								</Badge>
								{data.loading && <Badge variant="light" color="gray">Loading...</Badge>}
							</>
						}
						error={data.error}
						onDismissError={() => data.setError(null)}
					/>

					<Stack gap="xs">
						<Group justify="space-between" align="center">
							<Text fw={600}>Session details</Text>
							{session.active && <Badge variant="light" color="gray">{session.active.label}</Badge>}
						</Group>
						{session.active && <Text size="xs" c="dimmed">ID: {session.active.id}</Text>}
						<TextInput
							label="Session label"
							size="xs"
							value={session.active?.label ?? ''}
							onChange={(e) => session.update({ label: e.currentTarget.value })}
						/>
					</Stack>

					<Divider />

					<Stack gap="xs">
						<Group justify="space-between" align="center">
							<Text fw={600}>Scenario</Text>
							<Badge variant="light" color="grape">{partsCount} Parts</Badge>
						</Group>
						<Select
							label="Target platform"
							size="xs"
							value={session.active?.platform ?? PLATFORM_OPTIONS[0].value}
							data={PLATFORM_OPTIONS}
							onChange={(v) => v && session.update({ platform: v })}
						/>
						<Select
							label="Identity preset"
							size="xs"
							value={activePreset}
							data={IDENTITY_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
							onChange={(v) => {
								const p = IDENTITY_PRESETS.find((i) => i.value === v)
								if (p && p.value !== 'custom') session.update({ userId: p.userId })
							}}
						/>
						<TextInput
							label="User ID"
							size="xs"
							value={session.active?.userId ?? ''}
							onChange={(e) => session.update({ userId: e.currentTarget.value })}
						/>
						<TextInput
							label="Channel ID"
							size="xs"
							value={session.active?.channelId ?? ''}
							onChange={(e) => session.update({ channelId: e.currentTarget.value })}
						/>
						<Text size="xs" c="dimmed">
							Commands use the bot bus. Plain text won't trigger replies unless a command matches.
						</Text>
					</Stack>

					<Divider />

					<Group justify="space-between" align="center">
						<Text fw={600}>Sandbox controls</Text>
						<Button size="xs" variant="light" onClick={data.reset}>
							Reset sandbox
						</Button>
					</Group>

					<Divider />

					<Group justify="space-between" align="center">
						<Text fw={600}>Parts Library</Text>
						<Switch
							size="sm"
							checked={showParts}
							onChange={(e) => setShowParts(e.currentTarget.checked)}
							label={showParts ? 'Shown' : 'Hidden'}
						/>
					</Group>
					<Collapse in={showParts}>
						<PartsShowcasePanel sections={sampleSections} onUseSample={handleUseSample} />
					</Collapse>
				</Stack>
			</ScrollArea>
		</Paper>
	)

	return (
		<Box style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
			{isStacked ? (
				<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
					<Stack gap="lg" pr="xs">
						<Box style={{ minHeight: 520 }}>{chatPanel}</Box>
						<Box style={{ minHeight: 420 }}>{configPanel}</Box>
					</Stack>
				</ScrollArea>
			) : (
				<Box
					style={{
						flex: 1,
						minHeight: 0,
						display: 'grid',
						gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 360px)',
						gap: 16,
						overflow: 'hidden',
					}}
				>
					<Box style={{ minHeight: 0, height: '100%', overflow: 'hidden' }}>{chatPanel}</Box>
					<Box style={{ minHeight: 0, height: '100%', overflow: 'hidden' }}>{configPanel}</Box>
				</Box>
			)}
		</Box>
	)
}
