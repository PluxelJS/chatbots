import type { Context } from '@pluxel/hmr'
import type { Config } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { middlewares, WretchPlugin } from 'pluxel-plugin-wretch'
import {
	createCommandRegistry,
	createConversationManager,
	type CommandRegistry,
	type ConversationManager,
} from '../cmd'
import type { MessageSession } from '../types'
import type { TelegramConfigType } from '../config'
import { TelegramBotManager, type TelegramBotPublic } from '../bot-manager'
import { TelegramBotRegistry, type CreateBotInput, type UpdateBotInput } from './bot-registry'
import type { TelegramChannel } from '../events'
import { TelegramSseBridge, type TelegramSnapshot } from './sse'

/**
 * 将 Telegram 插件运行时（命令流水线、SSE、RPC、Bot 管理）集中到一个可测试的 orchestrator。
 * 便于前端/插件侧共享单一的数据源与生命周期。
 */
export class TelegramRuntime {
	/** 共享 HTTP 客户端，供 API/子模块重用 */
	public readonly baseClient: HttpClient

	/** 指令注册表 */
	public readonly commands: CommandRegistry

	/** 对话管理器 */
	public readonly conversations: ConversationManager

	/** 事件通道 */
	public events!: TelegramChannel

	private ctx!: Context
	private config!: Config<TelegramConfigType>
	private manager!: TelegramBotManager
	private repo!: TelegramBotRegistry
	private sseBridge: TelegramSseBridge | null = null

	constructor(wretch: WretchPlugin) {
		this.commands = createCommandRegistry()
		this.conversations = createConversationManager()
		this.baseClient = wretch
			.createClient({
				throwHttpErrors: true,
			})
			.middlewares([
				middlewares.retry({
					maxAttempts: 2,
					retryOnNetworkError: true,
				}),
			])
	}

	async bootstrap(ctx: Context, config: Config<TelegramConfigType>) {
		this.ctx = ctx
		this.config = config

		await this.setupRepoAndManager()
		this.commands.onChange(() => this.syncCommandsToActiveBots())
		this.registerPipelines()
		await this.autoConnectBots()
	}

	async teardown() {
		if (this.manager) {
			await this.manager.disconnectAll()
		}
	}

	/* ======================== Public API（供 RPC/外部调用） ======================== */

	getOverview() {
		return this.manager.getOverview()
	}

	getBotStatuses() {
		return this.manager.getPublicBots()
	}

	getBot(token: string) {
		return this.manager.getBot(token)
	}

	getFirstBot() {
		return this.manager.getFirstBot()
	}

	handleWebhook(token: string, update: unknown, secretToken?: string): boolean {
		return this.manager.handleWebhook(token, update, secretToken)
	}

	async createBot(input: CreateBotInput): Promise<TelegramBotPublic> {
		return this.manager.createBot(input)
	}

	async deleteBot(id: string) {
		return this.manager.deleteBot(id)
	}

	async updateBot(id: string, patch: UpdateBotInput) {
		return this.manager.updateBot(id, patch)
	}

	async connectBot(id: string) {
		const result = await this.manager.connectBot(id)
		await this.syncCommandsToActiveBots()
		return result
	}

	async disconnectBot(id: string) {
		return this.manager.disconnectBot(id)
	}

	snapshot(): TelegramSnapshot {
		return this.sseBridge?.snapshot() ?? { bots: [], overview: this.manager.getOverview(), updatedAt: Date.now() }
	}

	createSseHandler() {
		if (!this.sseBridge) {
			throw new Error('[Telegram] SSE bridge not initialized')
		}
		return this.sseBridge.createHandler()
	}

	/* ======================== Internal wiring ======================== */

	private async setupRepoAndManager() {
		this.repo = new TelegramBotRegistry(this.ctx)
		await this.repo.init()
		this.manager = new TelegramBotManager(this.ctx, this.repo, this.baseClient, this.config.apiBase)
		this.events = this.manager.events
		this.sseBridge = new TelegramSseBridge(this.repo, this.manager)
	}

	private registerPipelines() {
		// 消息处理流水线 - 同步部分处理指令识别，异步部分单独处理
		this.events.message.on((session, next) => {
			const text = (session.message.text ?? session.message.caption ?? '').trim()
			if (!text) return next(session)

			// 检查是否在对话中 - 异步处理
			if (this.conversations.isInConversation(session.userId, session.chatId)) {
				void this.handleConversation(session)
				return undefined
			}

			// 检查是否是指令
			if (text.startsWith('/')) {
				void this.handleCommand(session, text)
				return undefined
			}

			// 不是指令，继续流水线
			return next(session)
		})

		// 注册内置 /cancel 指令
		this.commands.register({
			command: 'cancel',
			description: '取消当前对话',
			handler: async (session) => {
				return this.conversations.cancel(session.userId, session.chatId)
			},
		})
	}

	private async autoConnectBots() {
		if (this.config.autoConnect === false) return
		const bots = this.repo.list(128)
		if (bots.length === 0) return
		await Promise.allSettled(
			bots.map(async (b) => {
				try {
					await this.manager.connectBot(b.id)
				} catch (e) {
					this.ctx.logger.warn(e, `telegram autoConnect failed for ${b.id}`)
				}
			}),
		)
		await this.syncCommandsToActiveBots()
	}

	private async syncCommandsToActiveBots() {
		if (!this.config.syncCommands || !this.manager) return
		const bots = this.manager.getConnectedBots()
		if (bots.length === 0) return

		await Promise.allSettled(
			bots.map(async (bot) => {
				try {
					await this.commands.syncCommands(bot)
				} catch (e) {
					this.ctx.logger.warn(e, 'telegram: 同步指令菜单失败')
				}
			}),
		)
	}

	/** 处理对话消息（异步） */
	private async handleConversation(session: MessageSession): Promise<void> {
		try {
			const result = await this.conversations.handleMessage(session)
			if (result.handled && result.reply) {
				await session.bot.sendMessage(session.chatId, result.reply)
			}
		} catch (e) {
			this.ctx.logger.error(e, 'telegram: 处理对话失败')
		}
	}

	/** 处理指令（异步） */
	private async handleCommand(session: MessageSession, text: string): Promise<void> {
		try {
			// 提取指令名和参数
			const spaceIndex = text.indexOf(' ')
			let cmdPart = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)
			const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim()

			// 处理 /command@botname 格式
			const atIndex = cmdPart.indexOf('@')
			if (atIndex !== -1) {
				cmdPart = cmdPart.slice(0, atIndex)
			}

			const reply = await this.commands.dispatch(cmdPart, args, session)
			if (reply) {
				await session.bot.sendMessage(session.chatId, reply)
			}
		} catch (e) {
			this.ctx.logger.error(e, 'telegram: 执行指令失败')
		}
	}
}

export type { TelegramSnapshot }
