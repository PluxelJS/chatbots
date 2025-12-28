import type { Context } from '@pluxel/hmr'
import { EvtChannel } from '@pluxel/core/services'
import type { MilkyEventMap } from './events.types'

export type MilkyChannel = {
	[K in keyof MilkyEventMap]: EvtChannel<MilkyEventMap[K]>
}

export const createMilkyChannel = (ctx: Context): MilkyChannel => ({
	event: new EvtChannel<MilkyEventMap['event']>(ctx),
	message: new EvtChannel<MilkyEventMap['message']>(ctx),

	bot_offline: new EvtChannel<MilkyEventMap['bot_offline']>(ctx),
	message_receive: new EvtChannel<MilkyEventMap['message_receive']>(ctx),
	message_recall: new EvtChannel<MilkyEventMap['message_recall']>(ctx),
	friend_request: new EvtChannel<MilkyEventMap['friend_request']>(ctx),
	group_join_request: new EvtChannel<MilkyEventMap['group_join_request']>(ctx),
	group_invited_join_request: new EvtChannel<MilkyEventMap['group_invited_join_request']>(ctx),
	group_invitation: new EvtChannel<MilkyEventMap['group_invitation']>(ctx),
	friend_nudge: new EvtChannel<MilkyEventMap['friend_nudge']>(ctx),
	friend_file_upload: new EvtChannel<MilkyEventMap['friend_file_upload']>(ctx),
	group_admin_change: new EvtChannel<MilkyEventMap['group_admin_change']>(ctx),
	group_essence_message_change: new EvtChannel<MilkyEventMap['group_essence_message_change']>(ctx),
	group_member_increase: new EvtChannel<MilkyEventMap['group_member_increase']>(ctx),
	group_member_decrease: new EvtChannel<MilkyEventMap['group_member_decrease']>(ctx),
	group_name_change: new EvtChannel<MilkyEventMap['group_name_change']>(ctx),
	group_message_reaction: new EvtChannel<MilkyEventMap['group_message_reaction']>(ctx),
	group_mute: new EvtChannel<MilkyEventMap['group_mute']>(ctx),
	group_whole_mute: new EvtChannel<MilkyEventMap['group_whole_mute']>(ctx),
	group_nudge: new EvtChannel<MilkyEventMap['group_nudge']>(ctx),
	group_file_upload: new EvtChannel<MilkyEventMap['group_file_upload']>(ctx),
})

export * from './events.types'

