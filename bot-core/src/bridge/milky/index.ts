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
					const normalized = await normalizeMilkyMessage(session)
					await dispatch(normalized)
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e))
					ctx.logger.warn('dispatch failed ({platform})', { platform: 'milky', error })
				}
			})()
		})

		return () => {
			try {
				unlisten()
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				ctx.logger.warn('bridge cleanup failed ({platform})', { platform: 'milky', error })
			}
		}
	},
}
