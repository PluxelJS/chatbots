import type { Context } from '@pluxel/hmr'

import { registerAllBridges, type BridgeConfig } from './bridge'
import { createBridgeManager } from './bridge/manager'
import { CommandError, createCommandBus } from './cmd'
import { createCommandKit, type CommandKit } from './cmd/kit'
import { createBotEventChannel, dispatchMessage, type BotEventChannel } from './events'
import { createAdapterRegistry } from './platforms/registry'
import { createStatusTracker, type BridgeStatusTracker } from './status'
import type { AnyMessage, MessageContent, Part, Platform } from './types'
import { hasRichParts } from './utils'

export interface BotLayerRuntimeOptions {
	cmdPrefix?: string
	bridges?: BridgeConfig
	debug?: boolean
	devCommands?: boolean
}

type CmdContext = AnyMessage

/**
 * BotLayerRuntime 负责事件通道、桥接、指令以及状态跟踪。
 * BotLayer 插件只做生命周期代理，保持 API 稳定。
 */
export class BotLayerRuntime {
	public readonly events: BotEventChannel
	public readonly status: BridgeStatusTracker
	public readonly bridges = createBridgeManager()
	public readonly adapters = createAdapterRegistry()

	private readonly bus = createCommandBus<CmdContext>({ caseInsensitive: true })
	public readonly cmd: CommandKit<CmdContext>

	private disposed = false

	constructor(private readonly ctx: Context, private readonly options: BotLayerRuntimeOptions) {
		this.events = createBotEventChannel(ctx)
		this.status = createStatusTracker(ctx)
		this.cmd = createCommandKit<CmdContext>(this.bus)
	}

	bootstrap() {
		const debug = Boolean(this.options.debug)
		const dispatch = (msg: AnyMessage) =>
			dispatchMessage(this.events, this.ctx, msg, debug, this.status.markMessage)

		const unregisterBridges = registerAllBridges(
			this.ctx,
			dispatch,
			this.options.bridges,
			this.status,
		)
		this.ctx.scope.collectEffect(unregisterBridges)

		this.registerCommandPipeline()
		this.registerCoreCommands()
		if (this.options.devCommands !== false) {
			this.registerDevCommands()
		}
	}

	teardown() {
		this.disposed = true
	}

	private getCmdPrefix(): string {
		const prefix = (this.options.cmdPrefix ?? '/').trim()
		return prefix || '/'
	}

	private registerCommandPipeline() {
		const prefix = this.getCmdPrefix()
		const prefixLower = prefix.toLowerCase()

		const stop = this.events.text.on((msg) => {
			if (msg.user.isBot) return
			const text = msg.text?.trim() ?? ''
			if (!text) return
			if (!text.toLowerCase().startsWith(prefixLower)) return

			const body = text.slice(prefix.length).trim()
			if (!body) return

			const anyMsg = msg as AnyMessage
			void this.bus
				.dispatch(body, anyMsg)
				.then(async (result) => {
					if (result === undefined || this.disposed) return
					await this.safeReply(anyMsg, result)
				})
				.catch(async (e) => {
					if (e instanceof CommandError) {
						await this.safeReply(anyMsg, e.message)
						return
					}
					this.ctx.logger.warn(e, `bot-layer: 执行指令失败: ${body}`)
				})
		})

		this.ctx.scope.collectEffect(() => stop())
	}

	private async safeReply(msg: AnyMessage, content: unknown) {
		try {
			await msg.reply(content as MessageContent, { quote: true })
		} catch (e) {
			this.ctx.logger.warn(e, 'bot-layer: 自动回复失败')
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
				.action(({ platform }, msg) => {
					const target = String(platform ?? msg.platform)
					const adapters = this.adapters.list().map((a) => ({
						platform: a.name,
						capabilities: a.capabilities,
					}))

					const adapter = this.adapters
						.list()
						.find((a) => String(a.name).toLowerCase() === target.toLowerCase())
					if (!adapter) {
						const names = this.adapters.list().map((a) => a.name).join(', ')
						return `Unknown platform: ${target}. Available: ${names}`
					}

					const snapshot = this.status.snapshot()
					const bridgeStatus = snapshot.bridges.find((b) => b.platform === adapter.name) ?? null
					const hasBridgeDefinition = Boolean(this.bridges.get(adapter.name as Platform))

					return this.buildJsonBlock({
						runtime: {
							cmdPrefix: prefix,
							debug: Boolean(this.options.debug),
							devCommands: this.options.devCommands !== false,
						},
						target: {
							platform: adapter.name,
							capabilities: adapter.capabilities,
							bridgeStatus,
							hasBridgeDefinition,
						},
						registered: {
							adapters,
							bridges: this.bridges.list().map((b) => b.platform),
							status: snapshot,
						},
						message: this.summarizeMessage(msg as AnyMessage),
					})
				})
		})
	}

	private registerDevCommands() {
		this.cmd.group('dev', (cmd) => {
			cmd
				.reg('echo')
				.describe('原样复读当前消息（parts）')
				.action((_argv, msg) => (msg.parts.length ? msg.parts : msg.text || '[empty]'))

			cmd
				.reg('parts')
				.describe('返回解析后的 parts JSON')
				.action((_argv, msg) => this.buildJsonBlock(msg.parts))

			cmd
				.reg('meta')
				.describe('返回基础元信息/附件摘要')
				.action((_argv, msg) => this.buildJsonBlock(this.summarizeMessage(msg)))

			cmd
				.reg('say [...text]')
				.describe('直接回复文本')
				.action(({ text }, _msg) => {
					if (!text?.length) return undefined
					return text.join(' ')
				})
		})
	}
}
