import { describe, expect, it } from 'bun:test'

import { CommandError, createCommandBus } from 'pluxel-plugin-bot-core'
import { createCommandKit } from 'pluxel-plugin-bot-core'

import { createRatesPlugin } from './kit'

type Ctx = {
	user: { id: number }
	identity: { platform: string; platformUserId: string }
	msg: { platform: string; channel: { id: string | number } }
}

describe('chatbots cmd rates plugin', () => {
	it('blocks after first allowed hit (cooldown)', async () => {
		let hits = 0
		const rates = {
			cooldown: async () => {
				hits++
				return hits === 1 ? ({ ok: true } as const) : ({ ok: false, retryAfterMs: 1000 } as const)
			},
			fixedWindow: async () => ({ ok: true } as const),
			tokenBucket: async () => ({ ok: true } as const),
		} as any

		const bus = createCommandBus<Ctx>({ caseInsensitive: true })
		const kit = createCommandKit(bus as any, { plugins: [createRatesPlugin(rates, { scopeKey: 'owner' })] })

		;(kit.reg('ping') as any)
			.rates({ type: 'cooldown', ttlMs: 1000 })
			.action(() => 'pong')

		const ctx: Ctx = {
			user: { id: 1 },
			identity: { platform: 'telegram', platformUserId: 'u1' },
			msg: { platform: 'telegram', channel: { id: 10 } },
		}

		expect(await bus.dispatch('ping', ctx)).toBe('pong')
		await expect(bus.dispatch('ping', ctx)).rejects.toBeInstanceOf(CommandError)
	})
})
