import type * as Kook from '../types'
import { MessageType } from '../types'
import type { KookApi, KookConversation, KookDirectConversation, Result } from './types'

export type KookApiTools = {
	createAsset(file: Buffer | Blob | ArrayBuffer | ArrayBufferView | string | FormData, name?: string): Promise<Result<string>>

	createMessageBuilder(
		targetId: string,
		builderOptions?: { type?: Kook.MessageType; quote?: string; template_id?: string; temp_target_id?: string },
	): KookConversation['send']

	createConversation(
		targetId: string,
		builderOptions?: { type?: Kook.MessageType; quote?: string; template_id?: string; temp_target_id?: string },
	): KookConversation

	createDirectMessageBuilder(
		direct: Kook.DirectMessageGetType,
		builderOptions?: { type?: Kook.MessageType; quote?: string; template_id?: string },
	): KookDirectConversation['send']

	createDirectConversation(
		direct: Kook.DirectMessageGetType,
		builderOptions?: { type?: Kook.MessageType; quote?: string; template_id?: string },
	): KookDirectConversation
}

export function createKookTools(api: KookApi): KookApiTools {
	return {
		createAsset: async (file, name = 'asset') => {
			const res = await api.createAsset(toFormData(file, name))
			return res.ok ? { ok: true, data: res.data.url } : res
		},

		createMessageBuilder: (targetId, builderOptions) => makeConversation(api, targetId, builderOptions).send,

		createConversation: (targetId, builderOptions) => makeConversation(api, targetId, builderOptions),

		createDirectMessageBuilder: (direct, builderOptions) => makeDirectConversation(api, direct, builderOptions).send,

		createDirectConversation: (direct, builderOptions) => makeDirectConversation(api, direct, builderOptions),
	}
}

function makeConversation(
	api: Pick<KookApi, 'sendMessage' | 'updateMessage' | 'deleteMessage'>,
	target_id: string,
	base?: { type?: Kook.MessageType; quote?: string; template_id?: string; temp_target_id?: string },
): KookConversation {
	const defaults = base ? { ...base } : undefined
	let trackedId: string | undefined

	const send: KookConversation['send'] = async (content, options) => {
		const res = await api.sendMessage({
			target_id,
			content,
			type: options?.type ?? defaults?.type,
			quote: options?.quote ?? defaults?.quote,
			template_id: options?.template_id ?? defaults?.template_id,
			temp_target_id: options?.temp_target_id ?? defaults?.temp_target_id,
		})
		if (res.ok && res.data?.msg_id) {
			trackedId = res.data.msg_id
		}
		return res
	}

	const reply: KookConversation['reply'] = async (quote, content, options) => {
		const res = await api.sendMessage({
			target_id,
			content,
			quote,
			type: options?.type ?? defaults?.type,
			template_id: options?.template_id ?? defaults?.template_id,
			temp_target_id: options?.temp_target_id ?? defaults?.temp_target_id,
		})
		if (res.ok && res.data?.msg_id) {
			trackedId = res.data.msg_id
		}
		return res
	}

	const edit: KookConversation['edit'] = (msg_id, content, options) =>
		api.updateMessage({
			msg_id,
			content,
			type: options?.type,
			quote: options?.quote ?? defaults?.quote,
			template_id: options?.template_id ?? defaults?.template_id,
			temp_target_id: options?.temp_target_id ?? defaults?.temp_target_id,
		})

	const deleteMessage: KookConversation['delete'] = (msg_id) =>
		api.deleteMessage({ msg_id })

	const editLast: KookConversation['editLast'] = (content, options) => {
		if (!trackedId) return missingTracked()
		return edit(trackedId, content, options)
	}

	const deleteLast: KookConversation['deleteLast'] = () => {
		if (!trackedId) return missingTracked()
		return deleteMessage(trackedId)
	}

	const upsert: KookConversation['upsert'] = async (content, options) => {
		if (trackedId) {
			const editOptions = options
				? {
						type:
							options.type === MessageType.kmarkdown || options.type === MessageType.card
								? options.type
								: undefined,
						quote: options.quote,
						template_id: options.template_id,
						temp_target_id: options.temp_target_id,
					}
				: undefined

			const res = await edit(trackedId, content, editOptions)
			if (res.ok) return res
			trackedId = undefined
		}
		return send(content, options)
	}

	const transient: KookConversation['transient'] = async (content, options, ttlMs = 5000) => {
		const res = await send(content, options)
		const msgId = res.ok ? res.data?.msg_id : undefined
		if (res.ok && msgId && ttlMs > 0) {
			scheduleDelete(() => deleteMessage(msgId), ttlMs)
		}
		return res
	}

	const track: KookConversation['track'] = (msg_id) => {
		trackedId = typeof msg_id === 'string' && msg_id ? msg_id : undefined
		return trackedId
	}

	const withDefaults: KookConversation['withDefaults'] = (overrides) => {
		const next = makeConversation(api, target_id, { ...defaults, ...overrides })
		if (trackedId) next.track(trackedId)
		return next
	}

	return {
		target_id,
		defaults,
		get lastMessageId() {
			return trackedId
		},
		send,
		reply,
		edit,
		editLast,
		delete: deleteMessage,
		deleteLast,
		upsert,
		transient,
		track,
		withDefaults,
	}
}

function makeDirectConversation(
	api: Pick<KookApi, 'createDirectMessage' | 'updateDirectMessage' | 'deleteDirectMessage'>,
	direct: Kook.DirectMessageGetType,
	base?: { type?: Kook.MessageType; quote?: string; template_id?: string },
): KookDirectConversation {
	const defaults = base ? { ...base } : undefined
	let trackedId: string | undefined

	const send: KookDirectConversation['send'] = async (content, options) => {
		const res = await api.createDirectMessage({
			...direct,
			content,
			type: options?.type ?? defaults?.type,
			quote: options?.quote ?? defaults?.quote,
			template_id: options?.template_id ?? defaults?.template_id,
		})
		if (res.ok && res.data?.msg_id) {
			trackedId = res.data.msg_id
		}
		return res
	}

	const reply: KookDirectConversation['reply'] = async (quote, content, options) => {
		const res = await api.createDirectMessage({
			...direct,
			content,
			quote,
			type: options?.type ?? defaults?.type,
			template_id: options?.template_id ?? defaults?.template_id,
		})
		if (res.ok && res.data?.msg_id) {
			trackedId = res.data.msg_id
		}
		return res
	}

	const edit: KookDirectConversation['edit'] = (msg_id, content, options) =>
		api.updateDirectMessage({
			msg_id,
			content,
			quote: options?.quote ?? defaults?.quote,
			template_id: options?.template_id ?? defaults?.template_id,
		})

	const deleteMessage: KookDirectConversation['delete'] = (msg_id) =>
		api.deleteDirectMessage({ msg_id })

	const editLast: KookDirectConversation['editLast'] = (content, options) => {
		if (!trackedId) return missingTracked()
		return edit(trackedId, content, options)
	}

	const deleteLast: KookDirectConversation['deleteLast'] = () => {
		if (!trackedId) return missingTracked()
		return deleteMessage(trackedId)
	}

	const upsert: KookDirectConversation['upsert'] = async (content, options) => {
		if (trackedId) {
			const res = await edit(trackedId, content, options)
			if (res.ok) return res
			trackedId = undefined
		}
		return send(content, options)
	}

	const transient: KookDirectConversation['transient'] = async (content, options, ttlMs = 5000) => {
		const res = await send(content, options)
		const msgId = res.ok ? res.data?.msg_id : undefined
		if (res.ok && msgId && ttlMs > 0) {
			scheduleDelete(() => deleteMessage(msgId), ttlMs)
		}
		return res
	}

	const track: KookDirectConversation['track'] = (msg_id) => {
		trackedId = typeof msg_id === 'string' && msg_id ? msg_id : undefined
		return trackedId
	}

	const withDefaults: KookDirectConversation['withDefaults'] = (overrides) => {
		const next = makeDirectConversation(api, direct, { ...defaults, ...overrides })
		if (trackedId) next.track(trackedId)
		return next
	}

	return {
		direct,
		defaults,
		get lastMessageId() {
			return trackedId
		},
		send,
		reply,
		edit,
		editLast,
		delete: deleteMessage,
		deleteLast,
		upsert,
		transient,
		track,
		withDefaults,
	}
}

function missingTracked(): Promise<Result<void>> {
	return Promise.resolve({ ok: false, code: -404, message: 'No tracked message to operate on' })
}

function scheduleDelete(task: () => Promise<unknown>, ttlMs: number) {
	const timer = setTimeout(() => {
		void task().catch(() => {})
	}, ttlMs)
	;(timer as any).unref?.()
}

function toFormData(file: Buffer | Blob | ArrayBuffer | ArrayBufferView | string | FormData, name: string): FormData {
	if (file instanceof FormData) return file

	if (typeof file === 'string') {
		const u8 = Buffer.from(file, 'base64')
		const blob = new Blob([u8], { type: 'application/octet-stream' })
		const fd = new FormData()
		fd.append('file', blob, name)
		return fd
	}

	if (typeof Buffer !== 'undefined' && file instanceof Buffer) {
		const blob = new Blob([new Uint8Array(file.buffer, file.byteOffset, file.byteLength)], { type: 'application/octet-stream' })
		const fd = new FormData()
		fd.append('file', blob, name)
		return fd
	}

	if (file instanceof Blob) {
		const fd = new FormData()
		fd.append('file', file, name)
		return fd
	}

	if (file instanceof ArrayBuffer) {
		const blob = new Blob([file], { type: 'application/octet-stream' })
		const fd = new FormData()
		fd.append('file', blob, name)
		return fd
	}

	if (ArrayBuffer.isView(file)) {
		const u8 = new Uint8Array(file.buffer, file.byteOffset, file.byteLength)
		const blob = new Blob([u8], { type: 'application/octet-stream' })
		const fd = new FormData()
		fd.append('file', blob, name)
		return fd
	}

	return file
}
