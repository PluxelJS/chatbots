import type { Event as MilkyEvent } from '@saltify/milky-types'
import type { MilkyChannel } from './index'
import type { MilkyBot } from '../bot'
import type { EventMeta, MilkyEventOf, MilkyEventSession, MilkyEventType, MilkyMessageSession } from './events.types'

const assertNever = (value: never): never => value

export function dispatchMilkyEvent(
	events: MilkyChannel,
	bot: MilkyBot,
	event: MilkyEvent,
	meta: EventMeta,
) {
	const selfId = Number(event.self_id)
	const base: MilkyEventSession = { bot, event, meta, selfId }

	events.event.emit(base)

	switch (event.event_type) {
		case 'message_receive': {
			const session: MilkyMessageSession = { bot, event, meta, selfId, message: event.data }
			events.message.waterfall(session)
			events.message_receive.emit(session)
			return
		}
		case 'bot_offline':
			events.bot_offline.emit(base as MilkyEventSession<'bot_offline'>)
			return
		case 'message_recall':
			events.message_recall.emit(base as MilkyEventSession<'message_recall'>)
			return
		case 'friend_request':
			events.friend_request.emit(base as MilkyEventSession<'friend_request'>)
			return
		case 'group_join_request':
			events.group_join_request.emit(base as MilkyEventSession<'group_join_request'>)
			return
		case 'group_invited_join_request':
			events.group_invited_join_request.emit(base as MilkyEventSession<'group_invited_join_request'>)
			return
		case 'group_invitation':
			events.group_invitation.emit(base as MilkyEventSession<'group_invitation'>)
			return
		case 'friend_nudge':
			events.friend_nudge.emit(base as MilkyEventSession<'friend_nudge'>)
			return
		case 'friend_file_upload':
			events.friend_file_upload.emit(base as MilkyEventSession<'friend_file_upload'>)
			return
		case 'group_admin_change':
			events.group_admin_change.emit(base as MilkyEventSession<'group_admin_change'>)
			return
		case 'group_essence_message_change':
			events.group_essence_message_change.emit(base as MilkyEventSession<'group_essence_message_change'>)
			return
		case 'group_member_increase':
			events.group_member_increase.emit(base as MilkyEventSession<'group_member_increase'>)
			return
		case 'group_member_decrease':
			events.group_member_decrease.emit(base as MilkyEventSession<'group_member_decrease'>)
			return
		case 'group_name_change':
			events.group_name_change.emit(base as MilkyEventSession<'group_name_change'>)
			return
		case 'group_message_reaction':
			events.group_message_reaction.emit(base as MilkyEventSession<'group_message_reaction'>)
			return
		case 'group_mute':
			events.group_mute.emit(base as MilkyEventSession<'group_mute'>)
			return
		case 'group_whole_mute':
			events.group_whole_mute.emit(base as MilkyEventSession<'group_whole_mute'>)
			return
		case 'group_nudge':
			events.group_nudge.emit(base as MilkyEventSession<'group_nudge'>)
			return
		case 'group_file_upload':
			events.group_file_upload.emit(base as MilkyEventSession<'group_file_upload'>)
			return
		default:
			return assertNever(event)
	}
}
