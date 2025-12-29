import type { Event as MilkyEvent, IncomingMessage } from '@saltify/milky-types'
import type { MilkyBot } from '../bot'

export type MilkyEventType = MilkyEvent['event_type']
export type MilkyEventOf<T extends MilkyEventType> = Extract<MilkyEvent, { event_type: T }>

export type MilkyEventSession<T extends MilkyEventType = MilkyEventType> = {
	bot: MilkyBot
	event: MilkyEventOf<T>
	selfId: number
}

export type MilkyMessageSession = MilkyEventSession<'message_receive'> & {
	message: IncomingMessage
}

type SessionForEvent<T extends MilkyEventType> = T extends 'message_receive'
	? MilkyMessageSession
	: MilkyEventSession<T>

/**
 * Ensure we have a local, same-name handler channel for every `MilkyEvent['event_type']`.
 * - `event` is a catch-all (always emitted).
 * - `message` is a convenience alias for message events.
 * - `[event_type]` channels are exhaustive and type-safe.
 */
export type MilkyEventMap = {
	/** 原始事件（任何事件都会触发） */
	event: (session: MilkyEventSession) => void
	/** 消息接收事件（常用快捷，流式） */
	message: (session: MilkyMessageSession, next: (session:MilkyMessageSession) => void) => void
} & {
	/** 精确事件类型（同 event_type） */
	[K in MilkyEventType]: (session: SessionForEvent<K>) => void
}
