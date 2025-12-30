import type {
	DeleteMessageArgs,
	EditMessageTextArgs,
	MethodReturn,
	Result,
	SendAnimationArgs,
	SendChatActionArgs,
	SendDocumentArgs,
	SendMessageArgs,
	SendMessageOptions,
	SendPhotoArgs,
	TelegramApi,
	TelegramApiTools,
	TelegramConversation,
} from './types'

export function createTelegramTools(api: TelegramApi): TelegramApiTools {
	return {
		createMessageBuilder: (chatId, defaults) => makeChatSession(api, chatId, defaults).send,
		createConversation: (chatId, defaults) => makeChatSession(api, chatId, defaults),
	}
}

function makeChatSession(
	api: TelegramApi,
	chatId: SendMessageArgs['chat_id'],
	defaults?: Partial<SendMessageOptions>,
): TelegramConversation {
	const baseDefaults = defaults ? { ...defaults } : undefined
	let trackedId: number | undefined

	const mergeSendOptions = (options?: Partial<SendMessageOptions>) => {
		if (!baseDefaults) return options
		if (!options) return baseDefaults
		return { ...baseDefaults, ...options }
	}

	const send: TelegramConversation['send'] = async (text, options) => {
		const merged = mergeSendOptions(options)
		const res = await api.sendMessage({
			chat_id: chatId,
			text,
			...(merged ?? {}),
		} as SendMessageArgs)
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const reply: TelegramConversation['reply'] = async (toMessageId, text, options) => {
		const merged = mergeSendOptions(options)
		const replyParameters = merged?.reply_parameters
			? { ...(merged.reply_parameters as Record<string, unknown>), message_id: toMessageId }
			: { message_id: toMessageId }

		const res = await api.sendMessage({
			chat_id: chatId,
			text,
			...(merged ?? {}),
			reply_parameters: replyParameters,
		} as SendMessageArgs)
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const edit: TelegramConversation['edit'] = async (messageId, text, options) => {
		return api.editMessageText({
			chat_id: chatId,
			message_id: messageId,
			text,
			...(options ?? {}),
		} as EditMessageTextArgs)
	}

	const editLast: TelegramConversation['editLast'] = async (text, options) => {
		if (!trackedId) return missingTracked()
		return edit(trackedId, text, options)
	}

	const deleteMessage: TelegramConversation['delete'] = async (messageId) => {
		return api.deleteMessage({ chat_id: chatId, message_id: messageId } as DeleteMessageArgs)
	}

	const deleteLast: TelegramConversation['deleteLast'] = async () => {
		if (!trackedId) return missingTracked()
		return deleteMessage(trackedId)
	}

	const sendPhoto: TelegramConversation['sendPhoto'] = async (photo, options) => {
		const res = await api.sendPhoto({
			chat_id: chatId,
			photo,
			...(options ?? {}),
		} as SendPhotoArgs)
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const sendDocument: TelegramConversation['sendDocument'] = async (document, options) => {
		const res = await api.sendDocument({
			chat_id: chatId,
			document,
			...(options ?? {}),
		} as SendDocumentArgs)
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const sendAnimation: TelegramConversation['sendAnimation'] = async (animation, options) => {
		const res = await api.sendAnimation({
			chat_id: chatId,
			animation,
			...(options ?? {}),
		} as SendAnimationArgs)
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const typing: TelegramConversation['typing'] = async (action = 'typing', options) => {
		return api.sendChatAction({
			chat_id: chatId,
			action,
			...(options ?? {}),
		} as SendChatActionArgs)
	}

	const upsert: TelegramConversation['upsert'] = async (text, options) => {
		if (trackedId) {
			const res = await api.editMessageText({
				chat_id: chatId,
				message_id: trackedId,
				text,
				...(options ?? {}),
			} as EditMessageTextArgs)
			if (res.ok) return res as unknown as Result<MethodReturn<'sendMessage'> | MethodReturn<'editMessageText'>>
			trackedId = undefined
		}

		const res = await send(text, options)
		return res as unknown as Result<MethodReturn<'sendMessage'> | MethodReturn<'editMessageText'>>
	}

	const transient: TelegramConversation['transient'] = async (text, options, ttlMs = 5000) => {
		const res = await send(text, options)
		const msgId = res.ok ? (res.data as any)?.message_id : undefined
		if (res.ok && typeof msgId === 'number' && ttlMs > 0) {
			scheduleDelete(() => deleteMessage(msgId), ttlMs)
		}
		return res
	}

	const track: TelegramConversation['track'] = (messageId) => {
		trackedId = typeof messageId === 'number' && messageId > 0 ? messageId : undefined
		return trackedId
	}

	const withDefaults: TelegramConversation['withDefaults'] = (overrides) => {
		const next = makeChatSession(api, chatId, { ...baseDefaults, ...overrides })
		if (trackedId) next.track(trackedId)
		return next
	}

	return {
		chatId,
		defaults: baseDefaults,
		get lastMessageId() {
			return trackedId
		},
		send,
		reply,
		edit,
		editLast,
		delete: deleteMessage,
		deleteLast,
		sendPhoto,
		sendDocument,
		sendAnimation,
		typing,
		upsert,
		transient,
		track,
		withDefaults,
	}
}

function missingTracked(): Promise<Result<any>> {
	return Promise.resolve({ ok: false, code: -404, message: 'No tracked message to operate on' })
}

function scheduleDelete(task: () => Promise<unknown>, ttlMs: number) {
	const timer = setTimeout(() => {
		void task().catch(() => {})
	}, ttlMs)
	;(timer as any).unref?.()
}
