import type { Context } from '@pluxel/hmr'
import { EvtChannel } from '@pluxel/core/services'
import type { BotCoreEventMap } from './events.types'
import type { AnyMessage, PlainMessage, RichMessage } from '../types'
import { hasRichParts } from '../../parts'

export type BotEventChannel = {
	[K in keyof BotCoreEventMap]: EvtChannel<BotCoreEventMap[K]>
}

export const createBotEventChannel = (ctx: Context): BotEventChannel => ({
	message: new EvtChannel<BotCoreEventMap['message']>(ctx),
	text: new EvtChannel<BotCoreEventMap['text']>(ctx),
	rich: new EvtChannel<BotCoreEventMap['rich']>(ctx),
})

/** 分发消息到事件通道 */
export const dispatchMessage = async (
	events: BotEventChannel,
	ctx: Context,
	msg: AnyMessage,
	debug = false,
	mark?: (platform: AnyMessage['platform']) => void,
): Promise<void> => {
	const rich = msg.rich ?? hasRichParts(msg.parts)
	const normalized = { ...msg, rich } as AnyMessage

	try {
		if (debug) {
			ctx.logger.debug('incoming message ({platform})', {
				platform: msg.platform,
				messageId: msg.messageId,
				userId: msg.user.id,
				channelId: msg.channel.id,
				rich,
				parts: msg.parts.length,
				attachments: msg.attachments.length,
			})
		}
		mark?.(msg.platform)
		events.message.emit(normalized)
		if (rich) {
			events.rich.emit(normalized as RichMessage)
		} else {
			events.text.emit(normalized as PlainMessage)
		}
	} catch (e) {
		const error = e instanceof Error ? e : new Error(String(e))
		ctx.logger.error('dispatch failed ({platform})', { platform: msg.platform, error })
	}
}

export * from './events.types'
