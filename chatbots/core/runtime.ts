import type { Context } from '@pluxel/hmr'

import { MikroOrm } from 'pluxel-plugin-mikro-orm'

import { CommandError, createCommandBus } from '../bot-layer/cmd'
import { createCommandKit, type CommandKit } from '../bot-layer/cmd/kit'
import type { BotLayer } from '../bot-layer/bot-layer'
import type { AnyMessage, MessageContent, Part } from '../bot-layer/types'
import { hasRichParts } from '../bot-layer/utils'

import { UserDirectory } from './db/user-directory'
import { PermissionService } from '../permissions/service'
import { withPermissions, type CommandKit as PermCommandKit } from './cmd/perms'
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
		this.cmd = withPermissions(createCommandKit<ChatbotsCommandContext>(this.bus), this.permissions)
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
			const text = msg.text?.trim() ?? ''
			if (!text) return
			if (!text.toLowerCase().startsWith(prefixLower)) return

			const body = text.slice(prefix.length).trim()
			if (!body) return

			void this.dispatchCommand(body, msg as AnyMessage)
		})

		this.ctx.scope.collectEffect(() => stop())
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

	private formatHelp(prefix: string): string {
		const raw = this.cmd.help()
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

	private registerCoreCommands() {
		const prefix = this.getCmdPrefix()

		this.cmd.group('core', (cmd) => {
			cmd
				.reg('help [command]')
				.describe('查看帮助')
				.action(({ command }) => {
					if (!command) return this.formatHelp(prefix)
					const found = this.findCommand(command)
					if (!found) return `Unknown command: ${command}\n\n${this.formatHelp(prefix)}`
					return `${prefix}${found.toUsage()}`
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
				.reg('parts')
				.describe('返回解析后的 parts JSON')
				.action((_argv, ctx) => this.buildJsonBlock(ctx.msg.parts))

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
