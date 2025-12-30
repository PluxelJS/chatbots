import type { ApiMethods } from '@grammyjs/types'

/* ------------------------ Core types ------------------------ */

export type HttpMethod = 'GET' | 'POST'

export type JsonLike = Record<string, unknown> | BodyInit | undefined

export type TelegramBinaryLike = ArrayBuffer | ArrayBufferView | Blob

export interface TelegramFileInput {
	data: TelegramBinaryLike
	filename?: string
	contentType?: string
}

export type TelegramInputFile = string | TelegramBinaryLike | TelegramFileInput

export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; code: number; message: string }
export type Result<T> = Ok<T> | Err

export interface TelegramApiOptions {
	/** Optional base URL override, default https://api.telegram.org */
	apiBase?: string
	/** Bot token to scope the client; skip if http already scoped */
	token?: string
}

export type TelegramRequest = <T>(
	method: HttpMethod,
	apiMethod: string,
	payload?: JsonLike,
) => Promise<Result<T>>

/* ------------------------ Derived API types ------------------------ */

export type TgInputFile = TelegramInputFile

export type Methods = ApiMethods<TgInputFile>
export type MethodArgs<K extends keyof Methods> = Parameters<Methods[K]>[0]
export type MethodReturn<K extends keyof Methods> = Awaited<ReturnType<Methods[K]>>

type Resultify<T> = {
	[K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Result<Awaited<R>>> : never
}

export type TelegramCoreApi = Resultify<Methods>

export type SendMessageArgs = MethodArgs<'sendMessage'>
export type SendMessageOptions = Omit<SendMessageArgs, 'chat_id' | 'text'>
export type ForwardMessageArgs = MethodArgs<'forwardMessage'>
export type ForwardMessageOptions = Omit<ForwardMessageArgs, 'chat_id' | 'from_chat_id' | 'message_id'>
export type EditMessageTextArgs = MethodArgs<'editMessageText'>
export type DeleteMessageArgs = MethodArgs<'deleteMessage'>
export type SendPhotoArgs = MethodArgs<'sendPhoto'>
export type SendPhotoOptions = Omit<SendPhotoArgs, 'chat_id' | 'photo'>
export type SendDocumentArgs = MethodArgs<'sendDocument'>
export type SendDocumentOptions = Omit<SendDocumentArgs, 'chat_id' | 'document'>
export type SendAnimationArgs = MethodArgs<'sendAnimation'>
export type SendAnimationOptions = Omit<SendAnimationArgs, 'chat_id' | 'animation'>
export type AnswerCallbackQueryArgs = MethodArgs<'answerCallbackQuery'>
export type SetWebhookArgs = MethodArgs<'setWebhook'>
export type DeleteWebhookArgs = MethodArgs<'deleteWebhook'>
export type GetUpdatesArgs = MethodArgs<'getUpdates'>
export type SendChatActionArgs = MethodArgs<'sendChatAction'>

export type TelegramApiCall = {
	<K extends ApiMethodName>(
		apiMethod: K,
		payload?: MethodArgs<K>,
	): Promise<Result<MethodReturn<K>>>
	<T = unknown>(apiMethod: string, payload?: JsonLike): Promise<Result<T>>
}

export type TelegramRawApi = {
	call: TelegramApiCall
	request: TelegramRequest
}

export type TelegramApiTools = {
	createMessageBuilder(
		chatId: SendMessageArgs['chat_id'],
		defaults?: Partial<SendMessageOptions>,
	): TelegramConversation['send']
	createConversation(chatId: SendMessageArgs['chat_id'], defaults?: Partial<SendMessageOptions>): TelegramConversation
}

export type TelegramApi = TelegramCoreApi & { $raw: TelegramRawApi; $tool: TelegramApiTools }

export interface TelegramConversation {
	chatId: SendMessageArgs['chat_id']
	readonly defaults?: Partial<SendMessageOptions>
	readonly lastMessageId?: number
	send(
		text: SendMessageArgs['text'],
		options?: SendMessageOptions,
	): Promise<Result<MethodReturn<'sendMessage'>>>
	reply(
		toMessageId: number,
		text: SendMessageArgs['text'],
		options?: SendMessageOptions,
	): Promise<Result<MethodReturn<'sendMessage'>>>
	edit(
		messageId: EditMessageTextArgs['message_id'],
		text: EditMessageTextArgs['text'],
		options?: Omit<EditMessageTextArgs, 'text' | 'message_id' | 'chat_id'>,
	): Promise<Result<MethodReturn<'editMessageText'>>>
	editLast(
		text: EditMessageTextArgs['text'],
		options?: Omit<EditMessageTextArgs, 'text' | 'chat_id' | 'message_id'>,
	): Promise<Result<MethodReturn<'editMessageText'>>>
	delete(messageId: DeleteMessageArgs['message_id']): Promise<Result<MethodReturn<'deleteMessage'>>>
	deleteLast(): Promise<Result<MethodReturn<'deleteMessage'>>>
	sendPhoto(
		photo: SendPhotoArgs['photo'],
		options?: SendPhotoOptions,
	): Promise<Result<MethodReturn<'sendPhoto'>>>
	sendDocument(
		document: SendDocumentArgs['document'],
		options?: SendDocumentOptions,
	): Promise<Result<MethodReturn<'sendDocument'>>>
	sendAnimation(
		animation: SendAnimationArgs['animation'],
		options?: SendAnimationOptions,
	): Promise<Result<MethodReturn<'sendAnimation'>>>
	typing(
		action?: SendChatActionArgs['action'],
		options?: Omit<SendChatActionArgs, 'chat_id' | 'action'>,
	): Promise<Result<MethodReturn<'sendChatAction'>>>
	upsert(
		text: SendMessageArgs['text'],
		options?: SendMessageOptions,
	): Promise<Result<MethodReturn<'sendMessage'> | MethodReturn<'editMessageText'>>>
	transient(
		text: SendMessageArgs['text'],
		options?: SendMessageOptions,
		ttlMs?: number,
	): Promise<Result<MethodReturn<'sendMessage'>>>
	track(messageId?: number | null): number | undefined
	withDefaults(overrides: Partial<SendMessageOptions>): TelegramConversation
}

export type ApiMethodName = keyof Methods
