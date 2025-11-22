import type { Context } from '@pluxel/hmr'
import { EvtChannel } from '@pluxel/hmr/services'
import type { KookEventMap } from './events.types'

export type KookChannel = {
	[K in keyof KookEventMap]: EvtChannel<KookEventMap[K]>
}

export const createKookChannel = (ctx: Context): KookChannel => ({
	message: new EvtChannel<KookEventMap['message']>(ctx),
	button: new EvtChannel<KookEventMap['button']>(ctx),
	messageCreated: new EvtChannel<KookEventMap['messageCreated']>(ctx),
	privateMessageCreated: new EvtChannel<KookEventMap['privateMessageCreated']>(ctx),
	user_updated: new EvtChannel<KookEventMap['user_updated']>(ctx),
	message_btn_click: new EvtChannel<KookEventMap['message_btn_click']>(ctx),
	added_reaction: new EvtChannel<KookEventMap['added_reaction']>(ctx),
	deleted_reaction: new EvtChannel<KookEventMap['deleted_reaction']>(ctx),
	updated_message: new EvtChannel<KookEventMap['updated_message']>(ctx),
	deleted_message: new EvtChannel<KookEventMap['deleted_message']>(ctx),
	pinned_message: new EvtChannel<KookEventMap['pinned_message']>(ctx),
	unpinned_message: new EvtChannel<KookEventMap['unpinned_message']>(ctx),
	joined_guild: new EvtChannel<KookEventMap['joined_guild']>(ctx),
	exited_guild: new EvtChannel<KookEventMap['exited_guild']>(ctx),
	updated_guild_member: new EvtChannel<KookEventMap['updated_guild_member']>(ctx),
	updated_guild: new EvtChannel<KookEventMap['updated_guild']>(ctx),
	deleted_guild: new EvtChannel<KookEventMap['deleted_guild']>(ctx),
	self_joined_guild: new EvtChannel<KookEventMap['self_joined_guild']>(ctx),
	self_exited_guild: new EvtChannel<KookEventMap['self_exited_guild']>(ctx),
	added_role: new EvtChannel<KookEventMap['added_role']>(ctx),
	deleted_role: new EvtChannel<KookEventMap['deleted_role']>(ctx),
	updated_role: new EvtChannel<KookEventMap['updated_role']>(ctx),
	added_block_list: new EvtChannel<KookEventMap['added_block_list']>(ctx),
	deleted_block_list: new EvtChannel<KookEventMap['deleted_block_list']>(ctx),
	added_emoji: new EvtChannel<KookEventMap['added_emoji']>(ctx),
	updated_emoji: new EvtChannel<KookEventMap['updated_emoji']>(ctx),
	added_channel: new EvtChannel<KookEventMap['added_channel']>(ctx),
	updated_channel: new EvtChannel<KookEventMap['updated_channel']>(ctx),
	deleted_channel: new EvtChannel<KookEventMap['deleted_channel']>(ctx),
	updated_private_message: new EvtChannel<KookEventMap['updated_private_message']>(ctx),
	deleted_private_message: new EvtChannel<KookEventMap['deleted_private_message']>(ctx),
	private_added_reaction: new EvtChannel<KookEventMap['private_added_reaction']>(ctx),
	private_deleted_reaction: new EvtChannel<KookEventMap['private_deleted_reaction']>(ctx),
	joined_channel: new EvtChannel<KookEventMap['joined_channel']>(ctx),
	exited_channel: new EvtChannel<KookEventMap['exited_channel']>(ctx),
	guild_member_online: new EvtChannel<KookEventMap['guild_member_online']>(ctx),
	guild_member_offline: new EvtChannel<KookEventMap['guild_member_offline']>(ctx),
	webhook: new EvtChannel<KookEventMap['webhook']>(ctx),
})

export * from './events.types'
