import type { AnyMessage, Platform } from 'pluxel-plugin-bot-core'

export type UnifiedPlatformUserId = string

export interface UnifiedIdentity {
	platform: Platform
	platformUserId: UnifiedPlatformUserId
}

export interface UnifiedUser {
	id: number
	identities: UnifiedIdentity[]
	displayName: string | null
	createdAt: Date
}

export interface ChatbotsCommandContext<M extends AnyMessage = AnyMessage> {
	msg: M
	user: UnifiedUser
	identity: UnifiedIdentity
}
