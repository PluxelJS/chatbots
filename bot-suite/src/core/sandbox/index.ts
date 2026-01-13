import { Buffer } from 'node:buffer'
import type { Part, Platform, SandboxSession } from 'pluxel-plugin-bot-core'
import {
	createSandboxAdapter,
	createSandboxMessage,
	getAdapter,
	getCommandMeta,
	normalizePartsForAdapter,
	registerSandboxAdapter,
} from 'pluxel-plugin-bot-core'

import type { ChatbotsRuntime } from '../runtime'
import type {
	SandboxContent,
	SandboxCommandsSnapshot,
	SandboxMessage,
	SandboxSendInput,
	SandboxSendResult,
	SandboxSnapshot,
} from './types'
import { SandboxStore } from './store'

const DEFAULT_TARGET_PLATFORM: Platform = 'sandbox'
const DEFAULT_USER_ID = 'sandbox-user'
const DEFAULT_CHANNEL_ID = 'sandbox-channel'
const MAX_MESSAGES = 200

const decodeBinary = (value: unknown): Uint8Array | undefined => {
	if (!value) return undefined
	if (value instanceof Uint8Array) return value
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
	}
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (Array.isArray(value)) return Uint8Array.from(value)
	if (typeof value === 'string') {
		return Uint8Array.from(Buffer.from(value, 'base64'))
	}
	return undefined
}

const normalizeSandboxContent = (content: SandboxContent): Part[] => {
	if (typeof content === 'string') {
		const text = content
		return text ? [{ type: 'text', text }] : []
	}

	return content.map((part) => {
		if ((part.type === 'image' || part.type === 'file') && part.data) {
			const decoded = decodeBinary(part.data)
			if (decoded && decoded !== part.data) {
				return { ...(part as any), data: decoded } as Part
			}
		}
		return part as Part
	})
}

const resolveBaseAdapter = (platform: Platform) => {
	if (platform === 'sandbox') return undefined
	try {
		return getAdapter(platform)
	} catch {
		return undefined
	}
}

export class ChatbotsSandbox {
	private readonly cmdPrefix: string
	private readonly store: SandboxStore

	constructor(private readonly runtime: ChatbotsRuntime, options: { cmdPrefix: string }) {
		this.cmdPrefix = options.cmdPrefix.trim() || '/'
		registerSandboxAdapter()
		this.store = new SandboxStore(MAX_MESSAGES)
		this.reset()
	}

	snapshot(): SandboxSnapshot {
		return this.store.snapshot()
	}

	reset(): SandboxSnapshot {
		return this.store.reset(
			[{ type: 'text', text: `Chatbots sandbox ready. Prefix: ${this.cmdPrefix}` }],
			{ platform: DEFAULT_TARGET_PLATFORM, userId: DEFAULT_USER_ID, channelId: DEFAULT_CHANNEL_ID },
		)
	}

	commands(): SandboxCommandsSnapshot {
		const list = this.runtime.cmd.list().map((cmd) => {
			const meta = getCommandMeta(cmd)
			return {
				name: cmd.nameTokens.join(' '),
				usage: cmd.toUsage(),
				aliases: [...cmd.aliases],
				desc: meta?.desc,
				group: meta?.group,
			}
		})
		list.sort((a, b) => a.name.localeCompare(b.name))
		return { prefix: this.cmdPrefix, commands: list }
	}

	async send(input: SandboxSendInput): Promise<SandboxSendResult> {
		const targetPlatform = input.platform ?? DEFAULT_TARGET_PLATFORM
		const userId = input.userId ?? DEFAULT_USER_ID
		const channelId = input.channelId ?? DEFAULT_CHANNEL_ID
		const parts = normalizeSandboxContent(input.content)
		if (!parts.length) {
			return { messages: [] }
		}

		const baseAdapter = resolveBaseAdapter(targetPlatform)
		const adapter = createSandboxAdapter(baseAdapter)
		const renderText = (value: Part[]) => adapter.render(normalizePartsForAdapter(value, adapter)).text

		const session: SandboxSession = {
			targetPlatform,
			userId,
			channelId,
			mockRoleIds: input.mockRoleIds,
			mockUser: input.mockUser,
			mockChannel: input.mockChannel,
			renderText,
			append: (payload) =>
				this.store.append({
					...payload,
					platform: targetPlatform,
					userId,
					channelId,
					renderText,
				}),
		}

		const rawText = typeof input.content === 'string' ? input.content : undefined
		let messages: SandboxMessage[] = []

		this.store.beginBatch()
		try {
			session.append({ role: 'user', parts })
			const msg = createSandboxMessage({ session, parts, rawText, adapter })
			await this.runtime.dispatchSandboxMessage(msg)
		} finally {
			messages = this.store.endBatch()
		}

		return { messages }
	}

	createSseHandler() {
		return this.store.createSseHandler()
	}
}
