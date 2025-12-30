import type { Snapshot, GatewayState } from '../bot/websocket'

export type KookBotLifecycleState =
	| 'initializing'
	| 'fetching_profile'
	| 'registering_gateway'
	| 'webhook'
	| 'api_only'
	| 'stopped'
	| 'error'
	| GatewayState

export interface KookBotStatus {
	instanceId: string
	botId?: string
	username?: string
	displayName?: string
	state: KookBotLifecycleState
	stateMessage?: string
	startedAt: number
	updatedAt: number
	lastEventAt?: number
	lastSequence?: number
	lastError?: string
	gateway?: Snapshot
}

export const createInitialStatus = (instanceId: string): KookBotStatus => {
	const now = Date.now()
	return {
		instanceId,
		state: 'initializing',
		startedAt: now,
		updatedAt: now,
	}
}
