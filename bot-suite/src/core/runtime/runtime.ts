import type { Context } from '@pluxel/hmr'

import { MikroOrm } from 'pluxel-plugin-mikro-orm'

import {
	hasRichParts,
	parseChatCommandText,
	normalizeReplyPayload,
	partsToText,
} from 'pluxel-plugin-bot-core'
import type {
	AnyMessage,
	BotCore,
	MessageContent,
	Part,
	Platform,
	SandboxSession,
} from 'pluxel-plugin-bot-core'
import { CmdError, Type, isErr } from '@pluxel/cmd'

import { UserDirectory } from '../users/directory'
import { PermissionService } from '../../permissions/service'
import { createPermissionCommandKit, type CommandKit as ChatbotsCommandKit } from '../commands/kit'
import { createPermissionApi, type ChatbotsPermissionApi } from '../../permissions/permission'
import type { ChatbotsCommandContext } from '../types'
import { CommandRegistry } from './command-registry'
import type { RatesApi } from 'pluxel-plugin-kv'
import type { CommandDraft } from '../commands/draft'

export interface ChatbotsRuntimeOptions {
	cmdPrefix: string
	debug: boolean
	devCommands: boolean
	cmdPermDefaultEffect: 'allow' | 'deny'
	cmdPermAutoDeclare: boolean
	cmdPermAutoDeclareStars: boolean
	userCacheTtlMs: number
	userCacheMax: number
	linkTokenTtlSeconds: number
	registerUserCommands: boolean
}

export class ChatbotsRuntime {
	public readonly users: UserDirectory
	public readonly permissions: PermissionService
	public readonly permission: ChatbotsPermissionApi
	public readonly cmd: ChatbotsCommandKit<ChatbotsCommandContext>

	private readonly registry: CommandRegistry<ChatbotsCommandContext>
	private disposed = false
	private readonly disposeEntities: () => Promise<void>

	private constructor(
		private readonly ctx: Context,
		private readonly bot: BotCore,
		private readonly mikro: MikroOrm,
		private readonly options: ChatbotsRuntimeOptions,
		private readonly rates: RatesApi,
		users: UserDirectory,
		permissions: PermissionService,
		disposeEntities: () => Promise<void>,
	) {
		this.registry = new CommandRegistry<ChatbotsCommandContext>({
			caseInsensitive: true,
			hostEffects: this.ctx.effects,
		})
		this.users = users
		this.permissions = permissions
		this.permission = createPermissionApi(this.permissions)
		this.cmd = createPermissionCommandKit(this.registry, this.permissions, {
			owner: this.ctx,
			scopeKey: this.ctx.pluginInfo?.id ?? 'bot-suite',
			rates: this.rates,
			permDefaults: {
				defaultEffect: this.options.cmdPermDefaultEffect,
				autoDeclare: this.options.cmdPermAutoDeclare,
				autoDeclareStars: this.options.cmdPermAutoDeclareStars,
			},
		})
		this.disposeEntities = disposeEntities
	}

	static async create(
		ctx: Context,
		bot: BotCore,
		mikro: MikroOrm,
		options: ChatbotsRuntimeOptions,
		rates: RatesApi,
	): Promise<ChatbotsRuntime> {
		const { dir, batch } = await UserDirectory.create(mikro, {
			cacheMax: options.userCacheMax,
			cacheTtlMs: options.userCacheTtlMs,
		})
		const permissions = await PermissionService.create(mikro)
		return new ChatbotsRuntime(ctx, bot, mikro, options, rates, dir, permissions, async () => {
			await permissions.dispose()
			await batch.dispose()
		})
	}

	bootstrap() {
		this.registerCommandPipeline()
		this.registerBuiltinCommands()
	}

	async dispatchSandboxMessage(msg: AnyMessage): Promise<void> {
		const text = this.buildCommandText(msg)
		const parsed = parseChatCommandText(text, { prefix: this.getCmdPrefix(), stripAtSuffix: true })
		if (!parsed?.input) return
		await this.dispatchCommand(parsed.input, msg)
	}

	getCommandKit(caller?: Context): ChatbotsCommandKit<ChatbotsCommandContext> {
		const ctx = caller ?? this.ctx
		return this.registry.getOrCreateKit(ctx, (ownerCtx) =>
			createPermissionCommandKit(this.registry, this.permissions, {
				owner: ownerCtx,
				scopeKey: ownerCtx.pluginInfo?.id ?? this.ctx.pluginInfo?.id ?? 'bot-suite',
				rates: this.rates,
				permDefaults: {
					defaultEffect: this.options.cmdPermDefaultEffect,
					autoDeclare: this.options.cmdPermAutoDeclare,
					autoDeclareStars: this.options.cmdPermAutoDeclareStars,
				},
			}),
		)
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

		const stop = this.bot.events.message.on((msg) => {
			if (msg.user.isBot) return
			const text = this.buildCommandText(msg)
			const parsed = parseChatCommandText(text, { prefix, stripAtSuffix: true })
			if (!parsed?.input) return
			void this.dispatchCommand(parsed.input, msg as AnyMessage)
		})

		this.ctx.effects.defer(stop)
	}

	private resolveCommandPlatform(msg: AnyMessage): Platform {
		if (msg.platform !== 'sandbox') return msg.platform
		const raw = msg.raw as SandboxSession | undefined
		const target = raw?.targetPlatform
		if (target === 'kook' || target === 'telegram' || target === 'milky' || target === 'sandbox') return target
		return msg.platform
	}

	private renderPartsForMessage(parts: Part[], msg: AnyMessage): string {
		if (msg.platform === 'sandbox') {
			const raw = msg.raw as SandboxSession | undefined
			if (raw?.renderText) return raw.renderText(parts)
		}
		return partsToText(parts, msg.platform)
	}

	private buildCommandText(msg: AnyMessage): string {
		if (!msg.parts.length) return msg.textRaw ?? msg.text ?? ''
		const platform = this.resolveCommandPlatform(msg)
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
		if (platform === 'kook' && text) {
			text = text.replace(/\((met|rol|chn)\)([\s\S]*?)\(\1\)/g, ' ')
		}
		return text
	}

	cleanupCommandsForOwner(ownerKey: string) {
		this.registry.cleanupCommandsForOwner(ownerKey)
	}

	private async dispatchCommand(body: string, msg: AnyMessage): Promise<void> {
		const { user, identity } = await this.users.ensureUserForMessage(msg)
		const ctx: ChatbotsCommandContext = { msg, user, identity }

		try {
			const dispatched = await this.registry.router.dispatch(body, ctx)
			if (this.disposed) return
			if (isErr(dispatched)) {
				const err = dispatched.err
				if (err instanceof CmdError && err.code === 'E_CMD_NOT_FOUND') return
				this.ctx.logger.warn('command error', { err, id: (err.details as any)?.id })
				await this.safeReply(msg, err.publicMessage)
				return
			}

			const result = dispatched.val
			if (result === undefined) return
			await this.safeReply(msg, result)
		} catch (e) {
			if (this.disposed) return
			if (e instanceof CmdError && e.code === 'E_CMD_NOT_FOUND') return
			const err =
				e instanceof CmdError
					? e
					: new CmdError('E_INTERNAL', 'Command failed', { message: (e as any)?.message ?? 'Command failed', cause: e })
			this.ctx.logger.warn('command error', { err, id: (err.details as any)?.id })
			await this.safeReply(msg, err.publicMessage)
		}
	}

	private async safeReply(msg: AnyMessage, content: unknown) {
		try {
			const payload = normalizeReplyPayload(content)
			if (!payload) return
			await msg.reply(payload, { quote: true })
		} catch (e) {
			const error = e instanceof Error ? e : new Error(String(e))
			this.ctx.logger.warn('auto reply failed', { error })
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
		const targetPlatform =
			msg.platform === 'sandbox' ? (msg.raw as SandboxSession | undefined)?.targetPlatform ?? null : null
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
			targetPlatform,
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

	private registerBuiltinCommands() {
		const core = this.cmd.group('core')
		core.command(
			{
				localId: 'help',
				usage: 'help [command]',
				description: '查看帮助',
				perm: false,
			},
			(c) => this.defineCoreHelp(c),
		)
		core.command(
			{
				localId: 'info',
				aliases: ['about', 'status'],
				usage: 'info [platform]',
				description: '当前平台抽象信息',
				perm: false,
			},
			(c) => this.defineCoreInfo(c),
		)

		if (this.options.devCommands) {
			const dev = this.cmd.group('dev')
			dev.command(
				{
					localId: 'echo',
					usage: 'echo',
					description: '原样复读当前消息（parts）',
					perm: false,
				},
				(c) => this.defineDevEcho(c),
			)
			dev.command(
				{
					localId: 'parts',
					usage: 'parts [ref|msg]',
					description: '返回解析后的 parts JSON（默认优先引用消息）',
					perm: false,
				},
				(c) => this.defineDevParts(c),
			)
			dev.command(
				{
					localId: 'meta',
					usage: 'meta',
					description: '返回基础元信息/附件摘要',
					perm: false,
				},
				(c) => this.defineDevMeta(c),
			)
			dev.command(
				{
					localId: 'say',
					usage: 'say [...text]',
					description: '直接回复文本',
					perm: false,
				},
				(c) => this.defineDevSay(c),
			)
		}

		if (this.options.registerUserCommands) {
			const user = this.cmd.scope('user').group('user')
			user.command(
				{
					localId: 'me',
					usage: 'user me',
					description: '查看当前跨平台用户信息',
					perm: false,
				},
				(c) => this.defineUserMe(c),
			)
			user.command(
				{
					localId: 'link',
					usage: 'user link [CODE]',
					description: '生成/使用绑定码，用于跨平台绑定同一用户',
					perm: false,
				},
				(c) => this.defineUserLink(c),
			)
		}
	}

	private defineCoreHelp(c: CommandDraft<ChatbotsCommandContext>) {
		return c
			.input(Type.String())
			.handle((command) => {
				const prefix = this.getCmdPrefix()
				const list = this.cmd.list()
				const normalized = String(command ?? '').trim().toLowerCase()
				if (!normalized) return this.formatHelp(prefix)
				const found = list.find(
					(c) => c.name.toLowerCase() === normalized || c.aliases.some((a) => a.toLowerCase() === normalized),
				)
				if (found) return `${prefix}${found.usage ?? found.name}`
				const hasGroup = list.some((c) => (c.group ?? '').toLowerCase() === normalized)
				if (hasGroup) return this.formatHelp(prefix, command)
				return `Unknown command: ${command}\n\n${this.formatHelp(prefix)}`
			})
	}

	private defineCoreInfo(c: CommandDraft<ChatbotsCommandContext>) {
		return c
			.input(Type.String())
			.handle((platform, ctx) => {
				const prefix = this.getCmdPrefix()
				const raw = String(platform ?? '').trim()
				const target = raw || String(ctx.msg.platform)
				const adapterList = this.bot.adapters.list()
				const adapters = adapterList.map((a) => ({
					platform: a.name,
					policy: a.policy,
				}))

				const normalized = target.toLowerCase()
				const adapter = adapterList.find((a) => String(a.name).toLowerCase() === normalized)
				if (!adapter) {
					const names = adapterList.map((a) => a.name).join(', ')
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
						policy: adapter.policy,
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
	}

	private defineDevEcho(c: CommandDraft<ChatbotsCommandContext>) {
		return c.handle((_input, ctx) => (ctx.msg.parts.length ? ctx.msg.parts : ctx.msg.text || '[empty]'))
	}

	private defineDevParts(c: CommandDraft<ChatbotsCommandContext>) {
		return c
			.input(Type.String())
			.handle((scope, ctx) => {
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
					renderedText: this.renderPartsForMessage(parts, ctx.msg as AnyMessage),
					hint,
					parts,
				})
			})
	}

	private defineDevMeta(c: CommandDraft<ChatbotsCommandContext>) {
		return c.handle((_input, ctx) => this.buildJsonBlock(this.summarizeMessage(ctx.msg)))
	}

	private defineDevSay(c: CommandDraft<ChatbotsCommandContext>) {
		return c.input(Type.String()).handle((text) => {
			const s = String(text ?? '').trim()
			if (!s) return undefined
			return s
		})
	}

	private defineUserMe(c: CommandDraft<ChatbotsCommandContext>) {
		return c.handle((_input, ctx) => {
			const pairs = ctx.user.identities.map((i) => `${i.platform}:${i.platformUserId}`).join(', ')
			return `uid=${ctx.user.id}\nidentities=${pairs || '[none]'}`
		})
	}

	private defineUserLink(c: CommandDraft<ChatbotsCommandContext>) {
		return c
			.input(Type.String())
			.handle(async (code, ctx) => {
				const raw = String(code ?? '').trim()
				const first = raw ? raw.split(/\s+/g)[0]! : ''
				if (!first) {
					const { code: created, expiresAt } = await this.users.createLinkToken(
						ctx.user.id,
						this.options.linkTokenTtlSeconds,
					)
					const secs = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
					return `Link code: ${created}\nExpires in ~${secs}s\n\nRun on another platform: ${this.getCmdPrefix()}user link ${created}`
				}

				const res = await this.users.consumeLinkToken(
					first.trim().toUpperCase(),
					ctx.identity.platform,
					ctx.identity.platformUserId,
				)
				if (!res.ok) return res.message
				return `Linked. uid=${res.userId}`
			})
	}
}
