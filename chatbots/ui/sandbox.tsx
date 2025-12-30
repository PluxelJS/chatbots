import {
	Bubble,
	QuickReplies,
	SystemMessage,
} from '@chatui/core/es'
import type { MessageProps, QuickReplyItemProps } from '@chatui/core'
import {
	ActionIcon,
	Avatar,
	Badge,
	Box,
	Button,
	Checkbox,
	Collapse,
	Combobox,
	Divider,
	Group,
	Kbd,
	Modal,
	MultiSelect,
	Paper,
	ScrollArea,
	Select,
	Stack,
	Switch,
	Tabs,
	Text,
	TextInput,
	Tooltip,
	useCombobox,
} from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { IconCommand, IconPlus, IconSearch, IconTrash, IconX } from '@tabler/icons-react'
import { hmrWebClient, rpcErrorMessage } from '@pluxel/hmr/web'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Part } from '@pluxel/bot-layer/web'
import { normalizeMessageContent } from '@pluxel/bot-layer/web'
import {
	PartsMessage,
	PartsShowcasePanel,
	quickReplies,
	sampleInputs,
	sampleSections,
} from './parts-ui-chatui'
import { useRoles } from './hooks'
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
	mockRoleIds: number[]
	// Mock user info
	userDisplayName: string
	userUsername: string
	userAvatar: string
	userIsBot: boolean
	// Mock channel info
	channelName: string
	channelIsPrivate: boolean
	draft: string
}

const rpc = (): RpcClient => (hmrWebClient.rpc as any).chatbots as RpcClient

const PLATFORM_OPTIONS = [
	{ value: 'sandbox', label: 'Sandbox' },
	{ value: 'kook', label: 'KOOK' },
	{ value: 'telegram', label: 'Telegram' },
]

type PlatformPolicy = {
	format: 'plain' | 'markdown' | 'html'
	supportsMixedMedia: boolean
	supportsQuote: boolean
	supportsImage: boolean
	supportsFile: boolean
	maxCaptionLength?: number
}

const PLATFORM_POLICY: Record<string, PlatformPolicy> = {
	sandbox: {
		format: 'plain',
		supportsMixedMedia: true,
		supportsQuote: true,
		supportsImage: true,
		supportsFile: true,
	},
	kook: {
		format: 'markdown',
		supportsMixedMedia: false,
		supportsQuote: true,
		supportsImage: true,
		supportsFile: true,
	},
	telegram: {
		format: 'html',
		supportsMixedMedia: true,
		supportsQuote: true,
		supportsImage: true,
		supportsFile: true,
		maxCaptionLength: 1024,
	},
}

const IDENTITY_PRESETS = [
	{ value: 'sandbox', label: 'Sandbox User', userId: 'sandbox-user' },
	{ value: 'member', label: 'Member (id: 1)', userId: '1' },
	{ value: 'admin', label: 'Admin (id: 2)', userId: '2' },
	{ value: 'custom', label: 'Custom', userId: '' },
]

// Simple colored avatar placeholder (data URI, PNG to keep Skia-compatible)
const DEFAULT_AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAZElEQVR4nO3PoQ0AIADAMA7kFr5HwxGIhmRivhtz7fNzQwMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ147QK2hB9pnVFyfAAAAABJRU5ErkJggg=='

const DEFAULT_PLATFORM = 'sandbox'

const DEFAULT_SESSION: SandboxSession = {
	id: 'session-1',
	label: 'Default',
	platform: DEFAULT_PLATFORM,
	userId: 'sandbox-user',
	channelId: 'sandbox-channel',
	mockRoleIds: [],
	userDisplayName: 'Sandbox User',
	userUsername: 'sandbox',
	userAvatar: DEFAULT_AVATAR,
	userIsBot: false,
	channelName: 'sandbox-channel',
	channelIsPrivate: false,
	draft: '',
}

const SESSION_STORAGE_KEY = 'chatbots.sandbox.sessions.v1'

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const sanitizeSession = (input: any): SandboxSession | null => {
	if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !input.id) return null
	const userAvatar =
		typeof input.userAvatar === 'string' && input.userAvatar.startsWith('data:image/svg')
			? DEFAULT_AVATAR
			: input.userAvatar
	return {
		id: input.id,
		label: typeof input.label === 'string' && input.label ? input.label : 'Session',
		platform: typeof input.platform === 'string' ? input.platform : DEFAULT_PLATFORM,
		userId: typeof input.userId === 'string' ? input.userId : 'sandbox-user',
		channelId: typeof input.channelId === 'string' ? input.channelId : 'sandbox-channel',
		mockRoleIds: Array.isArray(input.mockRoleIds) ? input.mockRoleIds.filter((v: any) => typeof v === 'number') : [],
		userDisplayName: typeof input.userDisplayName === 'string' ? input.userDisplayName : 'Sandbox User',
		userUsername: typeof input.userUsername === 'string' ? input.userUsername : 'sandbox',
		userAvatar: typeof userAvatar === 'string' ? userAvatar : DEFAULT_AVATAR,
		userIsBot: typeof input.userIsBot === 'boolean' ? input.userIsBot : false,
		channelName: typeof input.channelName === 'string' ? input.channelName : 'sandbox-channel',
		channelIsPrivate: typeof input.channelIsPrivate === 'boolean' ? input.channelIsPrivate : false,
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
			mockRoleIds: [],
			userDisplayName: base.userDisplayName,
			userUsername: base.userUsername,
			userAvatar: base.userAvatar,
			userIsBot: base.userIsBot,
			channelName: `sandbox-${seq.current}`,
			channelIsPrivate: base.channelIsPrivate,
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
// Command Picker - 指令选择器
// ─────────────────────────────────────────────────────────────────────────────

type CommandPickerProps = {
	commands: SandboxCommand[]
	cmdPrefix: string
	opened: boolean
	onClose: () => void
	onSelect: (cmd: SandboxCommand, execute: boolean) => void
}

function CommandPicker({ commands, cmdPrefix, opened, onClose, onSelect }: CommandPickerProps) {
	const [search, setSearch] = useState('')

	const filtered = useMemo(() => {
		const q = search.toLowerCase().trim()
		if (!q) return commands
		return commands.filter(
			(c) =>
				c.name.toLowerCase().includes(q) ||
				c.aliases.some((a) => a.toLowerCase().includes(q)) ||
				c.desc?.toLowerCase().includes(q) ||
				c.group?.toLowerCase().includes(q),
		)
	}, [commands, search])

	const grouped = useMemo(() => {
		const map = new Map<string, SandboxCommand[]>()
		for (const cmd of filtered) {
			const group = cmd.group || 'Other'
			const list = map.get(group) ?? []
			list.push(cmd)
			map.set(group, list)
		}
		return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
	}, [filtered])

	useEffect(() => {
		if (!opened) setSearch('')
	}, [opened])

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={
				<Group gap="xs">
					<IconCommand size={18} />
					<Text fw={600}>Command Browser</Text>
					<Badge size="sm" variant="light" color="gray">
						{commands.length} commands
					</Badge>
				</Group>
			}
			size="lg"
			styles={{ body: { padding: 0 } }}
		>
			<Box p="md" pb={0}>
				<TextInput
					placeholder="Search commands..."
					leftSection={<IconSearch size={16} />}
					value={search}
					onChange={(e) => setSearch(e.currentTarget.value)}
					autoFocus
				/>
			</Box>
			<ScrollArea style={{ height: 400 }} type="auto" offsetScrollbars p="md">
				{grouped.length === 0 ? (
					<Text c="dimmed" ta="center" py="xl">
						No commands match "{search}"
					</Text>
				) : (
					<Stack gap="md">
						{grouped.map(([group, cmds]) => (
							<Box key={group}>
								<Text size="xs" fw={600} c="dimmed" mb="xs" tt="uppercase">
									{group}
								</Text>
								<Stack gap="xs">
									{cmds.map((cmd) => (
										<Paper
											key={cmd.name}
											withBorder
											p="sm"
											style={{ cursor: 'pointer' }}
											onClick={() => onSelect(cmd, false)}
										>
											<Group justify="space-between" align="flex-start" wrap="nowrap">
												<Box style={{ flex: 1, minWidth: 0 }}>
													<Group gap="xs" mb={4}>
														<Text size="sm" fw={600} style={{ fontFamily: 'monospace' }}>
															{cmdPrefix}{cmd.name}
														</Text>
														{cmd.aliases.length > 0 && (
															<Text size="xs" c="dimmed">
																({cmd.aliases.map((a) => cmdPrefix + a).join(', ')})
															</Text>
														)}
													</Group>
													{cmd.usage && cmd.usage !== cmd.name && (
														<Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }} mb={4}>
															{cmdPrefix}{cmd.usage}
														</Text>
													)}
													{cmd.desc && (
														<Text size="xs" c="dimmed">
															{cmd.desc}
														</Text>
													)}
												</Box>
												<Group gap="xs">
													<Tooltip label="Fill input">
														<ActionIcon
															variant="light"
															size="sm"
															onClick={(e) => {
																e.stopPropagation()
																onSelect(cmd, false)
															}}
														>
															<IconCommand size={14} />
														</ActionIcon>
													</Tooltip>
													<Tooltip label="Execute now">
														<ActionIcon
															variant="filled"
															size="sm"
															color="blue"
															onClick={(e) => {
																e.stopPropagation()
																onSelect(cmd, true)
															}}
														>
															<IconPlus size={14} />
														</ActionIcon>
													</Tooltip>
												</Group>
											</Group>
										</Paper>
									))}
								</Stack>
							</Box>
						))}
					</Stack>
				)}
			</ScrollArea>
			<Box p="md" pt={0}>
				<Group justify="center" gap="lg">
					<Text size="xs" c="dimmed">
						<Kbd size="xs">Click</Kbd> to fill input
					</Text>
					<Text size="xs" c="dimmed">
						<Kbd size="xs">Blue button</Kbd> to execute
					</Text>
				</Group>
			</Box>
		</Modal>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Input - 带补全的指令输入
// ─────────────────────────────────────────────────────────────────────────────

type CommandInputProps = {
	value: string
	onChange: (value: string) => void
	onSend: () => void
	commands: SandboxCommand[]
	cmdPrefix: string
	onOpenPicker: () => void
	placeholder?: string
}

function CommandInput({ value, onChange, onSend, commands, cmdPrefix, onOpenPicker, placeholder }: CommandInputProps) {
	const combobox = useCombobox({
		onDropdownClose: () => combobox.resetSelectedOption(),
	})
	const inputRef = useRef<HTMLInputElement>(null)
	const [selectedIndex, setSelectedIndex] = useState(0)

	const trimmed = value.trimStart()
	const isCommand = trimmed.startsWith(cmdPrefix)
	const query = isCommand ? trimmed.slice(cmdPrefix.length).split(/\s+/)[0]?.toLowerCase() ?? '' : null
	const hasArgs = isCommand && trimmed.includes(' ')

	const suggestions = useMemo(() => {
		if (query === null || hasArgs) return []
		if (!query) return commands.slice(0, 10)
		return commands
			.filter((c) => c.name.toLowerCase().startsWith(query) || c.aliases.some((a) => a.toLowerCase().startsWith(query)))
			.slice(0, 8)
	}, [commands, query, hasArgs])

	const showDropdown = suggestions.length > 0

	// Reset selection when suggestions change
	useEffect(() => {
		setSelectedIndex(0)
		if (showDropdown) {
			combobox.openDropdown()
		} else {
			combobox.closeDropdown()
		}
	}, [showDropdown, suggestions.length, combobox])

	const applyCommand = useCallback(
		(cmd: SandboxCommand) => {
			onChange(`${cmdPrefix}${cmd.name} `)
			combobox.closeDropdown()
			setSelectedIndex(0)
			inputRef.current?.focus()
		},
		[cmdPrefix, onChange, combobox],
	)

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (!showDropdown) {
				// No dropdown - Enter sends
				if (e.key === 'Enter') {
					e.preventDefault()
					onSend()
				}
				return
			}

			// Dropdown is open
			if (e.key === 'Tab') {
				// Tab cycles through options
				e.preventDefault()
				e.stopPropagation()
				setSelectedIndex((prev) => (prev + 1) % suggestions.length)
			} else if (e.key === 'Enter') {
				// Enter completes the selected option
				e.preventDefault()
				const selected = suggestions[selectedIndex]
				if (selected) applyCommand(selected)
			} else if (e.key === 'ArrowDown') {
				e.preventDefault()
				setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1))
			} else if (e.key === 'ArrowUp') {
				e.preventDefault()
				setSelectedIndex((prev) => Math.max(prev - 1, 0))
			} else if (e.key === 'Escape') {
				combobox.closeDropdown()
			}
		},
		[showDropdown, suggestions, selectedIndex, applyCommand, onSend, combobox],
	)

	return (
		<Combobox store={combobox} onOptionSubmit={(val) => {
			const cmd = commands.find((c) => c.name === val)
			if (cmd) applyCommand(cmd)
		}}>
			<Combobox.Target>
				<TextInput
					ref={inputRef}
					value={value}
					onChange={(e) => onChange(e.currentTarget.value)}
					onKeyDownCapture={handleKeyDown}
					onFocus={() => showDropdown && combobox.openDropdown()}
					placeholder={placeholder}
					rightSection={
						<Tooltip label="Browse commands">
							<ActionIcon variant="subtle" onClick={onOpenPicker}>
								<IconCommand size={16} />
							</ActionIcon>
						</Tooltip>
					}
					styles={{ input: { fontFamily: isCommand ? 'monospace' : undefined } }}
				/>
			</Combobox.Target>
			<Combobox.Dropdown>
				<Combobox.Options>
					{suggestions.map((cmd, index) => (
						<Combobox.Option
							key={cmd.name}
							value={cmd.name}
							active={index === selectedIndex}
							onMouseEnter={() => setSelectedIndex(index)}
						>
							<Group justify="space-between" wrap="nowrap">
								<Box style={{ flex: 1, minWidth: 0 }}>
									<Group gap="xs">
										<Text size="sm" fw={500} style={{ fontFamily: 'monospace' }}>
											{cmdPrefix}{cmd.name}
										</Text>
										{cmd.group && <Badge size="xs" variant="light">{cmd.group}</Badge>}
									</Group>
									{cmd.desc && (
										<Text size="xs" c="dimmed" lineClamp={1}>
											{cmd.desc}
										</Text>
									)}
								</Box>
							</Group>
						</Combobox.Option>
					))}
				</Combobox.Options>
				<Combobox.Footer>
					<Group justify="center" gap="md">
						<Text size="xs" c="dimmed">
							<Kbd size="xs">Tab</Kbd> cycle
						</Text>
						<Text size="xs" c="dimmed">
							<Kbd size="xs">Enter</Kbd> complete
						</Text>
						<Text size="xs" c="dimmed">
							<Kbd size="xs">↑↓</Kbd> navigate
						</Text>
					</Group>
				</Combobox.Footer>
			</Combobox.Dropdown>
		</Combobox>
	)
}

// ─────────────────────────────────────────────────────────────────────────────
// Image Lightbox - 图片预览
// ─────────────────────────────────────────────────────────────────────────────

type ImageLightboxProps = {
	src: string | null
	onClose: () => void
}

function ImageLightbox({ src, onClose }: ImageLightboxProps) {
	if (!src) return null

	return (
		<Modal
			opened={!!src}
			onClose={onClose}
			size="xl"
			centered
			withCloseButton={false}
			styles={{
				body: { padding: 0, background: 'transparent' },
				content: { background: 'transparent', boxShadow: 'none' },
			}}
			overlayProps={{ backgroundOpacity: 0.85 }}
		>
			<Box style={{ position: 'relative' }}>
				<ActionIcon
					variant="filled"
					color="dark"
					size="lg"
					radius="xl"
					style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
					onClick={onClose}
				>
					<IconX size={18} />
				</ActionIcon>
				<img
					src={src}
					alt="Preview"
					style={{
						display: 'block',
						maxWidth: '90vw',
						maxHeight: '85vh',
						margin: '0 auto',
						borderRadius: 8,
						boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
					}}
					onClick={onClose}
				/>
			</Box>
		</Modal>
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
	const roles = useRoles()
	const [showParts, setShowParts] = useState(false)
	const [pickerOpened, { open: openPicker, close: closePicker }] = useDisclosure(false)
	const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const messageContainerRef = useRef<HTMLDivElement>(null)

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

	// Auto-scroll to bottom when messages change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [chatMessages.length])

	// Image click-to-enlarge via event delegation
	useEffect(() => {
		const container = messageContainerRef.current
		if (!container) return
		const handleClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			if (target.tagName === 'IMG') {
				const img = target as HTMLImageElement
				// Skip small icons/avatars (arbitrary threshold)
				if (img.naturalWidth < 50 && img.naturalHeight < 50) return
				setLightboxSrc(img.src)
			}
		}
		container.addEventListener('click', handleClick)
		return () => container.removeEventListener('click', handleClick)
	}, [])

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
					mockRoleIds: session.active.mockRoleIds.length ? session.active.mockRoleIds : undefined,
					mockUser: {
						displayName: session.active.userDisplayName || undefined,
						username: session.active.userUsername || undefined,
						avatar: session.active.userAvatar || undefined,
						isBot: session.active.userIsBot,
					},
					mockChannel: {
						name: session.active.channelName || undefined,
						isPrivate: session.active.channelIsPrivate,
					},
				})
				session.update({ draft: '' })
				if (result?.messages?.length) data.appendMessages(result.messages)
			} catch (err) {
				data.setError(rpcErrorMessage(err, 'Send failed'))
			}
		},
		[data, session],
	)

	const handleSendText = useCallback(() => {
		const text = (session.active?.draft ?? '').trim()
		if (text) void sendToSandbox(text)
	}, [sendToSandbox, session.active?.draft])

	const handleInputChange = useCallback(
		(value: string) => session.update({ draft: value }),
		[session],
	)

	const handleCommandSelect = useCallback(
		(cmd: SandboxCommand, execute: boolean) => {
			closePicker()
			if (execute) {
				void sendToSandbox(`${data.cmdPrefix}${cmd.name}`)
			} else {
				session.update({ draft: `${data.cmdPrefix}${cmd.name} ` })
			}
		},
		[closePicker, data.cmdPrefix, sendToSandbox, session],
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

	const platformPolicy = useMemo(() => {
		const key = session.active?.platform ?? DEFAULT_PLATFORM
		const policy = PLATFORM_POLICY[key] ?? PLATFORM_POLICY[DEFAULT_PLATFORM]
		const mixed = policy.supportsMixedMedia ? 'on' : 'off'
		const quote = policy.supportsQuote ? 'on' : 'off'
		const image = policy.supportsImage ? 'on' : 'off'
		const file = policy.supportsFile ? 'on' : 'off'
		const caption = typeof policy.maxCaptionLength === 'number' ? String(policy.maxCaptionLength) : 'none'
		const summary = `format: ${policy.format} · mixed-media: ${mixed} · quote: ${quote} · image: ${image} · file: ${file} · caption: ${caption}`
		const detail = policy.supportsMixedMedia
			? 'reply(): keeps image+caption together; splits only when caption exceeds limit.'
			: 'reply(): splits image+caption into multiple messages.'
		return { summary, detail }
	}, [session.active?.platform])

	// Check if currently typing a command (for showing quick replies vs not)
	const isTypingCommand = useMemo(() => {
		const trimmed = (session.active?.draft ?? '').trimStart()
		return trimmed.startsWith(data.cmdPrefix)
	}, [data.cmdPrefix, session.active?.draft])

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

			{/* Messages Area */}
			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<Stack gap="sm" p="xs" ref={messageContainerRef}>
					{chatMessages.length === 0 ? (
						<Text c="dimmed" ta="center" py="xl">
							No messages yet. Type a command to get started.
						</Text>
					) : (
						chatMessages.map((msg) => (
							<Box
								key={msg._id}
								style={{
									display: 'flex',
									justifyContent: msg.position === 'right' ? 'flex-end' : msg.position === 'center' ? 'center' : 'flex-start',
								}}
							>
								<Box style={{ maxWidth: msg.position === 'center' ? '100%' : '80%' }}>
									{renderMessageContent(msg)}
								</Box>
							</Box>
						))
					)}
					<div ref={messagesEndRef} />
				</Stack>
			</ScrollArea>

			{/* Quick Replies (only when not typing a command) */}
			{!isTypingCommand && quickItems.length > 0 && (
				<Box py="xs">
					<QuickReplies items={quickItems} visible onClick={handleQuickReplyClick} />
				</Box>
			)}

			<Divider my="xs" />

			{/* Command Input */}
			<CommandInput
				value={session.active?.draft ?? ''}
				onChange={handleInputChange}
				onSend={handleSendText}
				commands={data.commands}
				cmdPrefix={data.cmdPrefix}
				onOpenPicker={openPicker}
				placeholder={`Type ${data.cmdPrefix}help or browse commands...`}
			/>

			{/* Command Picker Modal */}
			<CommandPicker
				commands={data.commands}
				cmdPrefix={data.cmdPrefix}
				opened={pickerOpened}
				onClose={closePicker}
				onSelect={handleCommandSelect}
			/>

			{/* Image Lightbox */}
			<ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
		</Paper>
	)

	const configPanel = (
		<Paper withBorder radius="lg" p="md" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
			<ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto" offsetScrollbars>
				<Stack gap="sm">
					<Group justify="space-between" align="center">
						<Group gap="xs">
							<Badge variant="light" color={data.connected ? 'teal' : 'gray'}>
								{data.connected ? 'SSE Online' : 'SSE Offline'}
							</Badge>
							{data.loading && <Badge variant="light" color="gray">Loading...</Badge>}
						</Group>
						<Button size="xs" variant="light" onClick={data.reset}>
							Reset
						</Button>
					</Group>

					{data.error && (
						<Paper withBorder radius="sm" p="xs" style={{ background: 'var(--mantine-color-red-0)' }}>
							<Group justify="space-between" align="center" gap="xs" wrap="nowrap">
								<Text size="xs" c="red" style={{ wordBreak: 'break-word' }}>{data.error}</Text>
								<ActionIcon size="xs" variant="subtle" color="red" onClick={() => data.setError(null)}>
									<IconX size={12} />
								</ActionIcon>
							</Group>
						</Paper>
					)}

					<Divider />

					<TextInput
						label="Session label"
						size="xs"
						value={session.active?.label ?? ''}
						onChange={(e) => session.update({ label: e.currentTarget.value })}
					/>
					{session.active && <Text size="xs" c="dimmed">ID: {session.active.id}</Text>}

					<Divider />

					<Select
						label="Target platform"
						size="xs"
						value={session.active?.platform ?? DEFAULT_PLATFORM}
						data={PLATFORM_OPTIONS}
						onChange={(v) => v && session.update({ platform: v })}
					/>
					<Text size="xs" c="dimmed">{platformPolicy.summary}</Text>
					<Text size="xs" c="dimmed">{platformPolicy.detail}</Text>
					<Text size="xs" c="dimmed">{partsCount} Parts samples available.</Text>

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
					<MultiSelect
						label="Mock permission roles"
						size="xs"
						placeholder={roles.loading ? 'Loading roles...' : 'Select roles to mock'}
						data={roles.options}
						value={(session.active?.mockRoleIds ?? []).map(String)}
						onChange={(values) => session.update({ mockRoleIds: values.map(Number) })}
						clearable
						searchable
					/>

					<Divider />

					<Text size="xs" c="dimmed">Mock user</Text>
					<Group align="flex-start" gap="sm">
						<Avatar
							src={session.active?.userAvatar}
							size="md"
							radius="md"
							style={{ border: '2px solid var(--mantine-color-gray-4)' }}
						/>
						<Stack gap="xs" style={{ flex: 1 }}>
							<TextInput
								label="Display Name"
								size="xs"
								value={session.active?.userDisplayName ?? ''}
								onChange={(e) => session.update({ userDisplayName: e.currentTarget.value })}
							/>
							<TextInput
								label="Username"
								size="xs"
								value={session.active?.userUsername ?? ''}
								onChange={(e) => session.update({ userUsername: e.currentTarget.value })}
							/>
						</Stack>
					</Group>
					<TextInput
						label="Avatar URL"
						size="xs"
						placeholder="Leave empty for default"
						value={session.active?.userAvatar === DEFAULT_AVATAR ? '' : (session.active?.userAvatar ?? '')}
						onChange={(e) => session.update({ userAvatar: e.currentTarget.value || DEFAULT_AVATAR })}
					/>
					<Checkbox
						label="Is Bot"
						size="xs"
						checked={session.active?.userIsBot ?? false}
						onChange={(e) => session.update({ userIsBot: e.currentTarget.checked })}
					/>

					<Divider />

					<Text size="xs" c="dimmed">Mock channel</Text>
					<TextInput
						label="Channel Name"
						size="xs"
						value={session.active?.channelName ?? ''}
						onChange={(e) => session.update({ channelName: e.currentTarget.value })}
					/>
					<Checkbox
						label="Private Channel"
						size="xs"
						checked={session.active?.channelIsPrivate ?? false}
						onChange={(e) => session.update({ channelIsPrivate: e.currentTarget.checked })}
					/>
					<Text size="xs" c="dimmed">
						Commands use the bot bus. Plain text won't trigger replies unless a command matches.
					</Text>

					<Divider />

					<Switch
						size="sm"
						checked={showParts}
						onChange={(e) => setShowParts(e.currentTarget.checked)}
						label="Parts samples"
					/>
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
