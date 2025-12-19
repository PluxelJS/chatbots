import type { BridgeDefinition } from '../types'
import { normalizeTelegramMessage } from './normalize'
import { telegramAdapter } from './send'

type TelegramModule = typeof import('pluxel-plugin-telegram')
type TelegramInstance = InstanceType<TelegramModule['TelegramPlugin']>

export const telegramBridge: BridgeDefinition<'telegram', TelegramInstance> = {
	platform: 'telegram',
	adapter: telegramAdapter,
	watch: (ctx, attach) => {
		const stop = ctx.registry.optional(
			() => import('pluxel-plugin-telegram').then((m) => m.TelegramPlugin ?? (m as any).Telegram),
			attach,
			{ watch: true },
		)
		return typeof stop === 'function' ? stop : undefined
	},
	attach: (ctx, telegram, dispatch) => {
		// 使用 onFront 保证优先于命令/会话处理，从而不漏掉以 “/” 开头的消息
		const register =
			(telegram.runtime.events.message as any).onFront?.bind(telegram.runtime.events.message) ??
			telegram.runtime.events.message.on.bind(telegram.runtime.events.message)

		const unlisten = register((session: any, next: any) => {
			void (async () => {
				try {
					ctx.logger.debug(
						{
							platform: 'telegram',
							messageId: session.message?.message_id,
							chatId: session.chatId,
							from: session.message?.from?.id,
						},
						'bot-layer: telegram incoming',
					)
					const normalized = await normalizeTelegramMessage(session)
					await dispatch(normalized)
					ctx.logger.debug(
						{
							platform: 'telegram',
							messageId: normalized.messageId,
							rich: normalized.rich,
							parts: normalized.parts.length,
							attachments: normalized.attachments.length,
						},
						'bot-layer: telegram dispatched',
					)
				} catch (e) {
					ctx.logger.warn(e, 'bot-layer: Telegram dispatch 失败')
				}
			})()
			return next(session)
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				ctx.logger.warn(e, 'bot-layer: Telegram bridge 清理失败')
			}
		}
	},
}
