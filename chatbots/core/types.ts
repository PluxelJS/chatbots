import type { AnyMessage, Platform } from '@pluxel/bot-layer'

export type UnifiedPlatformUserId = string

export interface UnifiedIdentity {
	platform: Platform
	platformUserId: UnifiedPlatformUserId
}

export interface UnifiedUser {
	id: number
	identities: UnifiedIdentity[]
	createdAt: Date
}

export interface ChatbotsCommandContext<M extends AnyMessage = AnyMessage> {
	msg: M
	user: UnifiedUser
	identity: UnifiedIdentity
}
