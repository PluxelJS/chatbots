import { describe, expect, test } from 'bun:test'
import { __parts } from './runtime'
import { parts } from './tag'
import { mentionUser, text } from './dsl'
import type { Part } from './model'

describe('__parts runtime', () => {
	test('merges adjacent string segments into one text part', () => {
		const out = __parts(['a', 'b', 'c'], []) as Part[]
		expect(out).toEqual([{ type: 'text', text: 'abc' }])
	})

	test('interleaves strings and expressions', () => {
		const m = mentionUser(1) as Part
		const out = __parts(['hi ', ''], [m]) as Part[]
		expect(out).toEqual([{ type: 'text', text: 'hi ' }, m])
	})

	test('merges adjacent text parts', () => {
		const out = __parts(['hi ', ''], [text(1)]) as Part[]
		expect(out).toEqual([{ type: 'text', text: 'hi 1' }])
	})
})

describe('parts tag (type anchor)', () => {
	test('works as tagged template at runtime (dev fallback)', () => {
		const out = parts`hi ${text(1)}` as Part[]
		expect(out).toEqual([{ type: 'text', text: 'hi 1' }])
	})

	test('rejects non-tagged invocation', () => {
		expect(() => (parts as any)(['x'], [])).toThrow(/tagged template/)
	})
})
