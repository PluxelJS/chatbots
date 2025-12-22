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

	async snapshot(limit = 64): Promise<KookSnapshot> {
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
