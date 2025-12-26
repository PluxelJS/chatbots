import { RpcTarget } from '@pluxel/hmr/capnweb'
import { Buffer } from 'node:buffer'
import type { SseChannel } from '@pluxel/hmr/services'
import type { Part } from '@pluxel/bot-layer'
import { getCommandMeta, partsToText, toPartArray } from '@pluxel/bot-layer'

import type { ChatbotsRuntime } from './runtime'
import type {
	SandboxContent,
	SandboxCommandsSnapshot,
	SandboxEvent,
	SandboxMessage,
	SandboxPart,
	SandboxSendInput,
	SandboxSendResult,
	SandboxSnapshot,
} from './sandbox-types'
import type { PermissionService, SubjectType } from '../permissions/service'
import type { GrantRow, RoleRow } from '../permissions/db/schemas'
import type {
	PermissionCatalogNamespace,
	PermissionGrantDto,
	PermissionRoleDto,
} from './permissions-types'

const DEFAULT_PLATFORM = 'kook'
const DEFAULT_USER_ID = 'sandbox-user'
const DEFAULT_CHANNEL_ID = 'sandbox-channel'
const MAX_MESSAGES = 200

const decodeBinary = (value: unknown): Uint8Array | undefined => {
	if (!value) return undefined
	if (value instanceof Uint8Array) return value
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
	}
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (Array.isArray(value)) return Uint8Array.from(value)
	if (typeof value === 'string') {
		return Uint8Array.from(Buffer.from(value, 'base64'))
	}
	return undefined
}

const encodeBinary = (value: Uint8Array) => Buffer.from(value).toString('base64')

const serializeParts = (parts: Part[]): SandboxPart[] =>
	parts.map((part) => {
		if ((part.type === 'image' || part.type === 'file') && part.data) {
			const decoded = decodeBinary(part.data)
			if (decoded) return { ...part, data: encodeBinary(decoded) }
		}
		return part
	})

const normalizeSandboxContent = (content: SandboxContent): Part[] => {
	const parts = toPartArray(content as any)
	return parts.map((part) => {
		if ((part.type === 'image' || part.type === 'file') && part.data) {
			const decoded = decodeBinary(part.data)
			if (decoded && decoded !== part.data) {
				return { ...part, data: decoded }
			}
		}
		return part
	})
}

export class ChatbotsSandbox {
	private readonly subscribers = new Set<SseChannel>()
	private readonly cmdPrefix: string
	private messages: SandboxMessage[] = []
	private seq = 1

	constructor(private readonly runtime: ChatbotsRuntime, options: { cmdPrefix: string }) {
		this.cmdPrefix = options.cmdPrefix.trim() || '/'
		this.reset()
	}

	snapshot(): SandboxSnapshot {
		return { messages: this.messages.map((msg) => ({ ...msg })) }
	}

	reset(): SandboxSnapshot {
		this.messages = []
		this.seq = 1
		this.append('system', [{ type: 'text', text: `Chatbots sandbox ready. Prefix: ${this.cmdPrefix}` }])
		this.emit('sync', { type: 'sync', messages: this.snapshot().messages })
		return this.snapshot()
	}

	commands(): SandboxCommandsSnapshot {
		const list = this.runtime.cmd.list().map((cmd) => {
			const meta = getCommandMeta(cmd)
			return {
				name: cmd.nameTokens.join(' '),
				usage: cmd.toUsage(),
				aliases: [...cmd.aliases],
				desc: meta?.desc,
				group: meta?.group,
			}
		})
		list.sort((a, b) => a.name.localeCompare(b.name))
		return { prefix: this.cmdPrefix, commands: list }
	}

	async send(input: SandboxSendInput): Promise<SandboxSendResult> {
		const platform = input.platform ?? DEFAULT_PLATFORM
		const userId = input.userId ?? DEFAULT_USER_ID
		const channelId = input.channelId ?? DEFAULT_CHANNEL_ID
		const parts = normalizeSandboxContent(input.content)
		if (!parts.length) {
			return { messages: [] }
		}

		const appended: SandboxMessage[] = []
		appended.push(this.append('user', parts, { platform, userId, channelId }))

		const replies = await this.runtime.sandboxDispatch({
			content: parts,
			platform,
			userId,
			channelId,
		})

		for (const reply of replies) {
			if (!reply.length) continue
			appended.push(this.append('bot', reply, { platform, userId, channelId }))
		}

		if (appended.length) {
			this.emit('append', { type: 'append', messages: appended })
		}

		return { messages: appended }
	}

	createSseHandler() {
		return (channel: SseChannel) => {
			const sendSync = () => {
				channel.emit('sync', { type: 'sync', messages: this.snapshot().messages })
			}
			sendSync()
			this.subscribers.add(channel)
			return channel.onAbort(() => {
				this.subscribers.delete(channel)
			})
		}
	}

	private append(
		role: SandboxMessage['role'],
		parts: Part[],
		context: Pick<SandboxSendInput, 'platform' | 'userId' | 'channelId'> = {},
	): SandboxMessage {
		const platform = context.platform ?? DEFAULT_PLATFORM
		const message: SandboxMessage = {
			id: String(this.seq++),
			role,
			parts: serializeParts(parts),
			text: partsToText(parts, platform),
			platform,
			userId: context.userId,
			channelId: context.channelId,
			createdAt: Date.now(),
		}
		this.messages.push(message)
		if (this.messages.length > MAX_MESSAGES) {
			this.messages = this.messages.slice(-MAX_MESSAGES)
		}
		return message
	}

	private emit(type: SandboxEvent['type'], payload: SandboxEvent) {
		for (const channel of this.subscribers) {
			channel.emit(type, payload)
		}
	}
}

export class ChatbotsSandboxRpc extends RpcTarget {
	constructor(
		private readonly sandbox: ChatbotsSandbox,
		private readonly permissions: PermissionService,
	) {
		super()
	}

	snapshot() {
		return this.sandbox.snapshot()
	}

	reset() {
		return this.sandbox.reset()
	}

	commands() {
		return this.sandbox.commands()
	}

	send(input: SandboxSendInput) {
		return this.sandbox.send(input)
	}

	catalog(): PermissionCatalogNamespace[] {
		const namespaces = this.permissions.listNamespaces().sort()
		return namespaces.map((nsKey) => ({
			nsKey,
			permissions: this.permissions.listPermissions(nsKey),
		}))
	}

	async listRoles(): Promise<PermissionRoleDto[]> {
		const rows = await this.permissions.listRoles()
		return rows.map(serializeRole)
	}

	async listRoleGrants(roleId: number): Promise<PermissionGrantDto[]> {
		const rows = await this.permissions.listGrants('role', roleId)
		return rows.map(serializeGrant)
	}

	async listUserRoles(userId: number): Promise<number[]> {
		return await this.permissions.listUserRoleIds(userId)
	}

	async listUserGrants(userId: number): Promise<PermissionGrantDto[]> {
		const rows = await this.permissions.listGrants('user', userId)
		return rows.map(serializeGrant)
	}

	async createRole(parentRoleId: number | null, rank: number): Promise<number> {
		return await this.permissions.createRole(parentRoleId, rank)
	}

	async updateRole(roleId: number, patch: { parentRoleId?: number | null; rank?: number }): Promise<void> {
		await this.permissions.updateRole(roleId, patch)
	}

	async assignRoleToUser(userId: number, roleId: number): Promise<void> {
		await this.permissions.assignRoleToUser(userId, roleId)
	}

	async unassignRoleFromUser(userId: number, roleId: number): Promise<void> {
		await this.permissions.unassignRoleFromUser(userId, roleId)
	}

	async grant(subjectType: SubjectType, subjectId: number, effect: 'allow' | 'deny', node: string): Promise<void> {
		await this.permissions.grant(subjectType, subjectId, effect, node)
	}

	async revoke(subjectType: SubjectType, subjectId: number, node: string): Promise<void> {
		await this.permissions.revoke(subjectType, subjectId, node)
	}
}

const toIso = (value: Date | string) => (typeof value === 'string' ? value : value.toISOString())

const serializeRole = (row: RoleRow): PermissionRoleDto => ({
	roleId: row.roleId,
	parentRoleId: row.parentRoleId,
	rank: row.rank,
	updatedAt: toIso(row.updatedAt),
})

const serializeGrant = (row: GrantRow): PermissionGrantDto => ({
	id: row.id,
	subjectType: row.subjectType,
	subjectId: row.subjectId,
	nsKey: row.nsKey,
	kind: row.kind,
	local: row.local,
	effect: row.effect,
	updatedAt: toIso(row.updatedAt),
})

declare module '@pluxel/hmr/services' {
	interface RpcExtensions {
		chatbots: ChatbotsSandboxRpc
	}

	interface SseEvents {
		chatbots: SandboxEvent
	}
}
