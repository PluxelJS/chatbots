import type { Context } from '@pluxel/hmr'
import { EvtChannel } from '@pluxel/hmr/services'
import type { Platform } from './types'
import { listAdapters } from './platforms/registry'

export type BridgeState = 'detached' | 'attached'

export interface BridgeStatus {
	platform: Platform
	state: BridgeState
	attachedAt?: number
	lastMessageAt?: number
	messageCount: number
}

export interface StatusSnapshot {
	bridges: BridgeStatus[]
}

export const createStatusTracker = (ctx: Context) => {
	const state: Record<string, BridgeStatus> = Object.create(null)
	for (const adapter of listAdapters()) {
		state[adapter.name] = {
			platform: adapter.name as Platform,
			state: 'detached',
			messageCount: 0,
		}
	}

	const channel = new EvtChannel<(snapshot: StatusSnapshot) => void | Promise<void>>(ctx)
	const emit = () => channel.emit({ bridges: Object.values(state) })

	const ensure = (platform: Platform) => {
		if (!state[platform]) {
			state[platform] = { platform, state: 'detached', messageCount: 0 }
		}
		return state[platform]
	}

	const setAttached = (platform: Platform) => {
		const s = ensure(platform)
		s.state = 'attached'
		s.attachedAt = Date.now()
		emit()
	}

	const setDetached = (platform: Platform) => {
		const s = ensure(platform)
		s.state = 'detached'
		emit()
	}

	const markMessage = (platform: Platform) => {
		const s = ensure(platform)
		s.messageCount += 1
		s.lastMessageAt = Date.now()
		emit()
	}

	return {
		channel,
		snapshot: (): StatusSnapshot => ({ bridges: Object.values(state) }),
		setAttached,
		setDetached,
		markMessage,
	}
}

export type BridgeStatusTracker = ReturnType<typeof createStatusTracker>

