import { describe, expect, it } from 'vitest'

import { normalizeReplyPayload } from '../outbound/payload'

describe('bot-core normalizeReplyPayload()', () => {
	it('renders plain objects as json codeblock', () => {
		const payload = normalizeReplyPayload({ a: 1 })
		expect(payload).toEqual([{ type: 'codeblock', language: 'json', code: '{\n  "a": 1\n}' }])
	})

	it('renders arrays of objects as json codeblock', () => {
		const payload = normalizeReplyPayload([{ a: 1 }, { b: 2 }])
		expect(payload).toEqual([
			{ type: 'codeblock', language: 'json', code: '[\n  {\n    "a": 1\n  },\n  {\n    "b": 2\n  }\n]' },
		])
	})

	it('does not throw on circular objects', () => {
		const obj: any = { a: 1 }
		obj.self = obj
		const payload = normalizeReplyPayload(obj)
		expect(payload?.[0]?.type).toBe('codeblock')
		expect((payload as any)[0].code).toContain('[Circular]')
	})
})

