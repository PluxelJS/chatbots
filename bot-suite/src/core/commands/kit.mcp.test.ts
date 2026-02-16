import { describe, expect, it } from 'vitest'

import type { Context } from '@pluxel/hmr'

import { CommandRegistry } from '../runtime/command-registry'
import { createPermissionCommandKit } from './kit'
import { Decision } from '../../permissions/decision'

type Ctx = {
	user: { id: number }
	identity: { platform: string; platformUserId: string }
	msg: { platform: string; channel: { id: string | number } }
}

describe('chatbots cmdkit mcp opt-in', () => {
	it('registers MCP metadata for commands and ops when mcp is provided', () => {
		const perms = {
			registry: { getNamespaceEpoch: (_nsIndex: number) => 1 },
			resolver: { resolve: () => null, resolveGrant: () => null },
			declareExact: () => {},
			declareStar: () => {},
			authorizeUserFast: async () => Decision.Allow,
		} as any

			const owner = {
				pluginInfo: { id: 'owner' },
				effects: { defer: (_fn: any) => ({ dispose: async () => {}, cancel: () => {} }) },
			} as any satisfies Context

			const registry = new CommandRegistry<Ctx>({ caseInsensitive: true })
			const kit = createPermissionCommandKit(registry as any, perms, { owner, scopeKey: 'owner' })

			kit.command(
				{ localId: 'ping', triggers: ['ping'], mcp: { title: 'Ping', description: 'Ping command' }, perm: false },
				(c) => c.handle(() => 'pong'),
			)
			kit.op({ localId: 'health', mcp: { title: 'Health', description: 'Health op' } }, (o) => o.handle(() => 'ok'))

			const mcp = registry.listMcpTools()
			expect(mcp.some((x) => x.id === 'owner.cmd.ping')).toBe(true)
			expect(mcp.some((x) => x.id === 'owner.cmd.health')).toBe(true)
			expect(mcp.find((x) => x.id === 'owner.cmd.ping')?.mcp.name).toBe('owner.ping')
		})
	})
