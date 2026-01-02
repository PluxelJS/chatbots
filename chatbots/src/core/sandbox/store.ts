import { Buffer } from 'node:buffer'
import type { SseChannel } from '@pluxel/hmr/services'
import type { Part, Platform } from '@pluxel/bot-layer'
import { partsToText } from '@pluxel/bot-layer'

import type { SandboxEvent, SandboxMessage, SandboxPart, SandboxSnapshot } from './types'

const DEFAULT_PLATFORM: Platform = 'sandbox'

type AppendInput = {
	role: SandboxMessage['role']
	parts: Part[]
	platform?: Platform
	userId?: string | number
	channelId?: string | number
	renderText?: (parts: Part[]) => string
}

const toBytes = (value: ArrayBufferLike | ArrayBufferView): Uint8Array => {
	if (value instanceof Uint8Array) return value
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
	}
	return new Uint8Array(value as ArrayBufferLike)
}

const encodeBinary = (value: ArrayBufferLike | ArrayBufferView) => Buffer.from(toBytes(value)).toString('base64')

const serializeParts = (parts: Part[]): SandboxPart[] =>
	parts.map((part) => {
		if ((part.type === 'image' || part.type === 'file') && part.data) {
			return ({ ...part, data: encodeBinary(part.data as ArrayBufferLike | ArrayBufferView) } as unknown) as SandboxPart
		}
		return part as SandboxPart
	})

export class SandboxStore {
	private readonly subscribers = new Set<SseChannel>()
	private messages: SandboxMessage[] = []
	private seq = 1
	private readonly batchStack: SandboxMessage[][] = []

	constructor(private readonly maxMessages: number) {}

	snapshot(): SandboxSnapshot {
		return { messages: this.messages.map((msg) => ({ ...msg })) }
	}

	reset(systemParts: Part[], context?: { platform?: Platform; userId?: string | number; channelId?: string | number }): SandboxSnapshot {
		this.messages = []
		this.seq = 1
		if (systemParts.length) {
			const message = this.buildMessage('system', systemParts, context)
			this.messages.push(message)
		}
		const snap = this.snapshot()
		this.emit('sync', { type: 'sync', messages: snap.messages })
		return snap
	}

	beginBatch() {
		this.batchStack.push([])
	}

	endBatch(): SandboxMessage[] {
		const batch = this.batchStack.pop() ?? []
		if (this.batchStack.length) {
			this.batchStack[this.batchStack.length - 1]!.push(...batch)
			return batch
		}
		if (batch.length) {
			this.emit('append', { type: 'append', messages: batch })
		}
		return batch
	}

	append(input: AppendInput): SandboxMessage {
		const message = this.buildMessage(input.role, input.parts, input, input.renderText)
		this.messages.push(message)
		if (this.messages.length > this.maxMessages) {
			this.messages = this.messages.slice(-this.maxMessages)
		}
		const batch = this.batchStack[this.batchStack.length - 1]
		if (batch) batch.push(message)
		else this.emit('append', { type: 'append', messages: [message] })
		return message
	}

	createSseHandler() {
		return (channel: SseChannel) => {
			channel.emit('sync', { type: 'sync', messages: this.snapshot().messages })
			this.subscribers.add(channel)
			return channel.onAbort(() => {
				this.subscribers.delete(channel)
			})
		}
	}

	private buildMessage(
		role: SandboxMessage['role'],
		parts: Part[],
		context?: { platform?: Platform; userId?: string | number; channelId?: string | number },
		renderText?: (parts: Part[]) => string,
	): SandboxMessage {
		const platform = context?.platform ?? DEFAULT_PLATFORM
		const text = renderText ? renderText(parts) : partsToText(parts, platform)
		return {
			id: String(this.seq++),
			role,
			parts: serializeParts(parts),
			text,
			platform,
			userId: context?.userId,
			channelId: context?.channelId,
			createdAt: Date.now(),
		}
	}

	private emit(type: SandboxEvent['type'], payload: SandboxEvent) {
		for (const channel of this.subscribers) {
			channel.emit(type, payload)
		}
	}
}
