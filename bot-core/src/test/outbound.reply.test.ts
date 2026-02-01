import { describe, expect, it } from 'vitest'

import { createReply } from '../adapter'
import type { OutboundOp, PlatformAdapter } from '../adapter'
import type { AdapterPolicy, ImagePart, OutboundText, Part } from '../types'

type Call =
	| { type: 'text'; text: string }
	| { type: 'image'; url?: string; caption?: string }

const makeAdapter = (policy: AdapterPolicy, calls: Call[]): PlatformAdapter<'telegram'> => ({
	name: 'telegram',
	policy,
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
		format: policy.text.format,
	}),
	uploadMedia: async (_session, media) => media,
	send: async (_session, op: OutboundOp) => {
		switch (op.type) {
			case 'text':
				calls.push({ type: 'text', text: op.text.rendered.text })
				return
			case 'image':
				calls.push({ type: 'image', url: op.image.url, caption: op.caption?.rendered.text })
				return
			case 'file':
			case 'audio':
			case 'video':
				return
		}
	},
})

const basePolicy = (overrides: Partial<AdapterPolicy> = {}): AdapterPolicy => ({
	text: {
		format: 'plain',
		inlineMention: { user: 'native', role: 'native', channel: 'native', everyone: 'native' },
		...overrides.text,
	},
	outbound: {
		supportsQuote: true,
		supportsMixedMedia: true,
		supportedOps: ['text', 'image', 'audio', 'video', 'file'],
		...overrides.outbound,
	},
})

const text = (value: string): Part => ({ type: 'text', text: value })
const img = (url = 'https://example.com/a.png'): ImagePart => ({ type: 'image', url })

describe('bot-core outbound reply()', () => {
	it('splits single image caption on no-mixed platforms (auto order)', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(basePolicy({ outbound: { supportsMixedMedia: false } }), calls)
		const reply = createReply(adapter, {} as any)

		await reply([text('cap'), img()], undefined)
		expect(calls).toEqual([{ type: 'text', text: 'cap' }, { type: 'image', url: 'https://example.com/a.png', caption: undefined }])

		calls.length = 0
		await reply([img(), text('cap')], undefined)
		expect(calls).toEqual([{ type: 'image', url: 'https://example.com/a.png', caption: undefined }, { type: 'text', text: 'cap' }])
	})

	it('strict mode still sends on no-mixed platforms (order preserved)', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(basePolicy({ outbound: { supportsMixedMedia: false } }), calls)
		const reply = createReply(adapter, {} as any)

		await reply([img(), text('cap')], { mode: 'strict' })
		expect(calls).toEqual([{ type: 'image', url: 'https://example.com/a.png', caption: undefined }, { type: 'text', text: 'cap' }])
	})

	it('falls back to split when caption exceeds maxCaptionLength', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(basePolicy({ outbound: { supportsMixedMedia: true, maxCaptionLength: 3 } }), calls)
		const reply = createReply(adapter, {} as any)

		await reply([img(), text('1234')], undefined)
		expect(calls).toEqual([
			{ type: 'image', url: 'https://example.com/a.png', caption: undefined },
			{ type: 'text', text: '1234' },
		])
	})

	it('strict mode throws when caption exceeds maxCaptionLength', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(basePolicy({ outbound: { supportsMixedMedia: true, maxCaptionLength: 3 } }), calls)
		const reply = createReply(adapter, {} as any)

		await expect(reply([img(), text('1234')], { mode: 'strict' })).rejects.toThrow()
		expect(calls).toEqual([])
	})

	it('sends mixed image + caption when within maxCaptionLength', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(basePolicy({ outbound: { supportsMixedMedia: true, maxCaptionLength: 10 } }), calls)
		const reply = createReply(adapter, {} as any)

		await reply([img(), text('1234')], undefined)
		expect(calls).toEqual([{ type: 'image', url: 'https://example.com/a.png', caption: '1234' }])
	})

	it('does not bind caption when text appears on both sides of an image', async () => {
		const calls: Call[] = []
		const adapter = makeAdapter(basePolicy({ outbound: { supportsMixedMedia: true, maxCaptionLength: 10 } }), calls)
		const reply = createReply(adapter, {} as any)

		await reply([text('pre'), img(), text('post')], undefined)
		expect(calls).toEqual([
			{ type: 'text', text: 'pre' },
			{ type: 'image', url: 'https://example.com/a.png', caption: undefined },
			{ type: 'text', text: 'post' },
		])
	})
})
