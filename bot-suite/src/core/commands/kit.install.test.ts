import { describe, expect, it } from 'vitest'

import type { Context } from '@pluxel/hmr'
import { CommandRegistry } from '../runtime/command-registry'
import { createPermissionCommandKit } from './kit'
import { ChatCommand } from './decorators'
import { cmd } from './draft'
import { Decision } from '../../permissions/decision'

type Ctx = {
	user: { id: number }
	identity: { platform: string; platformUserId: string }
	msg: { platform: string; channel: { id: string | number } }
}

describe('chatbots cmd decorators', () => {
	it('supports property draft + install()', async () => {
		const declaredExact = new Set<string>()
		const declaredStar = new Set<string>()
		const perms = {
			registry: { getNamespaceEpoch: (_nsIndex: number) => 1 },
			resolver: {
				resolve: (node: string) => (declaredExact.has(node) ? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1 } as any) : null),
				resolveGrant: (node: string) => (declaredStar.has(node) ? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1, kind: 'star', local: 'cmd', nsKey: 'owner' } as any) : null),
			},
			declareExact: (nsKey: string, local: string) => void declaredExact.add(`${nsKey}.${local}`),
			declareStar: (nsKey: string, localPrefix: string) => void declaredStar.add(`${nsKey}.${localPrefix}.*`),
			authorizeUserFast: async () => Decision.Allow,
		} as any

		const owner = {
			pluginInfo: { id: 'owner' },
			effects: { defer: (_fn: any) => ({ dispose: async () => {}, cancel: () => {} }) },
		} as any satisfies Context

		const registry = new CommandRegistry<Ctx>({ caseInsensitive: true })
		const kit = createPermissionCommandKit(registry as any, perms, { owner, scopeKey: 'owner' })

		class P {
			@ChatCommand({ triggers: ['ping'] })
			ping = cmd<Ctx>().argv().handle(() => 'pong')
		}

		const p = new P()
		kit.install(p)

		expect(kit.list().find((x) => x.name === 'ping')?.permNode).toBe('owner.cmd.ping')

		const ctx: Ctx = {
			user: { id: 1 },
			identity: { platform: 'telegram', platformUserId: 'u1' },
			msg: { platform: 'telegram', channel: { id: 10 } },
		}

		return registry.router.dispatch('ping', ctx).then((r: any) => {
			expect(r.ok).toBe(true)
			expect(r.val).toBe('pong')
		})
	})

	it('supports kit.scope() for subcommands', () => {
		const declaredExact = new Set<string>()
		const declaredStar = new Set<string>()
		const perms = {
			registry: { getNamespaceEpoch: (_nsIndex: number) => 1 },
			resolver: {
				resolve: (node: string) => (declaredExact.has(node) ? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1 } as any) : null),
				resolveGrant: (node: string) => (declaredStar.has(node) ? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1, kind: 'star', local: 'cmd', nsKey: 'owner' } as any) : null),
			},
			declareExact: (nsKey: string, local: string) => void declaredExact.add(`${nsKey}.${local}`),
			declareStar: (nsKey: string, localPrefix: string) => void declaredStar.add(`${nsKey}.${localPrefix}.*`),
			authorizeUserFast: async () => Decision.Allow,
		} as any

		const owner = {
			pluginInfo: { id: 'owner' },
			effects: { defer: (_fn: any) => ({ dispose: async () => {}, cancel: () => {} }) },
		} as any satisfies Context

		const registry = new CommandRegistry<Ctx>({ caseInsensitive: true })
		const kit = createPermissionCommandKit(registry as any, perms, { owner, scopeKey: 'owner' })

		class P {
			@ChatCommand({ triggers: ['meme list'] })
			list = cmd<Ctx>().argv().handle(() => 'ok')
		}

		kit.scope('meme').install(new P())
		expect(kit.list().find((x) => x.name === 'meme list')?.permNode).toBe('owner.cmd.meme.list')
	})
})
