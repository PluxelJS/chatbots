import { describe, expect, test } from 'bun:test'
import { hasRichParts } from './inspect'
import type { Part } from './model'

describe('hasRichParts', () => {
	test('detects any media part', () => {
		const base: Part[] = [{ type: 'text', text: 'hi' }]
		expect(hasRichParts(base)).toBe(false)
		expect(hasRichParts([...base, { type: 'image', url: 'https://example.com/a.png' }])).toBe(true)
		expect(hasRichParts([...base, { type: 'audio', url: 'https://example.com/a.mp3' }])).toBe(true)
		expect(hasRichParts([...base, { type: 'video', url: 'https://example.com/a.mp4' }])).toBe(true)
		expect(hasRichParts([...base, { type: 'file', url: 'https://example.com/a.pdf' }])).toBe(true)
	})
})

