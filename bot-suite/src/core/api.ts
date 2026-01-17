import type {} from '@pluxel/hmr/services'

import type {
	PermissionCatalogNamespace,
	PermissionExplainDto,
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
	PermissionExplainDto,
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

declare module '@pluxel/hmr/services' {
	namespace UI {
		interface rpc {
			'bot-suite': ChatbotsRpc
		}

		interface sse {
			'bot-suite': SandboxEvent
		}
	}
}
