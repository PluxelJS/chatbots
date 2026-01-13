import { describe, expect, it } from 'bun:test'

import { defineCommand } from '../cmd'
import {
	CHAT_COMMAND_PASS,
	createChatCommandBus,
	handleChatCommand,
} from '../chat/commands'

describe('chat/handleChatCommand', () => {
	it('auto replies for string result', async () => {
		const bus = createChatCommandBus()
		bus.register(
			defineCommand({
				pattern: 'ping',
				flags: {},
				action: () => 'pong',
			}) as any,
		)

		const replies: any[] = []
		const msg = {
			textRaw: '/ping',
			text: '/ping',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, bus)
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(replies).toEqual([[{ type: 'text', text: 'pong' }]])
	})

	it('treats void result as handled (no auto reply)', async () => {
		const bus = createChatCommandBus()
		let ran = false
		bus.register(
			defineCommand({
				pattern: 'silent',
				flags: {},
				action: () => {
					ran = true
					return undefined
				},
			}) as any,
		)

		const replies: any[] = []
		const msg = {
			textRaw: '/silent',
			text: '/silent',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, bus)
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(ran).toBe(true)
		expect(replies).toEqual([])
	})

	it('returns unknown_command when no command matches', async () => {
		const bus = createChatCommandBus()

		const replies: any[] = []
		const msg = {
			textRaw: '/missing',
			text: '/missing',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, bus)
		expect(res.handled).toBe(false)
		expect(res.kind).toBe('unknown_command')
		expect(replies).toEqual([])
	})

	it('supports telegram-style /cmd@botname stripping', async () => {
		const bus = createChatCommandBus()
		bus.register(
			defineCommand({
				pattern: 'ping',
				flags: {},
				action: () => 'pong',
			}) as any,
		)

		const replies: any[] = []
		const msg = {
			textRaw: '/ping@mybot',
			text: '/ping@mybot',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, bus)
		expect(res.handled).toBe(true)
		expect(res.kind).toBe('handled')
		expect(replies).toEqual([[{ type: 'text', text: 'pong' }]])
	})

	it('allows passing through via CHAT_COMMAND_PASS', async () => {
		const bus = createChatCommandBus()
		bus.register(
			defineCommand({
				pattern: 'pass',
				flags: {},
				action: () => CHAT_COMMAND_PASS,
			}) as any,
		)

		const replies: any[] = []
		const msg = {
			textRaw: '/pass',
			text: '/pass',
			reply: async (content: any) => replies.push(content),
		} as any

		const res = await handleChatCommand(msg, bus)
		expect(res.handled).toBe(false)
		expect(res.kind).toBe('passed_through')
		expect(replies).toEqual([])
	})
})

