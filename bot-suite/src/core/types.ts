import type { AnyMessage, Platform } from 'pluxel-plugin-bot-core'
import type { ExecCtx } from '@pluxel/cmd'

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

export interface ChatbotsCommandContext<M extends AnyMessage = AnyMessage> extends ExecCtx {
	msg: M
	user: UnifiedUser
	identity: UnifiedIdentity
}
