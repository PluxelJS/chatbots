import type { Context } from '@pluxel/hmr'

import { MikroOrm } from 'pluxel-plugin-mikro-orm'

import {
	CommandError,
	getCommandMeta,
	hasRichParts,
	parseChatCommandText,
	normalizeReplyPayload,
	partsToText,
} from 'pluxel-plugin-bot-core'
import type {
	AnyMessage,
	BotCore,
	CommandKit,
	MessageContent,
	Part,
	Platform,
	SandboxSession,
} from 'pluxel-plugin-bot-core'

import { UserDirectory } from '../users/directory'
import { PermissionService } from '../../permissions/service'
import { createPermissionCommandKit, type CommandKit as PermCommandKit } from '../commands/kit'
import { createPermissionApi, type ChatbotsPermissionApi } from '../../permissions/permission'
import type { ChatbotsCommandContext } from '../types'
import { CommandRegistry } from './command-registry'
import type { Rates } from 'pluxel-plugin-kv'

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

	private readonly registry = new CommandRegistry<ChatbotsCommandContext>({ caseInsensitive: true })
	private disposed = false
	private readonly disposeEntities: () => Promise<void>

	private constructor(
		private readonly ctx: Context,
		private readonly bot: BotCore,
		private readonly mikro: MikroOrm,
		private readonly options: ChatbotsRuntimeOptions,
		private readonly rates: Rates,
		users: UserDirectory,
		permissions: PermissionService,
		disposeEntities: () => Promise<void>,
	) {
		this.users = users
		this.permissions = permissions
		this.permission = createPermissionApi(this.permissions)
		this.cmd = createPermissionCommandKit(this.registry.bus, this.permissions, {
			scopeKey: this.ctx.pluginInfo?.id ?? 'bot-suite',
			rates: this.rates,
			onRegister: (cmd) => this.registry.registerCommandCleanup(cmd, this.ctx),
		})
		this.disposeEntities = disposeEntities
	}

	static async create(
		ctx: Context,
		bot: BotCore,
		mikro: MikroOrm,
		options: ChatbotsRuntimeOptions,
		rates: Rates,
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
		this.registerCoreCommands()
		if (this.options.devCommands) this.registerDevCommands()
		if (this.options.registerUserCommands) this.registerUserCommands()
	}

	async dispatchSandboxMessage(msg: AnyMessage): Promise<void> {
		const text = this.buildCommandText(msg)
		const parsed = parseChatCommandText(text, { prefix: this.getCmdPrefix(), stripAtSuffix: true })
		if (!parsed?.input) return
		await this.dispatchCommand(parsed.input, msg)
	}

	getCommandKit(caller?: Context): PermCommandKit<ChatbotsCommandContext> {
		const ctx = caller ?? this.ctx
		return this.registry.getOrCreateKit(ctx, (ownerCtx) =>
			createPermissionCommandKit(this.registry.bus, this.permissions, {
				scopeKey: ownerCtx.pluginInfo?.id ?? this.ctx.pluginInfo?.id ?? 'bot-suite',
				rates: this.rates,
				onRegister: (cmd) => this.registry.registerCommandCleanup(cmd, ownerCtx),
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

		this.ctx.scope.collectEffect(stop)
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
		try {
			const { user, identity } = await this.users.ensureUserForMessage(msg)
			const ctx: ChatbotsCommandContext = { msg, user, identity }
			const dispatched = await this.registry.bus.dispatchDetailed(body, ctx)
			if (!dispatched.matched || this.disposed) return
			const result = dispatched.result
			if (result === undefined) return
			await this.safeReply(msg, result)
		} catch (e) {
			if (e instanceof CommandError) {
				await this.safeReply(msg, e.message)
				return
			}
			const error = e instanceof Error ? e : new Error(String(e))
			this.ctx.logger.warn('command dispatch failed', { error, body })
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
						policy: a.policy,
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
						renderedText: this.renderPartsForMessage(parts, ctx.msg as AnyMessage),
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
