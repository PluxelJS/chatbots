import type { Platform } from 'pluxel-plugin-bot-core'

export type UnifiedIdentityDto = {
	platform: Platform
	platformUserId: string
}

export type UnifiedUserDto = {
	id: number
	displayName: string | null
	createdAt: string
	identities: UnifiedIdentityDto[]
}
