import type { OutgoingSegment } from '@saltify/milky-types'
import type {
	MilkyApi,
	MilkyApiTools,
	MilkyGroupSession,
	MilkyMessage,
	MilkyPrivateSession,
	Result,
} from './types'

const err = <T>(message: string, raw?: unknown): Result<T> => ({
	ok: false,
	code: -1,
	message,
	raw: raw ?? message,
})

function normalizeMessage(message: MilkyMessage): OutgoingSegment[] {
	if (typeof message === 'string') {
		return [{ type: 'text', data: { text: message } } as const]
	}
	if (Array.isArray(message)) return message
	return [message]
}

export function createMilkyTools(api: MilkyApi): MilkyApiTools {
	const createGroupSession = (groupId: number): MilkyGroupSession => {
		let lastMessageSeq: number | undefined

		const send: MilkyGroupSession['send'] = async (message) => {
			const res = await api.send_group_message({
				group_id: groupId,
				message: normalizeMessage(message),
			})
			if (res.ok) lastMessageSeq = res.data.message_seq
			return res
		}

		const reply: MilkyGroupSession['reply'] = async (messageSeq, message) => {
			const segs = normalizeMessage(message)
			return send([{ type: 'reply', data: { message_seq: messageSeq } } as const, ...segs])
		}

		const deleteMessage: MilkyGroupSession['delete'] = async (messageSeq) => {
			const seq = messageSeq ?? lastMessageSeq
			if (!seq) return err<void>('no message_seq to recall')
			return api.recall_group_message({ group_id: groupId, message_seq: seq })
		}

		const upsert: MilkyGroupSession['upsert'] = async (message) => {
			if (lastMessageSeq) {
				const res = await deleteMessage(lastMessageSeq)
				if (res.ok) lastMessageSeq = undefined
			}
			return send(message)
		}

		const transient: MilkyGroupSession['transient'] = async (message, ttlMs = 5000) => {
			const res = await send(message)
			const seq = res.ok ? res.data.message_seq : undefined
			if (res.ok && typeof seq === 'number' && ttlMs > 0) {
				scheduleDelete(() => deleteMessage(seq), ttlMs)
			}
			return res
		}

		const track: MilkyGroupSession['track'] = (messageSeq) => {
			if (messageSeq === null) {
				lastMessageSeq = undefined
				return undefined
			}
			if (typeof messageSeq === 'number') lastMessageSeq = messageSeq
			return lastMessageSeq
		}

		return {
			groupId,
			get lastMessageSeq() {
				return lastMessageSeq
			},
			send,
			reply,
			delete: deleteMessage,
			upsert,
			transient,
			track,
		}
	}

	const createPrivateSession = (userId: number): MilkyPrivateSession => {
		let lastMessageSeq: number | undefined

		const send: MilkyPrivateSession['send'] = async (message) => {
			const res = await api.send_private_message({
				user_id: userId,
				message: normalizeMessage(message),
			})
			if (res.ok) lastMessageSeq = res.data.message_seq
			return res
		}

		const reply: MilkyPrivateSession['reply'] = async (messageSeq, message) => {
			const segs = normalizeMessage(message)
			return send([{ type: 'reply', data: { message_seq: messageSeq } } as const, ...segs])
		}

		const deleteMessage: MilkyPrivateSession['delete'] = async (messageSeq) => {
			const seq = messageSeq ?? lastMessageSeq
			if (!seq) return err<void>('no message_seq to recall')
			return api.recall_private_message({ user_id: userId, message_seq: seq })
		}

		const upsert: MilkyPrivateSession['upsert'] = async (message) => {
			if (lastMessageSeq) {
				const res = await deleteMessage(lastMessageSeq)
				if (res.ok) lastMessageSeq = undefined
			}
			return send(message)
		}

		const transient: MilkyPrivateSession['transient'] = async (message, ttlMs = 5000) => {
			const res = await send(message)
			const seq = res.ok ? res.data.message_seq : undefined
			if (res.ok && typeof seq === 'number' && ttlMs > 0) {
				scheduleDelete(() => deleteMessage(seq), ttlMs)
			}
			return res
		}

		const track: MilkyPrivateSession['track'] = (messageSeq) => {
			if (messageSeq === null) {
				lastMessageSeq = undefined
				return undefined
			}
			if (typeof messageSeq === 'number') lastMessageSeq = messageSeq
			return lastMessageSeq
		}

		return {
			userId,
			get lastMessageSeq() {
				return lastMessageSeq
			},
			send,
			reply,
			delete: deleteMessage,
			upsert,
			transient,
			track,
		}
	}

	return {
		createGroupSession,
		createPrivateSession,
		createGroupMessageBuilder: (groupId) => createGroupSession(groupId).send,
		createPrivateMessageBuilder: (userId) => createPrivateSession(userId).send,
	}
}

function scheduleDelete(task: () => Promise<unknown>, ttlMs: number) {
	const timer = setTimeout(() => {
		void task().catch(() => {})
	}, ttlMs)
	;(timer as any).unref?.()
}
