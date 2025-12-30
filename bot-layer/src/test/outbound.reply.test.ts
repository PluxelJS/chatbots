import { describe, expect, it } from 'bun:test'

import { createReply } from '../platforms/base'
import type { PlatformAdapter } from '../platforms/base'
import type { ImagePart, OutboundText, PlatformCapabilities } from '../types'

type Call =
	| { type: 'text'; text: string }
	| { type: 'image'; url?: string; caption?: string }

const makeAdapter = (capabilities: PlatformCapabilities, calls: Call[]): PlatformAdapter<'telegram'> => ({
	name: 'telegram',
	capabilities,
	render: (parts) => ({
		text: parts
			.map((p) => {
				if (p.type === 'text') return p.text
				if (p.type === 'codeblock') return p.code
				if (p.type === 'mention') return `@${p.id ?? p.kind}`
				if (p.type === 'link') return p.label ?? p.url
				if (p.type === 'styled') return p.children.map((c) => (c.type === 'text' ? c.text : '')).join('')
				return ''
			})
			.join(''),
		format: capabilities.format,
	}),
	sendText: async (_session, text: OutboundText) => {
		calls.push({ type: 'text', text: text.rendered.text })
	},
	sendImage: async (_session, image, caption) => {
		calls.push({ type: 'image', url: image.url, caption: caption?.rendered.text })
	},
	sendFile: async () => {},
	uploadImage: async (_session, image) => image,
	uploadFile: async (_session, file) => file,
})

const baseCaps = (overrides: Partial<PlatformCapabilities> = {}): PlatformCapabilities => ({
	format: 'plain',
	supportsQuote: true,
	supportsImage: true,
	supportsFile: true,
	supportsMixedMedia: true,
	supportsInlineMention: { user: true, role: true, channel: true, everyone: true },
	...overrides,
})

const img = (url = 'https://example.com/a.png'): ImagePart => ({ type: 'image', url })

describe('bot-layer outbound reply()', () => {
	it('splits single image caption on no-mixed platforms (auto order)', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(baseCaps({ supportsMixedMedia: false }), calls)
		const reply = createReply(adapter, {} as any)

		await reply(['cap', img()], undefined)
		expect(calls).toEqual([{ type: 'text', text: 'cap' }, { type: 'image', url: 'https://example.com/a.png', caption: undefined }])

		calls.length = 0
		await reply([img(), 'cap'], undefined)
		expect(calls).toEqual([{ type: 'image', url: 'https://example.com/a.png', caption: undefined }, { type: 'text', text: 'cap' }])
	})

	it('can forbid splitting single image caption', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(baseCaps({ supportsMixedMedia: false }), calls)
		const reply = createReply(adapter, {} as any)

		await expect(reply([img(), 'cap'], { splitFallback: 'forbid' })).rejects.toThrow()
		expect(calls).toEqual([])
	})

	it('falls back to split when caption exceeds maxCaptionLength', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(baseCaps({ supportsMixedMedia: true, maxCaptionLength: 3 }), calls)
		const reply = createReply(adapter, {} as any)

		await reply([img(), '1234'], undefined)
		expect(calls).toEqual([
			{ type: 'image', url: 'https://example.com/a.png', caption: undefined },
			{ type: 'text', text: '1234' },
		])
	})

	it('can forbid splitting on caption-too-long fallback', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(baseCaps({ supportsMixedMedia: true, maxCaptionLength: 3 }), calls)
		const reply = createReply(adapter, {} as any)

		await expect(reply([img(), '1234'], { splitFallback: 'forbid' })).rejects.toThrow()
		expect(calls).toEqual([])
	})

	it('sends mixed image + caption when within maxCaptionLength', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(baseCaps({ supportsMixedMedia: true, maxCaptionLength: 10 }), calls)
		const reply = createReply(adapter, {} as any)

		await reply([img(), '1234'], undefined)
		expect(calls).toEqual([{ type: 'image', url: 'https://example.com/a.png', caption: '1234' }])
	})

	it('does not bind caption when text appears on both sides of an image', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(baseCaps({ supportsMixedMedia: true, maxCaptionLength: 10 }), calls)
		const reply = createReply(adapter, {} as any)

		await reply(['pre', img(), 'post'], undefined)
		expect(calls).toEqual([
			{ type: 'text', text: 'pre' },
			{ type: 'image', url: 'https://example.com/a.png', caption: undefined },
			{ type: 'text', text: 'post' },
		])
	})
})
