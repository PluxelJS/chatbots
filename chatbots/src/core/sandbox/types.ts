import type { Part, Platform } from '@pluxel/bot-layer'

export type SandboxRole = 'user' | 'bot' | 'system'

type SandboxBinary = string | Uint8Array | ArrayBufferLike | number[]

export type SandboxCommand = {
	name: string
	usage: string
	aliases: string[]
	desc?: string
	group?: string
}

export type SandboxPart = Part extends infer P
	? P extends { data?: unknown }
		? Omit<P, 'data'> & { data?: SandboxBinary }
		: P
	: never

export type SandboxMessage = {
	id: string
	role: SandboxRole
	parts: SandboxPart[]
	text: string
	platform?: Platform
	userId?: string | number
	channelId?: string | number
	createdAt: number
}

export type SandboxSnapshot = {
	messages: SandboxMessage[]
}

export type SandboxContent = string | SandboxPart[]

export type SandboxCommandsSnapshot = {
	prefix: string
	commands: SandboxCommand[]
}

export type SandboxSendInput = {
	content: SandboxContent
	platform?: Platform
	userId?: string | number
	channelId?: string | number
	mockRoleIds?: number[]
	mockUser?: {
		displayName?: string
		username?: string
		avatar?: string
		isBot?: boolean
	}
	mockChannel?: {
		name?: string
		isPrivate?: boolean
	}
}

export type SandboxSendResult = {
	messages: SandboxMessage[]
}

export type SandboxEvent =
	| {
			type: 'sync'
			messages: SandboxMessage[]
	  }
	| {
			type: 'append'
			messages: SandboxMessage[]
	  }
