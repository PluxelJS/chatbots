import { describe, expect, it } from 'vitest'

import { CommandRegistry } from '../runtime/command-registry'
import { createPermissionCommandKit } from './kit'
import { Decision } from '../../permissions/decision'

type Ctx = {
	user: { id: number }
	identity: { platform: string; platformUserId: string }
	msg: { platform: string; channel: { id: string | number } }
}

describe('chatbots cmd rates plugin', () => {
	it('blocks after first allowed hit (cooldown)', async () => {
		const declaredExact = new Set<string>()
		const declaredStar = new Set<string>()
		const perms = {
			registry: { getNamespaceEpoch: (_nsIndex: number) => 1 },
			resolver: {
				resolve: (node: string) =>
					declaredExact.has(node) ? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1 } as any) : null,
				resolveGrant: (node: string) =>
					declaredStar.has(node)
						? ({ nsIndex: 0, path: new Uint32Array([1]), ver: 1, kind: 'star', local: 'cmd', nsKey: 'owner' } as any)
						: null,
			},
			declareExact: (nsKey: string, local: string) => void declaredExact.add(`${nsKey}.${local}`),
			declareStar: (nsKey: string, localPrefix: string) => void declaredStar.add(`${nsKey}.${localPrefix}.*`),
			authorizeUserFast: async () => Decision.Allow,
		} as any

		let hits = 0
		const rates = {
			cooldown: async () => {
				hits++
				return hits === 1 ? ({ ok: true } as const) : ({ ok: false, retryAfterMs: 1000 } as const)
			},
			fixedWindow: async () => ({ ok: true } as const),
			tokenBucket: async () => ({ ok: true } as const),
		} as any

		const owner = {
			pluginInfo: { id: 'owner' },
			effects: { defer: (_fn: any) => ({ dispose: async () => {}, cancel: () => {} }) },
		} as any

		const registry = new CommandRegistry<Ctx>({ caseInsensitive: true })
		const kit = createPermissionCommandKit(registry as any, perms, { owner, scopeKey: 'owner', rates })

		kit.command({ localId: 'ping', triggers: ['ping'], rates: { rule: { type: 'cooldown', ttlMs: 1000 } } }, (c) =>
			c.handle(() => 'pong'),
		)

		const ctx: Ctx = {
			user: { id: 1 },
			identity: { platform: 'telegram', platformUserId: 'u1' },
			msg: { platform: 'telegram', channel: { id: 10 } },
		}

		{
			const r = await registry.router.dispatch('ping', ctx)
			expect(r.ok).toBe(true)
			expect((r as any).val).toBe('pong')
		}

		{
			const r = await registry.router.dispatch('ping', ctx)
			expect(r.ok).toBe(false)
			expect((r as any).err).toMatchObject({ name: 'CmdError', code: 'E_RATE_LIMITED' })
		}
	})
})

