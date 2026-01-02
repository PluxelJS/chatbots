import type {} from '@pluxel/hmr/web'

import type {
	PermissionCatalogNamespace,
	PermissionGrantDto,
	PermissionRoleDto,
} from './permissions-types'
import type {
	SandboxCommand,
	SandboxCommandsSnapshot,
	SandboxEvent,
	SandboxMessage,
	SandboxPart,
	SandboxSendInput,
	SandboxSendResult,
	SandboxSnapshot,
} from './sandbox/types'
import type { UnifiedUserDto } from './user-types'
import type { ChatbotsRpc } from './rpc/chatbots-rpc'

export type PermissionEffect = 'allow' | 'deny'
export type PermissionSubjectType = 'user' | 'role'

export type RolePatch = {
	parentRoleId?: number | null
	rank?: number
	name?: string | null
}

export { ChatbotsRpc } from './rpc/chatbots-rpc'

export type {
	PermissionCatalogNamespace,
	PermissionGrantDto,
	PermissionRoleDto,
	SandboxCommand,
	SandboxCommandsSnapshot,
	SandboxEvent,
	SandboxMessage,
	SandboxPart,
	SandboxSendInput,
	SandboxSendResult,
	SandboxSnapshot,
	UnifiedUserDto,
}

declare module '@pluxel/hmr/web' {
	namespace UI {
	interface rpc {
		chatbots: ChatbotsRpc
	}

	interface sse {
		chatbots: SandboxEvent
	}
	}

}
