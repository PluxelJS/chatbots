import type { SseChannel } from '@pluxel/hmr/services'
import type { TelegramBotManager } from '../bot-manager'
import type { TelegramBotRegistry } from './bot-registry'
import type { TelegramBotPublic } from './bot-registry'

export type TelegramSnapshot = {
	bots: TelegramBotPublic[]
	overview: ReturnType<TelegramBotManager['getOverview']>
	updatedAt: number
}

export class TelegramSseBridge {
	constructor(
		private readonly repo: TelegramBotRegistry,
		private readonly manager: TelegramBotManager,
	) {}

	snapshot(limit = 64): TelegramSnapshot {
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
