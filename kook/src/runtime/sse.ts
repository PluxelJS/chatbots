import type { SseChannel } from '@pluxel/hmr/services'
import type { BotManager } from '../bot-manager'
import type { KookBotRegistry } from './bot-registry'
import type { KookBotPublic } from './bot-registry'

export type KookSnapshot = {
	bots: KookBotPublic[]
	overview: ReturnType<BotManager['getOverview']>
	updatedAt: number
}

export class KookSseBridge {
	constructor(
		private readonly repo: KookBotRegistry,
		private readonly manager: BotManager,
	) {}

	snapshot(limit = 64): KookSnapshot {
		return {
			bots: this.repo.list(limit),
			overview: this.manager.getOverview(),
			updatedAt: Date.now(),
		}
	}

	createHandler(limit = 64) {
		return (channel: SseChannel) => {
			const sendCursor = () => channel.emit('cursor', { type: 'cursor', ...this.snapshot(limit) })
			channel.emit('ready', { type: 'ready', ...this.snapshot(limit) })
			const dispose = this.repo.observe(limit, sendCursor)
			const timer = setInterval(() => channel.emit('tick', { type: 'tick', now: Date.now() }), 1000)

			channel.onAbort(() => {
				dispose()
				clearInterval(timer)
			})

			return () => {
				dispose()
				clearInterval(timer)
			}
		}
	}
}
