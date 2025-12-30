import type { SseChannel } from '@pluxel/hmr/services'
import type { TelegramBotManager } from './bot-manager'
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

	async snapshot(limit = 64): Promise<TelegramSnapshot> {
		await this.repo.whenReady()
		return {
			bots: this.repo.list(limit),
			overview: this.manager.getOverview(),
			updatedAt: Date.now(),
		}
	}

	createHandler(limit = 64) {
		return async (channel: SseChannel) => {
			const sendCursor = async () =>
				channel.emit('cursor', { type: 'cursor', ...(await this.snapshot(limit)) })
			channel.emit('ready', { type: 'ready', ...(await this.snapshot(limit)) })
			const dispose = this.repo.observe(limit, () => void sendCursor())
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
