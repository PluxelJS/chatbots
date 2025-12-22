import type { Context } from '@pluxel/hmr'
import { EvtChannel } from '@pluxel/core/services'
import type {
	Update,
	Message,
	CallbackQuery,
	InlineQuery,
	ChosenInlineResult,
	ShippingQuery,
	PreCheckoutQuery,
	Poll,
	PollAnswer,
	ChatMemberUpdated,
	ChatJoinRequest,
	MessageReactionUpdated,
	MessageReactionCountUpdated,
	ChatBoostUpdated,
	ChatBoostRemoved,
} from '@grammyjs/types'
import type { MessageSession, Session, UpdateMeta } from '../types'

/* ======================== Pipeline Types ======================== */

export type MessagePipeline = (
	session: MessageSession,
	next: (session: MessageSession) => string | void,
) => string | void

export type CallbackQueryPipeline = (
	session: Session<Update> & { callbackQuery: CallbackQuery },
	next: (session: Session<Update> & { callbackQuery: CallbackQuery }) => void,
) => void

/* ======================== Event Map ======================== */

export interface TelegramEventMap {
	/** 消息流水线（命令等在此处理） */
	message: MessagePipeline
	/** 回调查询流水线（按钮点击） */
	callbackQuery: CallbackQueryPipeline

	/** 编辑过的消息 */
	editedMessage: (session: MessageSession) => void
	/** 频道帖子 */
	channelPost: (session: MessageSession) => void
	/** 编辑过的频道帖子 */
	editedChannelPost: (session: MessageSession) => void

	/** 内联查询 */
	inlineQuery: (session: Session<Update> & { inlineQuery: InlineQuery }) => void
	/** 选中的内联结果 */
	chosenInlineResult: (session: Session<Update> & { chosenInlineResult: ChosenInlineResult }) => void

	/** 运费查询 */
	shippingQuery: (session: Session<Update> & { shippingQuery: ShippingQuery }) => void
	/** 预付款查询 */
	preCheckoutQuery: (session: Session<Update> & { preCheckoutQuery: PreCheckoutQuery }) => void

	/** 投票 */
	poll: (session: Session<Update> & { poll: Poll }) => void
	/** 投票答案 */
	pollAnswer: (session: Session<Update> & { pollAnswer: PollAnswer }) => void

	/** 我的聊天成员更新 */
	myChatMember: (session: Session<Update> & { myChatMember: ChatMemberUpdated }) => void
	/** 聊天成员更新 */
	chatMember: (session: Session<Update> & { chatMember: ChatMemberUpdated }) => void
	/** 加入请求 */
	chatJoinRequest: (session: Session<Update> & { chatJoinRequest: ChatJoinRequest }) => void

	/** 消息反应更新 */
	messageReaction: (session: Session<Update> & { messageReaction: MessageReactionUpdated }) => void
	/** 消息反应计数更新 */
	messageReactionCount: (session: Session<Update> & { messageReactionCount: MessageReactionCountUpdated }) => void

	/** 聊天 Boost 更新 */
	chatBoost: (session: Session<Update> & { chatBoost: ChatBoostUpdated }) => void
	/** 移除聊天 Boost */
	removedChatBoost: (session: Session<Update> & { removedChatBoost: ChatBoostRemoved }) => void

	/** 原始 Update 事件（任何更新都会触发） */
	update: (update: Update, meta: UpdateMeta) => void
	/** 错误事件 */
	error: (error: unknown, meta?: UpdateMeta) => void
	/** Polling 周期事件 */
	pollCycle: () => void
}

/* ======================== Channel Factory ======================== */

export type TelegramChannel = {
	[K in keyof TelegramEventMap]: EvtChannel<TelegramEventMap[K]>
}

export const createTelegramChannel = (ctx: Context): TelegramChannel => ({
	message: new EvtChannel<TelegramEventMap['message']>(ctx),
	callbackQuery: new EvtChannel<TelegramEventMap['callbackQuery']>(ctx),
	editedMessage: new EvtChannel<TelegramEventMap['editedMessage']>(ctx),
	channelPost: new EvtChannel<TelegramEventMap['channelPost']>(ctx),
	editedChannelPost: new EvtChannel<TelegramEventMap['editedChannelPost']>(ctx),
	inlineQuery: new EvtChannel<TelegramEventMap['inlineQuery']>(ctx),
	chosenInlineResult: new EvtChannel<TelegramEventMap['chosenInlineResult']>(ctx),
	shippingQuery: new EvtChannel<TelegramEventMap['shippingQuery']>(ctx),
	preCheckoutQuery: new EvtChannel<TelegramEventMap['preCheckoutQuery']>(ctx),
	poll: new EvtChannel<TelegramEventMap['poll']>(ctx),
	pollAnswer: new EvtChannel<TelegramEventMap['pollAnswer']>(ctx),
	myChatMember: new EvtChannel<TelegramEventMap['myChatMember']>(ctx),
	chatMember: new EvtChannel<TelegramEventMap['chatMember']>(ctx),
	chatJoinRequest: new EvtChannel<TelegramEventMap['chatJoinRequest']>(ctx),
	messageReaction: new EvtChannel<TelegramEventMap['messageReaction']>(ctx),
	messageReactionCount: new EvtChannel<TelegramEventMap['messageReactionCount']>(ctx),
	chatBoost: new EvtChannel<TelegramEventMap['chatBoost']>(ctx),
	removedChatBoost: new EvtChannel<TelegramEventMap['removedChatBoost']>(ctx),
	update: new EvtChannel<TelegramEventMap['update']>(ctx),
	error: new EvtChannel<TelegramEventMap['error']>(ctx),
	pollCycle: new EvtChannel<TelegramEventMap['pollCycle']>(ctx),
})

export * from './events.types'
