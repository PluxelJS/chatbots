import type { Message, Update } from '@grammyjs/types'
import type { Bot } from '../bot'

/** 通用 Session 结构，类似 KOOK */
export interface Session<T = Update> {
	/** 用户 ID */
	userId: number
	/** 机器人 ID */
	selfId: number
	/** 聊天 ID（群组/私聊/频道） */
	chatId: number
	/** Bot 实例 */
	bot: Bot
	/** 原始 Update 数据 */
	data: T
}

/** 消息 Session */
export interface MessageSession extends Session<Update> {
	/** 消息对象 */
	message: Message
}

/** Update 上下文元数据 */
export interface UpdateMeta {
	botId: string
	updateId: number
}
