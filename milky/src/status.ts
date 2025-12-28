import type { MilkyEventTransport } from './config'

export type MilkyBotState = 'initializing' | 'connecting' | 'online' | 'error' | 'stopped'

export type MilkyBotStatus = {
	instanceId: string
	state: MilkyBotState
	stateMessage?: string
	lastError?: string

	baseUrl: string
	transport: MilkyEventTransport
	tokenPreview: string

	selfId?: number
	nickname?: string

	implName?: string
	implVersion?: string
	milkyVersion?: string
	qqProtocolType?: string
	qqProtocolVersion?: string

	lastEventAt?: number
	connectedAt?: number

	startedAt: number
	updatedAt: number
}

export const createInitialStatus = (
	instanceId: string,
	baseUrl: string,
	tokenPreview: string,
	transport: MilkyEventTransport,
): MilkyBotStatus => {
	const now = Date.now()
	return {
		instanceId,
		state: 'initializing',
		baseUrl,
		transport,
		tokenPreview,
		startedAt: now,
		updatedAt: now,
		stateMessage: '等待连接',
	}
}

