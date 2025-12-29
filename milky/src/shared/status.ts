export type MilkyBotState = 'initializing' | 'connecting' | 'online' | 'error' | 'stopped'

export type MilkyBotStatus = {
	instanceId: string
	state: MilkyBotState
	stateMessage?: string
	lastError?: string

	baseUrl: string
	tokenPreview: string

	selfId?: number
	nickname?: string

	implName?: string
	implVersion?: string
	milkyVersion?: string
	qqProtocolType?: string
	qqProtocolVersion?: string

	lastEventAt?: number
	lastEventType?: string
	connectedAt?: number

	startedAt: number
	updatedAt: number
}

export const createInitialStatus = (
	instanceId: string,
	baseUrl: string,
	tokenPreview: string,
): MilkyBotStatus => {
	const now = Date.now()
	return {
		instanceId,
		state: 'initializing',
		baseUrl,
		tokenPreview,
		startedAt: now,
		updatedAt: now,
		stateMessage: '等待连接',
	}
}
