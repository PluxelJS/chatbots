export type TelegramBotState =
	| 'initializing'
	| 'authenticating'
	| 'polling'
	| 'webhook'
	| 'api'
	| 'stopped'
	| 'error'

export interface TelegramBotStatus {
	instanceId: string
	tokenSuffix: string
	mode: 'polling' | 'webhook' | 'api'
	state: TelegramBotState
	stateMessage?: string
	username?: string
	displayName?: string
	startedAt: number
	updatedAt: number
	lastUpdateId?: number
	lastUpdateAt?: number
	lastError?: string
	polling?: {
		offset: number
		backoffIndex: number
	}
	webhook?: {
		url?: string
		secretToken?: string
	}
}

export const createInitialStatus = (
	instanceId: string,
	mode: 'polling' | 'webhook' | 'api',
	token: string,
): TelegramBotStatus => {
	const now = Date.now()
	return {
		instanceId,
		mode,
		tokenSuffix: obfuscateToken(token),
		state: 'initializing',
		startedAt: now,
		updatedAt: now,
	}
}

const obfuscateToken = (token: string) => {
	if (token.length <= 6) return token
	return `${token.slice(0, 4)}…${token.slice(-4)}`
}
