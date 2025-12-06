import type { HttpClient } from 'pluxel-plugin-wretch'
import type {
	Methods,
	ApiMethodName,
	ChatSession,
	HttpMethod,
	JsonLike,
	MethodArgs,
	MethodReturn,
	Result,
	SendMessageOptions,
	TelegramApi,
	TelegramApiOptions,
	TelegramRequest,
} from './types'

export function createTelegramApi(http: HttpClient, options?: TelegramApiOptions): TelegramApi {
	const request = createTelegramRequest(http, options)
	return buildTelegramApi(request)
}

export function createTelegramRequest(http: HttpClient, options?: TelegramApiOptions): TelegramRequest {
	const apiBase = (options?.apiBase ?? 'https://api.telegram.org').trim() || 'https://api.telegram.org'
	const baseWithToken =
		(options?.token != null
			? `${apiBase.replace(/\/+$/, '')}/bot${options.token}`
			: apiBase.replace(/\/+$/, '')) + '/'

	return <T>(method: HttpMethod, apiMethod: string, payload?: JsonLike) => {
		const path = apiMethod.replace(/^\/+/, '')
		const url = `${baseWithToken}${path}`
		return requestWithClient<T>(http, method, url, payload)
	}
}

function buildTelegramApi(request: TelegramRequest): TelegramApi {
	type P<K extends keyof Methods> = MethodArgs<K>
	type R<K extends keyof Methods> = MethodReturn<K>

	const api: Partial<TelegramApi> = {
		/** 发送消息 */
		sendMessage: (chatId: P<'sendMessage'>['chat_id'], text: P<'sendMessage'>['text'], options?: Omit<P<'sendMessage'>, 'chat_id' | 'text'>): Promise<Result<R<'sendMessage'>>> =>
			request<R<'sendMessage'>>('POST', 'sendMessage', { chat_id: chatId, text, ...options }),

		/** 创建消息构建器 */
		createMessageBuilder: (chatId: P<'sendMessage'>['chat_id'], defaults?: Omit<P<'sendMessage'>, 'chat_id' | 'text'>) =>
			makeChatSession(chatId, request, defaults).send,

		/** 会话级 builder，封装常用 send/edit/delete/typing/upsert 操作 */
		createChatSession: (chatId, defaults) => makeChatSession(chatId, request, defaults),

		/** 转发消息 */
		forwardMessage: (
			chatId: P<'forwardMessage'>['chat_id'],
			fromChatId: P<'forwardMessage'>['from_chat_id'],
			messageId: P<'forwardMessage'>['message_id'],
			options?: Omit<P<'forwardMessage'>, 'chat_id' | 'from_chat_id' | 'message_id'>,
		): Promise<Result<R<'forwardMessage'>>> =>
			request<R<'forwardMessage'>>('POST', 'forwardMessage', {
				chat_id: chatId,
				from_chat_id: fromChatId,
				message_id: messageId,
				...options,
		}),

		/** 编辑消息文本 */
		editMessageText: (text: P<'editMessageText'>['text'], options: Omit<P<'editMessageText'>, 'text'>): Promise<Result<R<'editMessageText'>>> =>
			request<R<'editMessageText'>>('POST', 'editMessageText', { text, ...options }),

		/** 删除消息 */
		deleteMessage: (chatId: P<'deleteMessage'>['chat_id'], messageId: P<'deleteMessage'>['message_id']): Promise<Result<R<'deleteMessage'>>> =>
			request<R<'deleteMessage'>>('POST', 'deleteMessage', { chat_id: chatId, message_id: messageId }),

		/** 发送照片 */
		sendPhoto: (chatId: P<'sendPhoto'>['chat_id'], photo: P<'sendPhoto'>['photo'], options?: Omit<P<'sendPhoto'>, 'chat_id' | 'photo'>): Promise<Result<R<'sendPhoto'>>> =>
			request<R<'sendPhoto'>>('POST', 'sendPhoto', { chat_id: chatId, photo, ...options }),

		/** 发送文档 */
		sendDocument: (chatId: P<'sendDocument'>['chat_id'], document: P<'sendDocument'>['document'], options?: Omit<P<'sendDocument'>, 'chat_id' | 'document'>): Promise<Result<R<'sendDocument'>>> =>
			request<R<'sendDocument'>>('POST', 'sendDocument', { chat_id: chatId, document, ...options }),

		/** 回复回调查询 */
		answerCallbackQuery: (
			callbackQueryId: P<'answerCallbackQuery'>['callback_query_id'],
			options?: Omit<P<'answerCallbackQuery'>, 'callback_query_id'>,
		): Promise<Result<R<'answerCallbackQuery'>>> =>
			request<R<'answerCallbackQuery'>>('POST', 'answerCallbackQuery', { callback_query_id: callbackQueryId, ...options }),

		/** 设置 Webhook */
		setWebhook: (url: P<'setWebhook'>['url'], options?: Omit<P<'setWebhook'>, 'url'>): Promise<Result<R<'setWebhook'>>> =>
			request<R<'setWebhook'>>('POST', 'setWebhook', { url, ...options }),

		/** 删除 Webhook */
		deleteWebhook: (options?: P<'deleteWebhook'>): Promise<Result<R<'deleteWebhook'>>> =>
			request<R<'deleteWebhook'>>('POST', 'deleteWebhook', options),

		/** 获取 Webhook 信息 */
		getWebhookInfo: (): Promise<Result<R<'getWebhookInfo'>>> => request<R<'getWebhookInfo'>>('GET', 'getWebhookInfo'),

		/** 获取更新（用于 polling） */
		getUpdates: (options?: P<'getUpdates'>): Promise<Result<R<'getUpdates'>>> =>
			request<R<'getUpdates'>>('POST', 'getUpdates', options),
	}

	const define = defineResult(api, request)

	// Getting updates
	define('getMe', 'GET')

	// Updating messages
	define('editMessageCaption', 'POST')
	define('editMessageMedia', 'POST')
	define('editMessageReplyMarkup', 'POST')
	define('stopPoll', 'POST')

	// Stickers
	define('sendSticker', 'POST')
	define('getStickerSet', 'GET')
	define('getCustomEmojiStickers', 'POST')
	define('uploadStickerFile', 'POST')
	define('createNewStickerSet', 'POST')
	define('addStickerToSet', 'POST')
	define('setStickerPositionInSet', 'POST')
	define('deleteStickerFromSet', 'POST')
	define('replaceStickerInSet', 'POST')
	define('setStickerEmojiList', 'POST')
	define('setStickerKeywords', 'POST')
	define('setStickerMaskPosition', 'POST')
	define('setStickerSetTitle', 'POST')
	define('setStickerSetThumbnail', 'POST')
	define('setCustomEmojiStickerSetThumbnail', 'POST')
	define('deleteStickerSet', 'POST')

	// Inline mode
	define('answerInlineQuery', 'POST')
	define('answerWebAppQuery', 'POST')

	// Payments
	define('sendInvoice', 'POST')
	define('createInvoiceLink', 'POST')
	define('answerShippingQuery', 'POST')
	define('answerPreCheckoutQuery', 'POST')

	// Games
	define('sendGame', 'POST')
	define('setGameScore', 'POST')
	define('getGameHighScores', 'GET')

	// Sending other content
	define('sendAudio', 'POST')
	define('sendVideo', 'POST')
	define('sendAnimation', 'POST')
	define('sendVoice', 'POST')
	define('sendVideoNote', 'POST')
	define('sendMediaGroup', 'POST')
	define('sendLocation', 'POST')
	define('sendVenue', 'POST')
	define('sendContact', 'POST')
	define('sendPoll', 'POST')
	define('sendDice', 'POST')
	define('sendChatAction', 'POST')

	// Chat management
	define('getChat', 'GET')
	define('getChatAdministrators', 'GET')
	define('getChatMemberCount', 'GET')
	define('getChatMember', 'GET')
	define('setChatPhoto', 'POST')
	define('deleteChatPhoto', 'POST')
	define('setChatTitle', 'POST')
	define('setChatDescription', 'POST')
	define('pinChatMessage', 'POST')
	define('unpinChatMessage', 'POST')
	define('unpinAllChatMessages', 'POST')
	define('leaveChat', 'POST')
	define('setChatPermissions', 'POST')
	define('exportChatInviteLink', 'POST')
	define('createChatInviteLink', 'POST')
	define('editChatInviteLink', 'POST')
	define('revokeChatInviteLink', 'POST')
	define('approveChatJoinRequest', 'POST')
	define('declineChatJoinRequest', 'POST')
	define('setChatAdministratorCustomTitle', 'POST')
	define('banChatSenderChat', 'POST')
	define('unbanChatSenderChat', 'POST')

	// Chat member management
	define('banChatMember', 'POST')
	define('unbanChatMember', 'POST')
	define('restrictChatMember', 'POST')
	define('promoteChatMember', 'POST')

	// Forum topics
	define('getForumTopicIconStickers', 'GET')
	define('createForumTopic', 'POST')
	define('editForumTopic', 'POST')
	define('closeForumTopic', 'POST')
	define('reopenForumTopic', 'POST')
	define('deleteForumTopic', 'POST')
	define('unpinAllForumTopicMessages', 'POST')
	define('editGeneralForumTopic', 'POST')
	define('closeGeneralForumTopic', 'POST')
	define('reopenGeneralForumTopic', 'POST')
	define('hideGeneralForumTopic', 'POST')
	define('unhideGeneralForumTopic', 'POST')
	define('unpinAllGeneralForumTopicMessages', 'POST')

	// User & bot info
	define('getUserProfilePhotos', 'GET')
	define('getFile', 'GET')
	define('setMyCommands', 'POST')
	define('deleteMyCommands', 'POST')
	define('getMyCommands', 'GET')
	define('setMyName', 'POST')
	define('getMyName', 'GET')
	define('setMyDescription', 'POST')
	define('getMyDescription', 'GET')
	define('setMyShortDescription', 'POST')
	define('getMyShortDescription', 'GET')
	define('setChatMenuButton', 'POST')
	define('getChatMenuButton', 'GET')
	define('setMyDefaultAdministratorRights', 'POST')
	define('getMyDefaultAdministratorRights', 'GET')

	// Copying messages
	define('copyMessage', 'POST')
	define('copyMessages', 'POST')
	define('forwardMessages', 'POST')

	// Message reactions
	define('setMessageReaction', 'POST')

	// Chat boost
	define('getUserChatBoosts', 'GET')

	// Business
	define('getBusinessConnection', 'GET')

	return api as TelegramApi
}

/* ----------------------------- Helpers ----------------------------- */

type JsonChain = { json(): Promise<unknown> }
type RequestBuilder = {
	get(): JsonChain
	post(b?: BodyInit | JsonLike): JsonChain
}

interface TelegramResponse<T> {
	ok: boolean
	result?: T
	description?: string
	error_code?: number
}

function requestWithClient<T>(
	http: HttpClient,
	method: HttpMethod,
	apiMethod: string,
	payload?: JsonLike,
): Promise<Result<T>> {
	const url =
		method === 'GET' && isPlainObject(payload)
			? appendQuery(apiMethod, payload as Record<string, unknown>)
			: apiMethod
	const req = (http as any).url ? ((http as any).url(url) as RequestBuilder) : ((http as any) as RequestBuilder)

	let rc: JsonChain
	if (method === 'GET') {
		rc = req.get()
	} else {
		rc = req.post(payload)
	}

	return rc
		.json()
		.then((raw) => {
			const res = raw as TelegramResponse<T>
			return res.ok && res.result !== undefined
				? { ok: true, data: res.result }
				: { ok: false, code: res.error_code ?? -1, message: res.description || 'Unexpected Error' }
		})
		.catch((e: unknown) => ({
			ok: false,
			code: normalizeErrCode(e),
			message: normalizeErrMsg(e),
		})) as Promise<Result<T>>
}

function makeChatSession(
	chatId: MethodArgs<'sendMessage'>['chat_id'],
	request: TelegramRequest,
	defaults?: Partial<SendMessageOptions>,
): ChatSession {
	const baseDefaults = defaults ? { ...defaults } : undefined
	let trackedId: number | undefined

	const mergeSendOptions = (options?: Partial<SendMessageOptions>) =>
		baseDefaults || options ? { ...baseDefaults, ...options } : undefined

	const send: ChatSession['send'] = async (text, options) => {
		const merged = mergeSendOptions(options)
		const res = await request<MethodReturn<'sendMessage'>>('POST', 'sendMessage', {
			chat_id: chatId,
			text,
			...(merged ?? {}),
		})
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const reply: ChatSession['reply'] = async (toMessageId, text, options) => {
		const merged = mergeSendOptions(options)
		const replyParameters =
			merged?.reply_parameters || options?.reply_parameters
				? {
						...(merged?.reply_parameters as Record<string, unknown>),
						...(options?.reply_parameters as Record<string, unknown>),
						message_id: toMessageId,
					}
				: { message_id: toMessageId }

		const res = await request<MethodReturn<'sendMessage'>>('POST', 'sendMessage', {
			chat_id: chatId,
			text,
			...(merged ?? {}),
			reply_parameters: replyParameters,
		})
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const edit: ChatSession['edit'] = (messageId, text, options) =>
		request<MethodReturn<'editMessageText'>>('POST', 'editMessageText', {
			chat_id: chatId,
			message_id: messageId,
			text,
			...options,
		})

	const editLast: ChatSession['editLast'] = (text, options) => {
		if (!trackedId) return missingTracked('edit')
		return edit(trackedId, text, options)
	}

	const del: ChatSession['delete'] = (messageId) =>
		request<MethodReturn<'deleteMessage'>>('POST', 'deleteMessage', {
			chat_id: chatId,
			message_id: messageId,
		})

	const deleteLast: ChatSession['deleteLast'] = () => {
		if (!trackedId) return missingTracked('delete')
		return del(trackedId)
	}

	const typing: ChatSession['typing'] = (action = 'typing', options) =>
		request<MethodReturn<'sendChatAction'>>('POST', 'sendChatAction', {
			chat_id: chatId,
			action,
			...options,
		})

	const sendPhoto: ChatSession['sendPhoto'] = async (photo, options) => {
		const res = await request<MethodReturn<'sendPhoto'>>('POST', 'sendPhoto', {
			chat_id: chatId,
			photo,
			...options,
		})
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const sendDocument: ChatSession['sendDocument'] = async (document, options) => {
		const res = await request<MethodReturn<'sendDocument'>>('POST', 'sendDocument', {
			chat_id: chatId,
			document,
			...options,
		})
		if (res.ok && typeof (res.data as any)?.message_id === 'number') {
			trackedId = (res.data as any).message_id
		}
		return res
	}

	const upsert: ChatSession['upsert'] = async (text, options) => {
		if (trackedId) {
			const res = await edit(trackedId, text, options)
			if (res.ok) return res
			trackedId = undefined
		}
		return send(text, options)
	}

	const transient: ChatSession['transient'] = async (text, options, ttlMs = 5000) => {
		const res = await send(text, options)
		const messageId = res.ok ? (res.data as any)?.message_id : undefined
		if (res.ok && messageId && ttlMs > 0) {
			scheduleDelete(() => del(messageId), ttlMs)
		}
		return res
	}

	const track: ChatSession['track'] = (messageId) => {
		trackedId = typeof messageId === 'number' ? messageId : undefined
		return trackedId
	}

	const withDefaults: ChatSession['withDefaults'] = (overrides) => {
		const next = makeChatSession(chatId, request, { ...baseDefaults, ...overrides })
		if (trackedId) next.track(trackedId)
		return next
	}

	const session: ChatSession = {
		chatId,
		defaults: baseDefaults,
		get lastMessageId() {
			return trackedId
		},
		send,
		reply,
		edit,
		editLast,
		delete: del,
		deleteLast,
		sendPhoto,
		sendDocument,
		typing,
		upsert,
		transient,
		track,
		withDefaults,
	}

	return session
}

function defineResult(target: Partial<TelegramApi>, request: TelegramRequest) {
	return <K extends ApiMethodName>(name: K, method: HttpMethod) => {
		target[name] = ((arg?: MethodArgs<K>) => request(method, name as string, arg as JsonLike)) as TelegramApi[K]
	}
}

function appendQuery(path: string, params: Record<string, unknown>): string {
	const search = new URLSearchParams()
	let has = false
	for (const k in params) {
		const v = params[k]
		if (v === undefined || v === null) continue
		if (Array.isArray(v)) {
			for (const item of v) {
				search.append(k, String(item))
			}
		} else {
			search.append(k, String(v))
		}
		has = true
	}
	if (!has) return path
	return path + (path.includes('?') ? '&' : '?') + search.toString()
}

function isPlainObject(value: JsonLike): value is Record<string, unknown> {
	if (!value || typeof value !== 'object') return false
	return !(value instanceof FormData)
}

export function normalizeErrCode(e: unknown): number {
	const status = (e as { status?: unknown })?.status
	return typeof status === 'number' ? status : -1
}

export function normalizeErrMsg(e: unknown): string {
	if (!e) return 'Network Error'
	if (typeof e === 'string') return e
	if (e instanceof Error && e.message) return e.message
	const m = e as { message?: unknown; statusText?: unknown }
	if (typeof m.message === 'string') return m.message
	if (typeof m.statusText === 'string') return m.statusText
	return 'Network Error'
}

function missingTracked(action: 'edit' | 'delete') {
	return {
		ok: false,
		code: -404,
		message: `No tracked message to ${action}`,
	} as Result<never>
}

function scheduleDelete(task: () => Promise<unknown>, ttlMs: number) {
	const timer = setTimeout(() => {
		void task().catch(() => {})
	}, ttlMs)
	;(timer as any).unref?.()
}

export * from './types'
