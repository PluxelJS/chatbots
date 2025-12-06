import type { Context } from '@pluxel/hmr'
import type { Update, Message } from '@grammyjs/types'
import type { Bot } from '../bot'
import type { TelegramChannel } from '../events'
import type { MessageSession, Session, UpdateMeta } from '../types'

/**
 * 将 Telegram Update 分发到对应的 EvtChannel
 */
export function dispatchUpdate(
	events: TelegramChannel,
	ctx: Context,
	bot: Bot,
	update: Update,
) {
	const meta: UpdateMeta = {
		botId: bot.token,
		updateId: update.update_id,
	}

	// 先触发原始 update 事件
	events.update.emit(update, meta)

	// 消息处理
	if (update.message) {
		const session = createMessageSession(bot, update, update.message)

		// 流水线处理（支持 next 语义）
		const result = events.message.waterfall(session)
		if (result.value) {
			void bot
				.sendMessage(session.chatId, result.value)
				.catch((e: unknown) => ctx.logger.error(e, 'telegram: message 监听器返回的信息发送失败。'))
		}
		return
	}

	// 编辑过的消息
	if (update.edited_message) {
		const session = createMessageSession(bot, update, update.edited_message)
		events.editedMessage.emit(session)
		return
	}

	// 频道帖子
	if (update.channel_post) {
		const session = createMessageSession(bot, update, update.channel_post)
		events.channelPost.emit(session)
		return
	}

	// 编辑过的频道帖子
	if (update.edited_channel_post) {
		const session = createMessageSession(bot, update, update.edited_channel_post)
		events.editedChannelPost.emit(session)
		return
	}

	// 回调查询（按钮点击）
	if (update.callback_query) {
		const session = createSession(bot, update) as Session<Update> & { callbackQuery: typeof update.callback_query }
		session.callbackQuery = update.callback_query
		if (update.callback_query.from) {
			session.userId = update.callback_query.from.id
		}
		if (update.callback_query.message && 'chat' in update.callback_query.message) {
			session.chatId = update.callback_query.message.chat.id
		}
		events.callbackQuery.waterfall(session)
		return
	}

	// 内联查询
	if (update.inline_query) {
		const session = createSession(bot, update) as Session<Update> & { inlineQuery: typeof update.inline_query }
		session.inlineQuery = update.inline_query
		session.userId = update.inline_query.from.id
		events.inlineQuery.emit(session)
		return
	}

	// 选中的内联结果
	if (update.chosen_inline_result) {
		const session = createSession(bot, update) as Session<Update> & { chosenInlineResult: typeof update.chosen_inline_result }
		session.chosenInlineResult = update.chosen_inline_result
		session.userId = update.chosen_inline_result.from.id
		events.chosenInlineResult.emit(session)
		return
	}

	// 运费查询
	if (update.shipping_query) {
		const session = createSession(bot, update) as Session<Update> & { shippingQuery: typeof update.shipping_query }
		session.shippingQuery = update.shipping_query
		session.userId = update.shipping_query.from.id
		events.shippingQuery.emit(session)
		return
	}

	// 预付款查询
	if (update.pre_checkout_query) {
		const session = createSession(bot, update) as Session<Update> & { preCheckoutQuery: typeof update.pre_checkout_query }
		session.preCheckoutQuery = update.pre_checkout_query
		session.userId = update.pre_checkout_query.from.id
		events.preCheckoutQuery.emit(session)
		return
	}

	// 投票
	if (update.poll) {
		const session = createSession(bot, update) as Session<Update> & { poll: typeof update.poll }
		session.poll = update.poll
		events.poll.emit(session)
		return
	}

	// 投票答案
	if (update.poll_answer) {
		const session = createSession(bot, update) as Session<Update> & { pollAnswer: typeof update.poll_answer }
		session.pollAnswer = update.poll_answer
		if (update.poll_answer.user) {
			session.userId = update.poll_answer.user.id
		}
		events.pollAnswer.emit(session)
		return
	}

	// 我的聊天成员更新
	if (update.my_chat_member) {
		const session = createSession(bot, update) as Session<Update> & { myChatMember: typeof update.my_chat_member }
		session.myChatMember = update.my_chat_member
		session.userId = update.my_chat_member.from.id
		session.chatId = update.my_chat_member.chat.id
		events.myChatMember.emit(session)
		return
	}

	// 聊天成员更新
	if (update.chat_member) {
		const session = createSession(bot, update) as Session<Update> & { chatMember: typeof update.chat_member }
		session.chatMember = update.chat_member
		session.userId = update.chat_member.from.id
		session.chatId = update.chat_member.chat.id
		events.chatMember.emit(session)
		return
	}

	// 加入请求
	if (update.chat_join_request) {
		const session = createSession(bot, update) as Session<Update> & { chatJoinRequest: typeof update.chat_join_request }
		session.chatJoinRequest = update.chat_join_request
		session.userId = update.chat_join_request.from.id
		session.chatId = update.chat_join_request.chat.id
		events.chatJoinRequest.emit(session)
		return
	}

	// 消息反应更新
	if (update.message_reaction) {
		const session = createSession(bot, update) as Session<Update> & { messageReaction: typeof update.message_reaction }
		session.messageReaction = update.message_reaction
		if (update.message_reaction.user) {
			session.userId = update.message_reaction.user.id
		}
		session.chatId = update.message_reaction.chat.id
		events.messageReaction.emit(session)
		return
	}

	// 消息反应计数更新
	if (update.message_reaction_count) {
		const session = createSession(bot, update) as Session<Update> & { messageReactionCount: typeof update.message_reaction_count }
		session.messageReactionCount = update.message_reaction_count
		session.chatId = update.message_reaction_count.chat.id
		events.messageReactionCount.emit(session)
		return
	}

	// 聊天 Boost 更新
	if (update.chat_boost) {
		const session = createSession(bot, update) as Session<Update> & { chatBoost: typeof update.chat_boost }
		session.chatBoost = update.chat_boost
		session.chatId = update.chat_boost.chat.id
		events.chatBoost.emit(session)
		return
	}

	// 移除聊天 Boost
	if (update.removed_chat_boost) {
		const session = createSession(bot, update) as Session<Update> & { removedChatBoost: typeof update.removed_chat_boost }
		session.removedChatBoost = update.removed_chat_boost
		session.chatId = update.removed_chat_boost.chat.id
		events.removedChatBoost.emit(session)
		return
	}
}

/** 创建基础 Session */
function createSession(bot: Bot, update: Update): Session<Update> {
	return {
		userId: 0,
		selfId: bot.selfInfo?.id ?? 0,
		chatId: 0,
		bot,
		data: update,
	}
}

/** 创建消息 Session */
function createMessageSession(bot: Bot, update: Update, message: Message): MessageSession {
	return {
		userId: message.from?.id ?? 0,
		selfId: bot.selfInfo?.id ?? 0,
		chatId: message.chat.id,
		bot,
		data: update,
		message,
	}
}
