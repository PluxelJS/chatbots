import type { BridgeDefinition } from '../types'
import { normalizeKookMessage } from './normalize'
import { kookAdapter } from './adapter'

type KookModule = typeof import('pluxel-plugin-kook')
type KookInstance = InstanceType<KookModule['KOOK']>

export const kookBridge: BridgeDefinition<'kook', 'kook:ready', KookInstance> = {
	platform: 'kook',
	adapter: kookAdapter,
	event: 'kook:ready',
	attach: (ctx, kook, dispatch) => {
		const unlisten = kook.events.message.on((session, next) => {
			ctx.logger.debug('bot-layer: kook incoming', {
				platform: 'kook',
				messageId: session.data?.msg_id,
				channelId: session.channelId,
				userId: session.userId,
			})
			const normalized = normalizeKookMessage(session)
			void dispatch(normalized)
				.then(() =>
					ctx.logger.debug('bot-layer: kook dispatched', {
						platform: 'kook',
						messageId: normalized.messageId,
						rich: normalized.rich,
						parts: normalized.parts.length,
						attachments: normalized.attachments.length,
					}),
				)
				.catch((e) => {
					const error = e instanceof Error ? e : new Error(String(e))
					ctx.logger.warn('bot-layer: KOOK dispatch 失败', { error })
				})
			return next(session)
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				ctx.logger.warn('bot-layer: KOOK bridge 清理失败', { error })
			}
		}
	},
}
