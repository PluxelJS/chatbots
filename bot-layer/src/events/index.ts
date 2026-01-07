import type { Context } from '@pluxel/hmr'
import { EvtChannel } from '@pluxel/core/services'
import type { BotLayerEventMap } from './events.types'
import type { AnyMessage, PlainMessage, RichMessage } from '../types'
import { hasRichParts } from '../../parts'

export type BotEventChannel = {
	[K in keyof BotLayerEventMap]: EvtChannel<BotLayerEventMap[K]>
}

export const createBotEventChannel = (ctx: Context): BotEventChannel => ({
	message: new EvtChannel<BotLayerEventMap['message']>(ctx),
	text: new EvtChannel<BotLayerEventMap['text']>(ctx),
	rich: new EvtChannel<BotLayerEventMap['rich']>(ctx),
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
			ctx.logger.debug('bot-layer: incoming message', {
				platform: msg.platform,
				user: msg.user.username ?? msg.user.id,
				parts: msg.parts.length,
				rich,
				text: msg.text,
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
		ctx.logger.error('bot-layer: 分发消息失败', { error })
	}
}

export * from './events.types'
