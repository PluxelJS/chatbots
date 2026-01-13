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
			const normalized = normalizeKookMessage(session)
			void dispatch(normalized)
				.catch((e) => {
					const error = e instanceof Error ? e : new Error(String(e))
					ctx.logger.warn('dispatch failed ({platform})', { platform: 'kook', error })
				})
			return next(session)
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				ctx.logger.warn('bridge cleanup failed ({platform})', { platform: 'kook', error })
			}
		}
	},
}
