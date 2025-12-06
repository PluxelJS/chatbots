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

/** 消息流水线签名 */
export type MessagePipeline = (
	session: MessageSession,
	next: (session: MessageSession) => string | void,
) => string | void

/** 回调查询流水线签名 */
export type CallbackQueryPipeline = (
	session: Session<Update> & { callbackQuery: CallbackQuery },
	next: (session: Session<Update> & { callbackQuery: CallbackQuery }) => void,
) => void

/* ======================== Update Type Names ======================== */

/** 所有支持的 Update 类型名 */
export const updateTypeNames = [
	'message',
	'edited_message',
	'channel_post',
	'edited_channel_post',
	'inline_query',
	'chosen_inline_result',
	'callback_query',
	'shipping_query',
	'pre_checkout_query',
	'poll',
	'poll_answer',
	'my_chat_member',
	'chat_member',
	'chat_join_request',
	'message_reaction',
	'message_reaction_count',
	'chat_boost',
	'removed_chat_boost',
] as const

export type UpdateTypeName = (typeof updateTypeNames)[number]

/** 从 Update 中提取特定类型 */
export type ExtractUpdateType<T extends UpdateTypeName> = T extends 'message'
	? Message
	: T extends 'edited_message'
		? Message
		: T extends 'channel_post'
			? Message
			: T extends 'edited_channel_post'
				? Message
				: T extends 'inline_query'
					? InlineQuery
					: T extends 'chosen_inline_result'
						? ChosenInlineResult
						: T extends 'callback_query'
							? CallbackQuery
							: T extends 'shipping_query'
								? ShippingQuery
								: T extends 'pre_checkout_query'
									? PreCheckoutQuery
									: T extends 'poll'
										? Poll
										: T extends 'poll_answer'
											? PollAnswer
											: T extends 'my_chat_member'
												? ChatMemberUpdated
												: T extends 'chat_member'
													? ChatMemberUpdated
													: T extends 'chat_join_request'
														? ChatJoinRequest
														: T extends 'message_reaction'
															? MessageReactionUpdated
															: T extends 'message_reaction_count'
																? MessageReactionCountUpdated
																: T extends 'chat_boost'
																	? ChatBoostUpdated
																	: T extends 'removed_chat_boost'
																		? ChatBoostRemoved
																		: never
