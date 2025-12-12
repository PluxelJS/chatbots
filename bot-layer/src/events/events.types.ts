import type { AnyMessage, PlainMessage, RichMessage } from '../types'

export interface BotLayerEventMap {
	/** 所有消息（最底层） */
	message: (message: AnyMessage) => void | Promise<void>
	/** 纯文本消息（msg.rich === false） */
	text: (message: PlainMessage) => void | Promise<void>
	/** 富媒体消息（msg.rich === true） */
	rich: (message: RichMessage) => void | Promise<void>
}

