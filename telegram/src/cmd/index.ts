import type { BotCommand } from '@grammyjs/types'
import type { Bot } from '../bot'
import type { MessageSession } from '../types'

/* ======================== Command Types ======================== */

export type Awaitable<T> = T | Promise<T>

/** 指令处理函数 */
export type CommandHandler = (
	session: MessageSession,
	args: string,
) => Awaitable<string | void>

/** 指令定义 */
export interface CommandDef {
	/** 指令名（不含 /） */
	command: string
	/** 描述（显示在指令菜单中） */
	description: string
	/** 处理函数 */
	handler: CommandHandler
}

/** 已注册的指令 */
interface RegisteredCommand extends CommandDef {
	/** 注销函数 */
	unregister: () => void
}

/* ======================== Command Registry ======================== */

export interface CommandRegistry {
	/** 注册指令 */
	register(def: CommandDef): () => void
	/** 批量注册 */
	registerAll(defs: CommandDef[]): () => void
	/** 获取所有指令（用于 setMyCommands） */
	getCommands(): BotCommand[]
	/** 分发指令 */
	dispatch(command: string, args: string, session: MessageSession): Promise<string | void>
	/** 同步指令到 Telegram */
	syncCommands(bot: Bot): Promise<void>
}

export function createCommandRegistry(): CommandRegistry {
	const commands = new Map<string, RegisteredCommand>()

	return {
		register(def: CommandDef) {
			const cmd = def.command.toLowerCase()
			const registered: RegisteredCommand = {
				...def,
				command: cmd,
				unregister: () => {
					commands.delete(cmd)
				},
			}
			commands.set(cmd, registered)
			return registered.unregister
		},

		registerAll(defs: CommandDef[]) {
			const unregisters = defs.map((d) => this.register(d))
			return () => unregisters.forEach((fn) => fn())
		},

		getCommands(): BotCommand[] {
			return Array.from(commands.values()).map((c) => ({
				command: c.command,
				description: c.description,
			}))
		},

		async dispatch(command: string, args: string, session: MessageSession) {
			const cmd = commands.get(command.toLowerCase())
			if (!cmd) return undefined
			return cmd.handler(session, args)
		},

		async syncCommands(bot: Bot) {
			const cmds = this.getCommands()
			if (cmds.length === 0) return
			await bot.setMyCommands({ commands: cmds })
		},
	}
}

/* ======================== Conversation State ======================== */

/** 对话状态 */
export interface ConversationState<T = unknown> {
	/** 当前步骤 */
	step: string
	/** 用户数据 */
	data: T
	/** 超时时间戳 */
	expiresAt: number
}

/** 对话步骤处理函数 */
export type StepHandler<T = unknown> = (
	session: MessageSession,
	state: ConversationState<T>,
) => Awaitable<{ nextStep?: string; data?: Partial<T>; reply?: string } | void>

/** 对话定义 */
export interface ConversationDef<T = unknown> {
	/** 对话 ID */
	id: string
	/** 初始步骤 */
	initialStep: string
	/** 超时时间（毫秒），默认 5 分钟 */
	timeoutMs?: number
	/** 步骤处理器 */
	steps: Record<string, StepHandler<T>>
	/** 超时回调 */
	onTimeout?: (session: MessageSession, state: ConversationState<T>) => Awaitable<string | void>
	/** 取消回调 */
	onCancel?: (session: MessageSession, state: ConversationState<T>) => Awaitable<string | void>
}

/* ======================== Conversation Manager ======================== */

export interface ConversationManager {
	/** 注册对话 */
	register<T>(def: ConversationDef<T>): () => void
	/** 开始对话 */
	start<T>(conversationId: string, session: MessageSession, initialData?: T): Promise<string | void>
	/** 处理消息（如果在对话中） */
	handleMessage(session: MessageSession): Promise<{ handled: boolean; reply?: string }>
	/** 取消对话 */
	cancel(userId: number, chatId: number): Promise<string | void>
	/** 检查是否在对话中 */
	isInConversation(userId: number, chatId: number): boolean
}

export function createConversationManager(): ConversationManager {
	const conversations = new Map<string, ConversationDef<any>>()
	// key: `${userId}:${chatId}`
	const activeStates = new Map<string, { conversationId: string; state: ConversationState<any> }>()

	const getKey = (userId: number, chatId: number) => `${userId}:${chatId}`

	const cleanupExpired = () => {
		const now = Date.now()
		for (const [key, active] of activeStates) {
			if (active.state.expiresAt < now) {
				activeStates.delete(key)
			}
		}
	}

	// 定期清理过期对话
	const cleanupTimer = setInterval(cleanupExpired, 60000)
	cleanupTimer.unref?.()

	return {
		register<T>(def: ConversationDef<T>) {
			conversations.set(def.id, def)
			return () => {
				conversations.delete(def.id)
			}
		},

		async start<T>(conversationId: string, session: MessageSession, initialData?: T): Promise<string | void> {
			const def = conversations.get(conversationId)
			if (!def) throw new Error(`Conversation not found: ${conversationId}`)

			const key = getKey(session.userId, session.chatId)
			const state: ConversationState<T> = {
				step: def.initialStep,
				data: (initialData ?? {}) as T,
				expiresAt: Date.now() + (def.timeoutMs ?? 300000),
			}

			activeStates.set(key, { conversationId, state })

			// 执行初始步骤
			const handler = def.steps[state.step]
			if (handler) {
				const result = await handler(session, state)
				if (result?.nextStep) state.step = result.nextStep
				if (result?.data) Object.assign(state.data as object, result.data)
				return result?.reply
			}
			return undefined
		},

		async handleMessage(session: MessageSession) {
			const key = getKey(session.userId, session.chatId)
			const active = activeStates.get(key)

			if (!active) return { handled: false }

			const def = conversations.get(active.conversationId)
			if (!def) {
				activeStates.delete(key)
				return { handled: false }
			}

			// 检查超时
			if (active.state.expiresAt < Date.now()) {
				activeStates.delete(key)
				if (def.onTimeout) {
					const reply = await def.onTimeout(session, active.state)
					return { handled: true, reply: reply ?? undefined }
				}
				return { handled: true, reply: '对话已超时，请重新开始。' }
			}

			// 执行当前步骤
			const handler = def.steps[active.state.step]
			if (!handler) {
				activeStates.delete(key)
				return { handled: false }
			}

			const result = await handler(session, active.state)

			if (result?.data) {
				Object.assign(active.state.data as object, result.data)
			}

			if (result?.nextStep) {
				active.state.step = result.nextStep
				// 刷新超时
				active.state.expiresAt = Date.now() + (def.timeoutMs ?? 300000)
			} else if (result?.nextStep === undefined && result?.reply) {
				// 有回复但没指定下一步，结束对话
				activeStates.delete(key)
			}

			return { handled: true, reply: result?.reply }
		},

		async cancel(userId: number, chatId: number) {
			const key = getKey(userId, chatId)
			const active = activeStates.get(key)

			if (!active) return undefined

			const def = conversations.get(active.conversationId)
			activeStates.delete(key)

			if (def?.onCancel) {
				return def.onCancel({ userId, chatId } as MessageSession, active.state)
			}
			return '对话已取消。'
		},

		isInConversation(userId: number, chatId: number) {
			const key = getKey(userId, chatId)
			const active = activeStates.get(key)
			if (!active) return false
			if (active.state.expiresAt < Date.now()) {
				activeStates.delete(key)
				return false
			}
			return true
		},
	}
}
