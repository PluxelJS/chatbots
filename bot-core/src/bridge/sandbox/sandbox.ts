import type { OutboundOp, PlatformAdapter, RenderResult } from '../../adapter'
import { createReply, createSendHelpers, normalizePartsForAdapter, registerAdapter } from '../../adapter'
import { hasRichParts } from '../../../parts'
import type {
	AdapterPolicy,
	Attachment,
	BotChannel,
	BotUser,
	Message,
	MentionPart,
	Part,
	SandboxBot,
	SandboxSession,
} from '../../types'

const DEFAULT_USER_ID = 'sandbox-user'
const DEFAULT_CHANNEL_ID = 'sandbox-channel'

export const sandboxPolicy: AdapterPolicy = {
	text: {
		format: 'plain',
		inlineMention: {
			user: 'native',
			role: 'native',
			channel: 'native',
			everyone: 'native',
		},
	},
	outbound: {
		supportsQuote: true,
		supportsMixedMedia: true,
		supportedOps: ['text', 'image', 'audio', 'video', 'file'],
	},
}

declare global {
	interface BotCorePlatformPolicyRegistry {
		sandbox: typeof sandboxPolicy
	}
}

const defaultRender = (parts: Part[]): RenderResult => ({
	text: parts.map(renderPart).join(''),
	format: sandboxPolicy.text.format,
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
	base?: Pick<PlatformAdapter<any>, 'policy' | 'render'>,
): PlatformAdapter<'sandbox'> => {
	const policy = base?.policy ?? sandboxPolicy
	const render = base?.render ?? defaultRender

	return {
		name: 'sandbox',
		policy,
		render,

		uploadMedia: async (_session, media) => media,

		send: async (session, op: OutboundOp) => {
			switch (op.type) {
				case 'text':
					session.append({ role: 'bot', parts: op.text.parts })
					return
				case 'image': {
					const parts = op.caption?.parts?.length ? [op.image, ...op.caption.parts] : [op.image]
					session.append({ role: 'bot', parts })
					return
				}
				case 'audio':
					session.append({ role: 'bot', parts: [op.audio] })
					return
				case 'video': {
					const parts = op.caption?.parts?.length ? [op.video, ...op.caption.parts] : [op.video]
					session.append({ role: 'bot', parts })
					return
				}
				case 'file':
					session.append({ role: 'bot', parts: [op.file] })
					return
			}
		},
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
	const parts = input.parts
	const renderText = input.session.renderText ?? ((data) => adapter.render(normalizePartsForAdapter(data, adapter)).text)
	const mentions = parts.filter((part): part is MentionPart => part.type === 'mention')
	const attachments: Attachment<'sandbox'>[] = parts
		.filter((part): part is Extract<Part, { type: 'image' | 'audio' | 'video' | 'file' }> =>
			part.type === 'image' || part.type === 'audio' || part.type === 'video' || part.type === 'file')
		.map((part) => ({
			platform: 'sandbox',
			kind: part.type,
			part,
			source: 'message',
			fetch: part.data
				? async () => part.data as ArrayBuffer
				: part.url
					? async () => {
						const res = await fetch(part.url!)
						if (!res.ok) throw new Error(`sandbox: 下载附件失败 ${res.status}`)
						return await res.arrayBuffer()
					}
					: async () => { throw new Error('sandbox: 附件缺少 url 或 data') },
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
		sendAudio: helpers.sendAudio,
		sendVideo: helpers.sendVideo,
		sendFile: helpers.sendFile,
	}
}

export const registerSandboxAdapter = (): (() => void) => registerAdapter(createSandboxAdapter())
