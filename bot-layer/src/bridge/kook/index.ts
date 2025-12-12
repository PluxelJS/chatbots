import type { BridgeDefinition } from '../types'
import { normalizeKookMessage } from './normalize'
import { kookAdapter } from './send'

type KookModule = typeof import('pluxel-plugin-kook')
type KookInstance = InstanceType<KookModule['KOOK']>

export const kookBridge: BridgeDefinition<'kook', KookInstance> = {
	platform: 'kook',
	adapter: kookAdapter,
	watch: (ctx, attach) => {
		const stop = ctx.registry.optional(() => import('pluxel-plugin-kook').then((m) => m.KOOK), attach, { watch: true })
		return typeof stop === 'function' ? stop : undefined
	},
	attach: (ctx, kook, dispatch) => {
		const unlisten = kook.events.message.on((session, next) => {
			ctx.logger.debug(
				{
					platform: 'kook',
					messageId: session.data?.msg_id,
					channelId: session.channelId,
					userId: session.userId,
				},
				'bot-layer: kook incoming',
			)
			const normalized = normalizeKookMessage(session)
			void dispatch(normalized)
				.then(() =>
					ctx.logger.debug(
						{
							platform: 'kook',
							messageId: normalized.messageId,
							rich: normalized.rich,
							parts: normalized.parts.length,
							attachments: normalized.attachments.length,
						},
						'bot-layer: kook dispatched',
					),
				)
				.catch((e) => ctx.logger.warn(e, 'bot-layer: KOOK dispatch 失败'))
			return next(session)
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				ctx.logger.warn(e, 'bot-layer: KOOK bridge 清理失败')
			}
		}
	},
}
