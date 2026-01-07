import type { BridgeDefinition } from '../types'
import { normalizeTelegramMessage } from './normalize'
import { telegramAdapter } from './adapter'

type TelegramModule = typeof import('pluxel-plugin-telegram')
type TelegramInstance = InstanceType<TelegramModule['TelegramPlugin']>

export const telegramBridge: BridgeDefinition<'telegram', 'telegram:ready', TelegramInstance> = {
	platform: 'telegram',
	adapter: telegramAdapter,
	event: 'telegram:ready',
	attach: (ctx, telegram, dispatch) => {
		// 使用 onFront 保证优先于命令/会话处理，从而不漏掉以 “/” 开头的消息
		const register =
			(telegram.runtime.events.message as any).onFront?.bind(telegram.runtime.events.message) ??
			telegram.runtime.events.message.on.bind(telegram.runtime.events.message)

		const unlisten = register((session: any, next: any) => {
			void (async () => {
				try {
					ctx.logger.debug('bot-layer: telegram incoming', {
						platform: 'telegram',
						messageId: session.message?.message_id,
						chatId: session.chatId,
						from: session.message?.from?.id,
					})
					const normalized = await normalizeTelegramMessage(session)
					await dispatch(normalized)
					ctx.logger.debug('bot-layer: telegram dispatched', {
						platform: 'telegram',
						messageId: normalized.messageId,
						rich: normalized.rich,
						parts: normalized.parts.length,
						attachments: normalized.attachments.length,
					})
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e))
					ctx.logger.warn('bot-layer: Telegram dispatch 失败', { error })
				}
			})()
			return next(session)
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				ctx.logger.warn('bot-layer: Telegram bridge 清理失败', { error })
			}
		}
	},
}
