import type { Context } from '@pluxel/hmr'

import { MikroOrm } from 'pluxel-plugin-mikro-orm'

import {
	CommandError,
	createCommandBus,
	getCommandMeta,
	hasRichParts,
	partsToText,
	toPartArray,
} from '@pluxel/bot-layer'
import type {
	AnyMessage,
	Attachment,
	BotLayer,
	CommandKit,
	MessageContent,
	Part,
	Platform,
} from '@pluxel/bot-layer'

import { UserDirectory } from './db/user-directory'
import { PermissionService } from '../permissions/service'
import { createPermissionCommandKit, type CommandKit as PermCommandKit } from './cmd/perms'
import { createPermissionApi, type ChatbotsPermissionApi } from '../permissions/permission'
import type { ChatbotsCommandContext } from './types'

export interface ChatbotsRuntimeOptions {
	cmdPrefix: string
	debug: boolean
	devCommands: boolean
	userCacheTtlMs: number
	userCacheMax: number
	linkTokenTtlSeconds: number
	registerUserCommands: boolean
}

export class ChatbotsRuntime {
	public readonly users: UserDirectory
	public readonly permissions: PermissionService
	public readonly permission: ChatbotsPermissionApi
	public readonly cmd: PermCommandKit<ChatbotsCommandContext>

	private readonly bus = createCommandBus<ChatbotsCommandContext>({ caseInsensitive: true })
	private readonly commandKits = new WeakMap<Context, PermCommandKit<ChatbotsCommandContext>>()
	private readonly commandsByOwner = new Map<string, Set<Command<any, any, ChatbotsCommandContext, any>>>()
	private readonly commandOwners = new WeakMap<Command<any, any, ChatbotsCommandContext, any>, string>()
	private readonly ownerCtxById = new Map<string, Context>()
	private disposed = false
	private readonly disposeEntities: () => Promise<void>

	private constructor(
		private readonly ctx: Context,
		private readonly bot: BotLayer,
		private readonly mikro: MikroOrm,
		private readonly options: ChatbotsRuntimeOptions,
		users: UserDirectory,
		permissions: PermissionService,
		disposeEntities: () => Promise<void>,
	) {
		this.users = users
		this.permissions = permissions
		this.permission = createPermissionApi(this.permissions)
		this.cmd = createPermissionCommandKit(this.bus, this.permissions, {
			onRegister: (cmd) => this.registerCommandCleanup(cmd, this.ctx),
		})
		this.commandKits.set(this.ctx, this.cmd)
		this.disposeEntities = disposeEntities
	}

	static async create(
		ctx: Context,
		bot: BotLayer,
		mikro: MikroOrm,
		options: ChatbotsRuntimeOptions,
	): Promise<ChatbotsRuntime> {
		const { dir, batch } = await UserDirectory.create(mikro, {
			cacheMax: options.userCacheMax,
			cacheTtlMs: options.userCacheTtlMs,
		})
		const permissions = await PermissionService.create(mikro)
		return new ChatbotsRuntime(ctx, bot, mikro, options, dir, permissions, async () => {
			await permissions.dispose()
			await batch.dispose()
		})
	}

	bootstrap() {
		this.registerCommandPipeline()
		this.registerCoreCommands()
		if (this.options.devCommands) this.registerDevCommands()
		if (this.options.registerUserCommands) this.registerUserCommands()
	}

	async sandboxDispatch(input: {
		content: MessageContent
		platform?: Platform
		userId?: string | number
		channelId?: string | number
	}): Promise<Part[][]> {
		const platform = input.platform ?? 'kook'
		const parts = toPartArray(input.content)
		if (!parts.length) return []

		const rawText = typeof input.content === 'string' ? input.content : partsToText(parts, platform)
		const replies: Part[][] = []
		const msg = this.createSandboxMessage({
			platform,
			parts,
			rawText,
			userId: input.userId ?? 'sandbox-user',
			channelId: input.channelId ?? 'sandbox-channel',
			replies,
		})

		const text = this.buildCommandText(msg).trim()
		if (!text) return replies

		const prefix = this.getCmdPrefix()
		if (!text.toLowerCase().startsWith(prefix.toLowerCase())) return replies

		const body = text.slice(prefix.length).trim()
		if (!body) return replies

		await this.dispatchCommand(body, msg)
		return replies
	}

	getCommandKit(caller?: Context): PermCommandKit<ChatbotsCommandContext> {
		const ctx = caller ?? this.ctx
		const ownerKey = ctx.pluginInfo?.id
		if (!ownerKey) {
			throw new Error('[chatbots] cmd registration requires caller context')
		}
		const prevCtx = this.ownerCtxById.get(ownerKey)
		if (prevCtx && prevCtx !== ctx) {
			this.cleanupCommandsForOwner(ownerKey)
		}
		this.ownerCtxById.set(ownerKey, ctx)
		const cached = this.commandKits.get(ctx)
		if (cached) return cached
		const kit = createPermissionCommandKit(this.bus, this.permissions, {
			onRegister: (cmd) => this.registerCommandCleanup(cmd, ctx),
		})
		this.commandKits.set(ctx, kit)
		return kit
	}

	async teardown(): Promise<void> {
		this.disposed = true
		await this.disposeEntities()
	}

	private getCmdPrefix(): string {
		const prefix = this.options.cmdPrefix.trim()
		return prefix || '/'
	}

	private registerCommandPipeline() {
		const prefix = this.getCmdPrefix()
		const prefixLower = prefix.toLowerCase()

		const stop = this.bot.events.text.on((msg) => {
			if (msg.user.isBot) return
			const text = this.buildCommandText(msg).trim()
			if (!text) return
			if (!text.toLowerCase().startsWith(prefixLower)) return

			const body = text.slice(prefix.length).trim()
			if (!body) return

			void this.dispatchCommand(body, msg as AnyMessage)
		})

		this.ctx.scope.collectEffect(() => stop())
	}

	private createSandboxMessage(input: {
		platform: Platform
		parts: Part[]
		rawText: string
		userId: string | number
		channelId: string | number
		replies: Part[][]
	}): AnyMessage {
		const mentions = input.parts.filter((part) => part.type === 'mention')
		const attachments: Attachment[] = input.parts
			.filter((part) => part.type === 'image' || part.type === 'file')
			.map((part) => ({
				platform: input.platform,
				kind: part.type,
				part,
				source: 'message',
			}))

		const reply = async (content: MessageContent) => {
			const out = toPartArray(content)
			if (out.length) input.replies.push(out)
		}

		const msg: AnyMessage = {
			platform: input.platform,
			text: partsToText(input.parts, input.platform),
			textRaw: input.rawText,
			parts: input.parts,
			mentions,
			attachments,
			reference: undefined,
			rich: hasRichParts(input.parts),
			user: {
				id: input.userId as any,
				username: 'sandbox',
				displayName: 'Sandbox',
				avatar: null,
				isBot: false,
			},
			channel: {
				id: input.channelId as any,
				guildId: null as any,
				name: 'sandbox',
				isPrivate: true,
			},
			messageId: null,
			raw: {} as any,
			bot: {} as any,
			reply,
			sendText: reply,
			sendImage: async (image, caption) => {
				const captionParts = caption ? toPartArray(caption) : []
				await reply(captionParts.length ? [image, ...captionParts] : image)
			},
			sendFile: async (file) => {
				await reply(file)
			},
			uploadImage: async (image) => image,
			uploadFile: async (file) => file,
		}

		return msg
	}

	private buildCommandText(msg: AnyMessage): string {
		if (!msg.parts.length) return msg.textRaw ?? msg.text ?? ''
		const out: string[] = []
		const push = (text: string | undefined | null) => {
			if (text) out.push(text)
		}
		const walk = (part: Part) => {
			switch (part.type) {
				case 'text':
					push(part.text)
					break
				case 'styled':
					for (const child of part.children) walk(child)
					break
				case 'link':
					push(part.label ?? part.url)
					break
				case 'codeblock':
					push(part.code)
					break
				case 'mention':
					break
				default:
					break
			}
		}
		for (const part of msg.parts) walk(part)
		let text = out.join('')
		if (!text.trim()) text = msg.textRaw ?? msg.text ?? ''
		if (msg.platform === 'kook' && text) {
			text = text.replace(/\((met|rol|chn)\)([\s\S]*?)\(\1\)/g, ' ')
		}
		return text
	}

	private registerCommandCleanup(cmd: Command<any, any, ChatbotsCommandContext, any>, owner?: Context) {
		const caller = owner ?? this.ctx.caller ?? this.ctx
		const ownerKey = caller.pluginInfo?.id
		if (!ownerKey) {
			throw new Error('[chatbots] command registration requires caller context')
		}
		const unregister = (this.bus as any).unregister as ((cmd: any) => void) | undefined
		if (typeof unregister !== 'function') return
		this.trackCommand(ownerKey, cmd)
		caller.scope.collectEffect(() => {
			try {
				unregister(cmd)
			} catch (err) {
				this.ctx.logger.warn(err, 'chatbots: command unregister failed')
			} finally {
				this.untrackCommand(cmd, ownerKey)
			}
		})
	}

	private trackCommand(ownerKey: string, cmd: Command<any, any, ChatbotsCommandContext, any>) {
		let bucket = this.commandsByOwner.get(ownerKey)
		if (!bucket) {
			bucket = new Set()
			this.commandsByOwner.set(ownerKey, bucket)
		}
		bucket.add(cmd)
		this.commandOwners.set(cmd, ownerKey)
	}

	private untrackCommand(cmd: Command<any, any, ChatbotsCommandContext, any>, ownerKey?: string) {
		const key = ownerKey ?? this.commandOwners.get(cmd)
		if (!key) return
		const bucket = this.commandsByOwner.get(key)
		if (bucket) {
			bucket.delete(cmd)
			if (bucket.size === 0) this.commandsByOwner.delete(key)
		}
		this.commandOwners.delete(cmd)
	}

	cleanupCommandsForOwner(ownerKey: string) {
		const bucket = this.commandsByOwner.get(ownerKey)
		if (!bucket || bucket.size === 0) return
		const unregister = (this.bus as any).unregister as ((cmd: any) => void) | undefined
		if (typeof unregister !== 'function') return
		for (const cmd of Array.from(bucket)) {
			try {
				unregister(cmd)
			} catch (err) {
				this.ctx.logger.warn(err, 'chatbots: command cleanup failed')
			} finally {
				this.untrackCommand(cmd, ownerKey)
			}
		}
	}

	private async dispatchCommand(body: string, msg: AnyMessage): Promise<void> {
		try {
			const { user, identity } = await this.users.ensureUserForMessage(msg)
			const ctx: ChatbotsCommandContext = { msg, user, identity }
			const result = await this.bus.dispatch(body, ctx)
			if (result === undefined || this.disposed) return
			await this.safeReply(msg, result)
		} catch (e) {
			if (e instanceof CommandError) {
				await this.safeReply(msg, e.message)
				return
			}
			this.ctx.logger.warn(e, `chatbots: 执行指令失败: ${body}`)
		}
	}

	private async safeReply(msg: AnyMessage, content: unknown) {
		try {
			await msg.reply(content as MessageContent, { quote: true })
		} catch (e) {
			this.ctx.logger.warn(e, 'chatbots: 自动回复失败')
		}
	}

	private buildJsonBlock(payload: unknown): Part {
		return {
			type: 'codeblock',
			language: 'json',
			code: JSON.stringify(payload, null, 2),
		}
	}

	private summarizeMessage(msg: AnyMessage) {
		const attachments =
			msg.attachments?.map((a) => ({
				platform: a.platform,
				kind: a.kind,
				source: a.source,
				url: a.part.url,
				name: (a.part as any).name,
				mime: (a.part as any).mime,
			})) ?? []

		const reference = msg.reference
			? {
					messageId: msg.reference.messageId,
					parts: msg.reference.parts.length,
					attachments: msg.reference.attachments.length,
				}
			: null

		return {
			platform: msg.platform,
			text: msg.text,
			rich: msg.rich ?? hasRichParts(msg.parts),
			parts: msg.parts.length,
			attachments,
			reference,
			user: msg.user,
			channel: msg.channel,
			messageId: msg.messageId,
		}
	}

	private formatHelp(prefix: string, group?: string): string {
		const raw = this.cmd.help(group)
		const lines = raw
			.split('\n')
			.map((line) => (line.startsWith('- ') ? `- ${prefix}${line.slice(2)}` : line))
		return [`Prefix: ${prefix}`, ...lines].join('\n')
	}

	private findCommand(name: string) {
		const normalized = name.trim().toLowerCase()
		if (!normalized) return undefined
		return this.cmd.list().find((c) => c.nameTokens.join(' ').toLowerCase() === normalized)
	}

	private hasGroup(name: string): boolean {
		const normalized = name.trim()
		if (!normalized) return false
		for (const cmd of this.cmd.list()) {
			const meta = getCommandMeta(cmd)
			if (meta?.group === normalized) return true
		}
		return false
	}

	private registerCoreCommands() {
		const prefix = this.getCmdPrefix()

		this.cmd.group('core', (cmd) => {
			cmd
				.reg('help [command]')
				.describe('查看帮助')
				.action(({ command }) => {
					if (!command) return this.formatHelp(prefix)
					const found = this.findCommand(command)
					if (found) return `${prefix}${found.toUsage()}`
					if (this.hasGroup(command)) return this.formatHelp(prefix, command)
					return `Unknown command: ${command}\n\n${this.formatHelp(prefix)}`
				})

			cmd
				.reg('info [platform]')
				.describe('当前平台抽象信息')
				.alias('about', 'status')
				.action(({ platform }, ctx) => {
					const target = String(platform ?? ctx.msg.platform)
					const adapters = this.bot.adapters.list().map((a) => ({
						platform: a.name,
						capabilities: a.capabilities,
					}))

					const adapter = this.bot.adapters
						.list()
						.find((a) => String(a.name).toLowerCase() === target.toLowerCase())
					if (!adapter) {
						const names = this.bot.adapters.list().map((a) => a.name).join(', ')
						return `Unknown platform: ${target}. Available: ${names}`
					}

					const snapshot = this.bot.bridgeStatus
					const bridgeStatus = snapshot.bridges.find((b) => b.platform === adapter.name) ?? null
					const hasBridgeDefinition = Boolean(this.bot.bridges.get(adapter.name as any))

					return this.buildJsonBlock({
						runtime: {
							cmdPrefix: prefix,
							debug: Boolean(this.options.debug),
							devCommands: this.options.devCommands,
						},
						target: {
							platform: adapter.name,
							capabilities: adapter.capabilities,
							bridgeStatus,
							hasBridgeDefinition,
						},
						registered: {
							adapters,
							bridges: this.bot.bridges.list().map((b) => b.platform),
							status: snapshot,
						},
						message: this.summarizeMessage(ctx.msg as AnyMessage),
					})
				})
		})
	}

	private registerDevCommands() {
		this.cmd.group('dev', (cmd) => {
			cmd
				.reg('echo')
				.describe('原样复读当前消息（parts）')
				.action((_argv, ctx) => (ctx.msg.parts.length ? ctx.msg.parts : ctx.msg.text || '[empty]'))

			cmd
				.reg('parts [scope]')
				.describe('返回解析后的 parts JSON（默认优先引用消息）')
				.usage('parts [ref|msg]')
				.action(({ scope }, ctx) => {
					const mode = String(scope ?? '').trim().toLowerCase()
					const hasRef = Boolean(ctx.msg.reference?.parts?.length)
					const useRef = mode ? mode === 'ref' : hasRef
					const target = useRef ? ctx.msg.reference : undefined
					const parts = target?.parts?.length ? target.parts : ctx.msg.parts
					const hint =
						!hasRef && !mode
							? 'Tip: reply/quote a message then run /parts to inspect ctx.msg.reference.parts'
							: undefined
					return this.buildJsonBlock({
						target: useRef && target ? 'reference' : 'message',
						platform: ctx.msg.platform,
						renderedText: partsToText(parts, ctx.msg.platform),
						hint,
						parts,
					})
				})

			cmd
				.reg('meta')
				.describe('返回基础元信息/附件摘要')
				.action((_argv, ctx) => this.buildJsonBlock(this.summarizeMessage(ctx.msg)))

			cmd
				.reg('say [...text]')
				.describe('直接回复文本')
				.action(({ text }) => {
					if (!text?.length) return undefined
					return text.join(' ')
				})
		})
	}

	private registerUserCommands() {
		this.cmd.group('user', (cmd) => {
			cmd
				.reg('user me')
				.describe('查看当前跨平台用户信息')
				.action((_argv, ctx) => {
					const pairs = ctx.user.identities
						.map((i) => `${i.platform}:${i.platformUserId}`)
						.join(', ')
					return `uid=${ctx.user.id}\nidentities=${pairs || '[none]'}`
				})

			cmd
				.reg('user link [code]')
				.describe('生成/使用绑定码，用于跨平台绑定同一用户')
				.usage('user link [CODE]')
				.action(async ({ code }, ctx) => {
					if (!code) {
						const { code: created, expiresAt } = await this.users.createLinkToken(
							ctx.user.id,
							this.options.linkTokenTtlSeconds,
						)
						const secs = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
						return `Link code: ${created}\nExpires in ~${secs}s\n\nRun on another platform: ${this.getCmdPrefix()}user link ${created}`
					}

					const res = await this.users.consumeLinkToken(
						String(code).trim().toUpperCase(),
						ctx.identity.platform,
						ctx.identity.platformUserId,
					)
					if (!res.ok) return res.message
					return `Linked. uid=${res.userId}`
				})
		})
	}
}
