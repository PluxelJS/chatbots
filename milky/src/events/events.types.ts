import type { Event as MilkyEvent, IncomingMessage } from '@saltify/milky-types'
import type { MilkyBot } from '../bot'

export type EventMeta = {
	receivedAt: number
	source: 'sse' | 'ws'
}

export type MilkyEventSession = {
	bot: MilkyBot
	event: MilkyEvent
	meta: EventMeta
	selfId: number
}

export type MilkyMessageSession = MilkyEventSession & {
	message: IncomingMessage
}

export interface MilkyEventMap {
	/** 原始事件（任何事件都会触发） */
	event: (session: MilkyEventSession) => void
	/** 消息接收事件（常用快捷） */
	message: (session: MilkyMessageSession) => void

	/** 精确事件类型（同 event_type） */
	bot_offline: (session: MilkyEventSession) => void
	message_receive: (session: MilkyMessageSession) => void
	message_recall: (session: MilkyEventSession) => void
	friend_request: (session: MilkyEventSession) => void
	group_join_request: (session: MilkyEventSession) => void
	group_invited_join_request: (session: MilkyEventSession) => void
	group_invitation: (session: MilkyEventSession) => void
	friend_nudge: (session: MilkyEventSession) => void
	friend_file_upload: (session: MilkyEventSession) => void
	group_admin_change: (session: MilkyEventSession) => void
	group_essence_message_change: (session: MilkyEventSession) => void
	group_member_increase: (session: MilkyEventSession) => void
	group_member_decrease: (session: MilkyEventSession) => void
	group_name_change: (session: MilkyEventSession) => void
	group_message_reaction: (session: MilkyEventSession) => void
	group_mute: (session: MilkyEventSession) => void
	group_whole_mute: (session: MilkyEventSession) => void
	group_nudge: (session: MilkyEventSession) => void
	group_file_upload: (session: MilkyEventSession) => void
}

