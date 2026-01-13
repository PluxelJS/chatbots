import { describe, expect, it } from 'bun:test'

import { createCommandBus, defineCommand } from '../cmd'

describe('cmd/createCommandBus', () => {
	it('prefers longest match (foo bar over foo)', async () => {
		const bus = createCommandBus<{ hits: string[] }>({ caseInsensitive: true })
		bus.register(
			defineCommand({
				pattern: 'foo',
				flags: {},
				action: (_argv, ctx) => {
					ctx.hits.push('foo')
					return 'foo'
				},
			}),
		)
		bus.register(
			defineCommand({
				pattern: 'foo bar',
				flags: {},
				action: (_argv, ctx) => {
					ctx.hits.push('foo bar')
					return 'foo bar'
				},
			}),
		)

		const ctx = { hits: [] as string[] }
		const out = await bus.dispatch('foo bar', ctx)
		expect(out).toBe('foo bar')
		expect(ctx.hits).toEqual(['foo bar'])
	})

	it('dispatchDetailed distinguishes unknown from void result', async () => {
		const bus = createCommandBus<{ ran: boolean }>({ caseInsensitive: true })
		bus.register(
			defineCommand({
				pattern: 'noop',
				flags: {},
				action: (_argv, ctx) => {
					ctx.ran = true
					return undefined
				},
			}),
		)

		const ctx = { ran: false }

		const unknown = await bus.dispatchDetailed('missing', ctx)
		expect(unknown.matched).toBe(false)
		expect(ctx.ran).toBe(false)

		const hit = await bus.dispatchDetailed('noop', ctx)
		expect(hit.matched).toBe(true)
		expect(ctx.ran).toBe(true)
		expect((hit as any).result).toBeUndefined()
	})
})

