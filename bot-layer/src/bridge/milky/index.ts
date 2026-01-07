import type { BridgeDefinition } from '../types'
import { milkyAdapter } from './adapter'
import { normalizeMilkyMessage } from './normalize'

type MilkyModule = typeof import('pluxel-plugin-milky')
type MilkyInstance = InstanceType<MilkyModule['Milky']>

export const milkyBridge: BridgeDefinition<'milky', 'milky:ready', MilkyInstance> = {
	platform: 'milky',
	adapter: milkyAdapter,
	event: 'milky:ready',
	attach: (ctx, milky, dispatch) => {
		const unlisten = milky.runtime.events.message.on((session: any) => {
			void (async () => {
				try {
					ctx.logger.debug('bot-layer: milky incoming', {
						platform: 'milky',
						messageSeq: session.message?.message_seq,
						peerId: session.message?.peer_id,
						from: session.message?.sender_id,
					})
					const normalized = await normalizeMilkyMessage(session)
					await dispatch(normalized)
					ctx.logger.debug('bot-layer: milky dispatched', {
						platform: 'milky',
						messageId: normalized.messageId,
						rich: normalized.rich,
						parts: normalized.parts.length,
						attachments: normalized.attachments.length,
					})
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e))
					ctx.logger.warn('bot-layer: Milky dispatch 失败', { error })
				}
			})()
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				ctx.logger.warn('bot-layer: Milky bridge 清理失败', { error })
			}
		}
	},
}
