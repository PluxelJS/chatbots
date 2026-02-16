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

function makePerms() {
	const declaredExact = new Set<string>()
	const declaredStar = new Set<string>()
	return {
		registry: { getNamespaceEpoch: (_nsIndex: number) => 1 },
		resolver: {
			resolve: (node: string) => (declaredExact.has(node) ? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1 } as any) : null),
			resolveGrant: (node: string) =>
				declaredStar.has(node)
					? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1, kind: 'star', local: 'cmd', nsKey: 'owner' } as any)
					: null,
		},
		declareExact: (nsKey: string, local: string) => void declaredExact.add(`${nsKey}.${local}`),
		declareStar: (nsKey: string, localPrefix: string) => void declaredStar.add(`${nsKey}.${localPrefix}.*`),
		authorizeUserFast: async () => Decision.Allow,
	} as any
}

describe('chatbots cmd kit', () => {
	it('registers command via kit.command()', async () => {
		const perms = makePerms()
		const owner = {
			pluginInfo: { id: 'owner' },
			effects: { defer: (_fn: any) => ({ dispose: async () => {}, cancel: () => {} }) },
		} as any satisfies Context

		const registry = new CommandRegistry<Ctx>({ caseInsensitive: true })
		const kit = createPermissionCommandKit(registry as any, perms, { owner, scopeKey: 'owner' })

		kit.command({ localId: 'ping', triggers: ['ping'] }, (c) => c.handle(() => 'pong'))

		expect(kit.list().find((x) => x.name === 'ping')?.permNode).toBe('owner.cmd.ping')

		const ctx: Ctx = {
			user: { id: 1 },
			identity: { platform: 'telegram', platformUserId: 'u1' },
			msg: { platform: 'telegram', channel: { id: 10 } },
		}

		const r = await registry.router.dispatch('ping', ctx)
		expect(r.ok).toBe(true)
		expect((r as any).val).toBe('pong')
	})

	it('supports kit.scope() for subcommands', () => {
		const perms = makePerms()
		const owner = {
			pluginInfo: { id: 'owner' },
			effects: { defer: (_fn: any) => ({ dispose: async () => {}, cancel: () => {} }) },
		} as any satisfies Context

		const registry = new CommandRegistry<Ctx>({ caseInsensitive: true })
		const kit = createPermissionCommandKit(registry as any, perms, { owner, scopeKey: 'owner' })

		kit.scope('meme').command({ localId: 'list', triggers: ['meme list'] }, (c) => c.handle(() => 'ok'))
		expect(kit.list().find((x) => x.name === 'meme list')?.permNode).toBe('owner.cmd.meme.list')
	})
})

