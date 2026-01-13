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
					const normalized = await normalizeTelegramMessage(session)
					await dispatch(normalized)
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e))
					ctx.logger.warn('dispatch failed ({platform})', { platform: 'telegram', error })
				}
			})()
			return next(session)
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				ctx.logger.warn('bridge cleanup failed ({platform})', { platform: 'telegram', error })
			}
		}
	},
}
