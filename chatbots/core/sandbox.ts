import { RpcTarget } from '@pluxel/hmr/capnweb'
import { Buffer } from 'node:buffer'
import type { Part, Platform, SandboxSession } from '@pluxel/bot-layer'
import {
	createSandboxAdapter,
	createSandboxMessage,
	getAdapter,
	getCommandMeta,
	normalizePartsForAdapter,
	registerSandboxAdapter,
	toPartArray,
} from '@pluxel/bot-layer'

import type { ChatbotsRuntime } from './runtime'
import type {
	SandboxContent,
	SandboxCommandsSnapshot,
	SandboxEvent,
	SandboxMessage,
	SandboxSendInput,
	SandboxSendResult,
	SandboxSnapshot,
} from './sandbox-types'
import { SandboxStore } from './sandbox-store'
import type { PermissionService, SubjectType } from '../permissions/service'
import type { GrantRow, RoleRow } from '../permissions/db/schemas'
import type {
	PermissionCatalogNamespace,
	PermissionGrantDto,
	PermissionRoleDto,
} from './permissions-types'
import type { UnifiedUserDto } from './user-types'
import type { UserDirectory } from './db/user-directory'

const DEFAULT_TARGET_PLATFORM: Platform = 'sandbox'
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

const resolveBaseAdapter = (platform: Platform) => {
	if (platform === 'sandbox') return undefined
	try {
		return getAdapter(platform)
	} catch {
		return undefined
	}
}

export class ChatbotsSandbox {
	private readonly cmdPrefix: string
	private readonly store: SandboxStore

	constructor(private readonly runtime: ChatbotsRuntime, options: { cmdPrefix: string }) {
		this.cmdPrefix = options.cmdPrefix.trim() || '/'
		registerSandboxAdapter()
		this.store = new SandboxStore(MAX_MESSAGES)
		this.reset()
	}

	snapshot(): SandboxSnapshot {
		return this.store.snapshot()
	}

	reset(): SandboxSnapshot {
		return this.store.reset(
			[{ type: 'text', text: `Chatbots sandbox ready. Prefix: ${this.cmdPrefix}` }],
			{ platform: DEFAULT_TARGET_PLATFORM, userId: DEFAULT_USER_ID, channelId: DEFAULT_CHANNEL_ID },
		)
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
		const targetPlatform = input.platform ?? DEFAULT_TARGET_PLATFORM
		const userId = input.userId ?? DEFAULT_USER_ID
		const channelId = input.channelId ?? DEFAULT_CHANNEL_ID
		const parts = normalizeSandboxContent(input.content)
		if (!parts.length) {
			return { messages: [] }
		}

		const baseAdapter = resolveBaseAdapter(targetPlatform)
		const adapter = createSandboxAdapter(baseAdapter)
		const renderText = (value: Part[]) => adapter.render(normalizePartsForAdapter(value, adapter)).text

		const session: SandboxSession = {
			targetPlatform,
			userId,
			channelId,
			mockRoleIds: input.mockRoleIds,
			mockUser: input.mockUser,
			mockChannel: input.mockChannel,
			renderText,
			append: (payload) =>
				this.store.append({
					...payload,
					platform: targetPlatform,
					userId,
					channelId,
					renderText,
				}),
		}

		const rawText = typeof input.content === 'string' ? input.content : undefined
		let messages: SandboxMessage[] = []

		this.store.beginBatch()
		try {
			session.append({ role: 'user', parts })
			const msg = createSandboxMessage({ session, parts, rawText, adapter })
			await this.runtime.dispatchSandboxMessage(msg)
		} finally {
			messages = this.store.endBatch()
		}

		return { messages }
	}

	createSseHandler() {
		return this.store.createSseHandler()
	}
}

export class ChatbotsSandboxRpc extends RpcTarget {
	constructor(
		private readonly sandbox: ChatbotsSandbox,
		private readonly permissions: PermissionService,
		private readonly users: UserDirectory,
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

	async createRole(parentRoleId: number | null, rank: number, name?: string | null): Promise<number> {
		return await this.permissions.createRole(parentRoleId, rank, name)
	}

	async updateRole(
		roleId: number,
		patch: { parentRoleId?: number | null; rank?: number; name?: string | null },
	): Promise<void> {
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

	async getUser(userId: number): Promise<UnifiedUserDto | null> {
		const user = await this.users.getUserById(userId)
		return user ? serializeUser(user) : null
	}

	async findUserByPlatformIdentity(platform: Platform, platformUserId: string | number): Promise<UnifiedUserDto | null> {
		const user = await this.users.findUserByIdentity(platform, String(platformUserId))
		return user ? serializeUser(user) : null
	}

	async searchUsersByName(query: string, limit?: number): Promise<UnifiedUserDto[]> {
		const users = await this.users.searchUsersByName(query, limit)
		return users.map(serializeUser)
	}

	async updateUserDisplayName(userId: number, displayName: string | null): Promise<void> {
		await this.users.updateUserDisplayName(userId, displayName)
	}
}

const toIso = (value: Date | string) => (typeof value === 'string' ? value : value.toISOString())

const serializeRole = (row: RoleRow): PermissionRoleDto => ({
	roleId: row.roleId,
	name: row.name ?? null,
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
	node: row.kind === 'star' ? `${row.nsKey}.${row.local ? `${row.local}.*` : '*'}` : `${row.nsKey}.${row.local}`,
})

const serializeUser = (user: { id: number; displayName: string | null; createdAt: Date; identities: Array<{ platform: Platform; platformUserId: string }> }): UnifiedUserDto => ({
	id: user.id,
	displayName: user.displayName ?? null,
	createdAt: toIso(user.createdAt),
	identities: user.identities.map((identity) => ({
		platform: identity.platform,
		platformUserId: identity.platformUserId,
	})),
})

declare module '@pluxel/hmr/services' {
	interface RpcExtensions {
		chatbots: ChatbotsSandboxRpc
	}

	interface SseEvents {
		chatbots: SandboxEvent
	}
}
