import type { Context } from '@pluxel/hmr'
import type { Bot } from '../bot'
import type { KookChannel } from './index'
import type { Session } from '../types'

export function dispatchKookEvent(events: KookChannel, ctx: Context, bot: Bot, data: any) {
	// 高频字段本地缓存，减少链式取址
	const ex = data?.extra
	const body = ex?.body
	const targetId = data?.target_id
	const selfId = bot?.selfInfo?.id || ''

	// 稳定形状的 session（一次性列出可枚举字段）
	const session: Session = {
		userId: (data?.author_id === '1' ? body?.user_id : data?.author_id) || '',
		channelId: '',
		guildId: '',
		selfId,
		bot,
		data,
	}

	// —— 普通消息（主路径，最热） —— //
	if (data.type !== 255) {
		// 忽略自身的普通消息
		if (selfId && selfId === session.userId) return

		session.guildId = ex?.guild_id || ''
		session.channelId = targetId || ''

		const result = events.message.waterfall(session)
		const { value } = result
		if (value) {
			void session.bot
				.sendMessage({ target_id: session.channelId, content: value })
				.catch((e) => {
					const error = e instanceof Error ? e : new Error(String(e))
					ctx.logger.error('message 监听器返回的信息发送失败。', { platform: 'kook', error })
				})
		}

		const chType = data.channel_type
		if (chType === 'GROUP') {
			events.messageCreated.emit(session)
		} else if (chType === 'PERSON') {
			events.privateMessageCreated.emit(session)
		}
		return
	}

	// —— 特殊类型（按钮/系统回调等） —— //
	session.guildId = body?.guild_id || session.guildId
	session.channelId = body?.channel_id || targetId || session.channelId

	const t = ex?.type
	if (t === 'message_btn_click') {
		// 按钮点击：目标频道以 body.target_id 为准
		session.channelId = body?.target_id || session.channelId
		events.button.waterfall(session)
		events.message_btn_click.emit(session)
		return
	}

	// 兜底映射
	if (typeof t === 'string') {
		const channel: any = (events as any)[t]
		if (channel?.emit) {
			channel.emit(session)
			return
		}
	}
	events.webhook.emit(session)
}
