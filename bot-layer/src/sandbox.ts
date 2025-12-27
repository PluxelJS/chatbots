import type { Attachment, BotChannel, BotUser, Message, MentionPart, Part, PlatformCapabilities, SandboxSession, SandboxBot } from './types'
import { normalizeMessageContent } from '@pluxel/parts'
import { hasRichParts } from './utils'
import { createReply, createSendHelpers, normalizePartsForAdapter } from './platforms/base'
import type { OutboundText, PlatformAdapter, RenderResult } from './platforms/base'
import { registerAdapter } from './platforms/registry'

const DEFAULT_USER_ID = 'sandbox-user'
const DEFAULT_CHANNEL_ID = 'sandbox-channel'

export const sandboxCapabilities: PlatformCapabilities = {
	format: 'plain',
	supportsQuote: true,
	supportsImage: true,
	supportsFile: true,
	supportsMixedMedia: true,
	supportsInlineMention: {
		user: true,
		role: true,
		channel: true,
		everyone: true,
	},
}

const defaultRender = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: sandboxCapabilities.format,
})

const renderInline = (parts: Array<Extract<Part, { type: 'text' | 'styled' | 'mention' | 'link' }>>): string =>
	parts.map(renderPart).join('')

const renderMention = (part: Extract<Part, { type: 'mention' }>): string => {
	const label = part.displayName ?? part.username ?? (part.id != null ? String(part.id) : part.kind)
	return `@${label}`
}

const renderPart = (part: Part): string => {
	switch (part.type) {
		case 'text':
			return part.text
		case 'styled':
			return renderInline(part.children)
		case 'mention':
			return renderMention(part)
		case 'link':
			return part.label ? `${part.label} (${part.url})` : part.url
		case 'codeblock':
			return part.code
		case 'image':
			return part.alt ?? part.url ?? ''
		case 'file':
			return part.name ?? part.url ?? ''
		default:
			return ''
	}
}

export const createSandboxAdapter = (
	base?: Pick<PlatformAdapter<any>, 'capabilities' | 'render'>,
): PlatformAdapter<'sandbox'> => {
	const capabilities = base?.capabilities ?? sandboxCapabilities
	const render = base?.render ?? defaultRender

	return {
		name: 'sandbox',
		capabilities,
		render,

		sendText: async (session, text: OutboundText) => {
			session.append({ role: 'bot', parts: text.parts })
		},

		sendImage: async (session, image, caption) => {
			const parts = caption?.parts?.length ? [image, ...caption.parts] : [image]
			session.append({ role: 'bot', parts })
		},

		sendFile: async (session, file) => {
			session.append({ role: 'bot', parts: [file] })
		},

		uploadImage: async (_session, image) => image,
		uploadFile: async (_session, file) => file,
	}
}

const DEFAULT_SANDBOX_BOT: SandboxBot = { platform: 'sandbox' }

export interface SandboxMessageInput {
	session: SandboxSession
	parts: Part[]
	rawText?: string
	adapter?: PlatformAdapter<'sandbox'>
}

export const createSandboxMessage = (input: SandboxMessageInput): Message<'sandbox'> => {
	const adapter = input.adapter ?? createSandboxAdapter()
	const parts = normalizeMessageContent(input.parts)
	const renderText = input.session.renderText ?? ((data) => adapter.render(normalizePartsForAdapter(data, adapter)).text)
	const mentions = parts.filter((part): part is MentionPart => part.type === 'mention')
	const attachments: Attachment<'sandbox'>[] = parts
		.filter((part): part is Extract<Part, { type: 'image' | 'file' }> => part.type === 'image' || part.type === 'file')
		.map((part) => ({
			platform: 'sandbox',
			kind: part.type,
			part,
			source: 'message',
		}))

	const userId = input.session.userId ?? DEFAULT_USER_ID
	const channelId = input.session.channelId ?? DEFAULT_CHANNEL_ID

	const user: BotUser<'sandbox'> = {
		id: String(userId),
		username: input.session.mockUser?.username ?? 'sandbox',
		displayName: input.session.mockUser?.displayName ?? 'Sandbox User',
		avatar: input.session.mockUser?.avatar ?? null,
		isBot: input.session.mockUser?.isBot ?? false,
	}

	const channel: BotChannel<'sandbox'> = {
		id: String(channelId),
		guildId: null,
		name: input.session.mockChannel?.name ?? 'sandbox-channel',
		isPrivate: input.session.mockChannel?.isPrivate ?? false,
	}

	const reply = createReply(adapter, input.session)
	const helpers = createSendHelpers(adapter, input.session)
	const text = renderText(parts)
	const textRaw = typeof input.rawText === 'string' ? input.rawText : text

	return {
		platform: 'sandbox',
		text,
		textRaw,
		parts,
		mentions,
		attachments,
		reference: undefined,
		rich: hasRichParts(parts),
		user,
		channel,
		messageId: null,
		raw: input.session,
		bot: input.session.bot ?? DEFAULT_SANDBOX_BOT,
		reply,
		sendText: helpers.sendText,
		sendImage: helpers.sendImage,
		sendFile: helpers.sendFile,
		uploadImage: helpers.uploadImage,
		uploadFile: helpers.uploadFile,
	}
}

export const registerSandboxAdapter = (): (() => void) => registerAdapter(createSandboxAdapter())
