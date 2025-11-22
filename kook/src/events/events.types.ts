import type { NoticeType } from '../types'
import type {
	EventSession,
	IAddedBlockListBody,
	IAddedChannelBody,
	IAddedEmojiBody,
	IAddedReactionBody,
	IAddedRoleBody,
	IDeletedBlockListBody,
	IDeletedChannelBody,
	IDeletedGuildBody,
	IDeletedMessageBody,
	IDeletedPrivateMessageBody,
	IDeletedReactionBody,
	IDeletedRoleBody,
	IExitedChannelBody,
	IExitedGuildBody,
	IGuildMemberOfflineBody,
	IGuildMemberOnlineBody,
	IJoinedChannelBody,
	IJoinedGuildBody,
	IMessageButtonClickBody,
	IPinnedMessageBody,
	IPrivateAddedReactionBody,
	IPrivateDeletedReactionBody,
	ISelfExitedGuildBody,
	ISelfJoinedGuildBody,
	IUnPinnedMessageBody,
	IUpdatedChannelBody,
	IUpdatedEmojiBody,
	IUpdatedGuildBody,
	IUpdatedGuildMemberBody,
	IUpdatedMessageBody,
	IUpdatedPrivateMessageBody,
	IUpdatedRoleBody,
	IUserUpdatedBody,
	MessageExtra,
	MessageSession,
	Session,
} from '../types'

export type MessagePipeline = (
	session: MessageSession<MessageExtra>,
	next: (session: MessageSession<MessageExtra>) => string | void,
) => string | void

export type ButtonPipeline = (
	session: EventSession<IMessageButtonClickBody>,
	next: (session: EventSession<IMessageButtonClickBody>) => void,
) => void

export interface KookEventMap {
	/** 热路径：普通消息流水线（命令等在此处理） */
	message: MessagePipeline
	/** 特殊热路径：按钮点击流水线（需要 next 语义） */
	button: ButtonPipeline
	/** 派发到群组消息创建 */
	messageCreated: (session: MessageSession<MessageExtra>) => void
	/** 私聊消息创建 */
	privateMessageCreated: (session: MessageSession<MessageExtra>) => void

	// —— 官方 NoticeType：直接复用 KOOK 枚举原文 —— //
	user_updated: (session: EventSession<IUserUpdatedBody>) => void
	message_btn_click: (session: EventSession<IMessageButtonClickBody>) => void
	added_reaction: (session: EventSession<IAddedReactionBody>) => void
	deleted_reaction: (session: EventSession<IDeletedReactionBody>) => void
	updated_message: (session: EventSession<IUpdatedMessageBody>) => void
	deleted_message: (session: EventSession<IDeletedMessageBody>) => void
	pinned_message: (session: EventSession<IPinnedMessageBody>) => void
	unpinned_message: (session: EventSession<IUnPinnedMessageBody>) => void
	joined_guild: (session: EventSession<IJoinedGuildBody>) => void
	exited_guild: (session: EventSession<IExitedGuildBody>) => void
	updated_guild_member: (session: EventSession<IUpdatedGuildMemberBody>) => void
	updated_guild: (session: EventSession<IUpdatedGuildBody>) => void
	deleted_guild: (session: EventSession<IDeletedGuildBody>) => void
	self_joined_guild: (session: EventSession<ISelfJoinedGuildBody>) => void
	self_exited_guild: (session: EventSession<ISelfExitedGuildBody>) => void
	added_role: (session: EventSession<IAddedRoleBody>) => void
	deleted_role: (session: EventSession<IDeletedRoleBody>) => void
	updated_role: (session: EventSession<IUpdatedRoleBody>) => void
	added_block_list: (session: EventSession<IAddedBlockListBody>) => void
	deleted_block_list: (session: EventSession<IDeletedBlockListBody>) => void
	added_emoji: (session: EventSession<IAddedEmojiBody>) => void
	updated_emoji: (session: EventSession<IUpdatedEmojiBody>) => void
	added_channel: (session: EventSession<IAddedChannelBody>) => void
	updated_channel: (session: EventSession<IUpdatedChannelBody>) => void
	deleted_channel: (session: EventSession<IDeletedChannelBody>) => void
	updated_private_message: (session: EventSession<IUpdatedPrivateMessageBody>) => void
	deleted_private_message: (session: EventSession<IDeletedPrivateMessageBody>) => void
	private_added_reaction: (session: EventSession<IPrivateAddedReactionBody>) => void
	private_deleted_reaction: (session: EventSession<IPrivateDeletedReactionBody>) => void
	joined_channel: (session: EventSession<IJoinedChannelBody>) => void
	exited_channel: (session: EventSession<IExitedChannelBody>) => void
	guild_member_online: (session: EventSession<IGuildMemberOnlineBody>) => void
	guild_member_offline: (session: EventSession<IGuildMemberOfflineBody>) => void

	/** 未知类型兜底（便于调试） */
	webhook: (session: Session) => void
}

export const noticeEventNames = [
	'user_updated',
	'message_btn_click',
	'added_reaction',
	'deleted_reaction',
	'updated_message',
	'deleted_message',
	'pinned_message',
	'unpinned_message',
	'joined_guild',
	'exited_guild',
	'updated_guild_member',
	'updated_guild',
	'deleted_guild',
	'self_joined_guild',
	'self_exited_guild',
	'added_role',
	'deleted_role',
	'updated_role',
	'added_block_list',
	'deleted_block_list',
	'added_emoji',
	'updated_emoji',
	'added_channel',
	'updated_channel',
	'deleted_channel',
	'updated_private_message',
	'deleted_private_message',
	'private_added_reaction',
	'private_deleted_reaction',
	'joined_channel',
	'exited_channel',
	'guild_member_online',
	'guild_member_offline',
] as const satisfies readonly NoticeType[]

export type NoticeEventName = (typeof noticeEventNames)[number]
