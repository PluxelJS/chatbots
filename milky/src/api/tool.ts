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
	retcode: -1,
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

		const recall: MilkyGroupSession['recall'] = async (messageSeq) => {
			const seq = messageSeq ?? lastMessageSeq
			if (!seq) return err<void>('no message_seq to recall')
			return api.recall_group_message({ group_id: groupId, message_seq: seq })
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
			recall,
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

		const recall: MilkyPrivateSession['recall'] = async (messageSeq) => {
			const seq = messageSeq ?? lastMessageSeq
			if (!seq) return err<void>('no message_seq to recall')
			return api.recall_private_message({ user_id: userId, message_seq: seq })
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
			recall,
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

