import { describe, expect, it } from 'vitest'

import { cmd } from '../cmd'
import {
	CHAT_COMMAND_PASS,
	createChatCommandRouter,
	handleChatCommand,
} from '../chat/commands'

describe('chat/handleChatCommand', () => {
		it('auto replies for string result', async () => {
			const router = createChatCommandRouter()
			router.add(
				cmd('ping')
					.text({ triggers: ['ping'] })
					.handle(() => 'pong')
					.build(),
			)

		const replies: any[] = []
		const msg = {
			textRaw: '/ping',
			text: '/ping',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, router)
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(replies).toEqual([[{ type: 'text', text: 'pong' }]])
	})

		it('treats void result as handled (no auto reply)', async () => {
		const router = createChatCommandRouter()
		let ran = false
			router.add(
				cmd('silent')
					.text({ triggers: ['silent'] })
					.handle(() => {
						ran = true
						return undefined
					})
				.build(),
		)

		const replies: any[] = []
		const msg = {
			textRaw: '/silent',
			text: '/silent',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, router)
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(ran).toBe(true)
		expect(replies).toEqual([])
	})

	it('returns unknown_command when no command matches', async () => {
		const router = createChatCommandRouter()

		const replies: any[] = []
		const msg = {
			textRaw: '/missing',
			text: '/missing',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, router)
		expect(res.handled).toBe(false)
		expect(res.kind).toBe('unknown_command')
		expect(replies).toEqual([])
	})

		it('supports telegram-style /cmd@botname stripping', async () => {
		const router = createChatCommandRouter()
			router.add(
				cmd('ping')
					.text({ triggers: ['ping'] })
					.handle(() => 'pong')
					.build(),
			)

		const replies: any[] = []
		const msg = {
			textRaw: '/ping@mybot',
			text: '/ping@mybot',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, router)
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(replies).toEqual([[{ type: 'text', text: 'pong' }]])
	})

		it('allows passing through via CHAT_COMMAND_PASS', async () => {
		const router = createChatCommandRouter()
			router.add(
				cmd('pass')
					.text({ triggers: ['pass'] })
					.handle(() => CHAT_COMMAND_PASS)
					.build(),
			)

		const replies: any[] = []
		const msg = {
			textRaw: '/pass',
			text: '/pass',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, router)
		expect(res.handled).toBe(false)
		expect(res.kind).toBe('passed_through')
		expect(replies).toEqual([])
	})

		it('default ChatCommandCtx includes actorId/traceId/now', async () => {
			const router = createChatCommandRouter()
			router.add(
				cmd('secure')
					.text({ triggers: ['secure'] })
					.handle((_input, ctx) => `${ctx.actorId}:${ctx.traceId ? 't' : 'no-t'}:${typeof ctx.now === 'number' ? 'n' : 'no-n'}`)
					.build(),
			)

		const replies: any[] = []
		const msg = {
			platform: 'telegram',
			textRaw: '/secure',
			text: '/secure',
			messageId: 123,
			user: { id: 42 },
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, router)
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(replies[0]?.[0]?.text).toContain('42:')
	})

		it('makeCtx can override chat execution ctx', async () => {
		const router = createChatCommandRouter()
			router.add(
				cmd('secure')
					.text({ triggers: ['secure'] })
					.handle((_input, ctx) => ctx.actorId)
					.build(),
			)

		const replies: any[] = []
		const msg = {
			textRaw: '/secure',
			text: '/secure',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, router, {
			makeCtx: () => ({ msg, actorId: 'u1', now: 1 }),
		})
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(replies[0]?.[0]?.text).toBe('u1')
	})
})
