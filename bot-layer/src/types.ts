// ============================================================================
// Platform Registry - 类型注册表，支持平台特定类型推导
// ============================================================================

import type { Buffer } from 'node:buffer'
import type { AudioPart, FilePart, ImagePart, MediaKind, MediaPart, MentionPart, Part, PartInput, VideoPart } from './parts'

export type SandboxRole = 'user' | 'bot' | 'system'

export interface SandboxAppendInput {
	role: SandboxRole
	parts: Part[]
	platform?: string
	userId?: string | number
	channelId?: string | number
}

export interface SandboxSession {
	targetPlatform?: string
	userId?: string | number
	channelId?: string | number
	mockRoleIds?: number[]
	mockUser?: {
		displayName?: string
		username?: string
		avatar?: string
		isBot?: boolean
	}
	mockChannel?: {
		name?: string
		isPrivate?: boolean
	}
	renderText?: (parts: Part[]) => string
	append: (input: SandboxAppendInput) => unknown
	bot?: SandboxBot
}

export interface SandboxBot {
	platform: 'sandbox'
}

export type {
	AudioPart,
	CodeBlockPart,
	FilePart,
	ImagePart,
	InlinePart,
	LinkPart,
	MediaKind,
	MediaPart,
	MentionPart,
	Part,
	PartInput,
	StyledPart,
	TextPart,
	VideoPart,
} from './parts'

/** 
 * 平台元信息注册表
 * 添加新平台时扩展此接口即可获得完整类型支持
 */
export interface PlatformRegistry {
	kook: {
		raw: import('pluxel-plugin-kook').MessageSession
		bot: import('pluxel-plugin-kook').MessageSession['bot']
		userId: string
		channelId: string
		guildId: string
		messageId: string
	}
	milky: {
		raw: import('pluxel-plugin-milky').MilkyMessageSession
		bot: import('pluxel-plugin-milky').MilkyMessageSession['bot']
		userId: number
		channelId: number
		guildId: never
		messageId: number
	}
	telegram: {
		raw: import('pluxel-plugin-telegram').MessageSession
		bot: import('pluxel-plugin-telegram').MessageSession['bot']
		userId: number
		channelId: number
		guildId: never
		messageId: number
	}
	sandbox: {
		raw: SandboxSession
		bot: SandboxBot
		userId: string
		channelId: string
		guildId: never
		messageId: string
	}
}

export type Platform = keyof PlatformRegistry

/** 平台能力与渲染偏好 */
export type RenderFormat = 'plain' | 'markdown' | 'html'

export type OutboundOpType = 'text' | 'image' | 'audio' | 'video' | 'file'
export type SupportedOutboundOps = readonly OutboundOpType[]

export type MentionKind = 'user' | 'role' | 'channel' | 'everyone'
export type MentionRender = 'native' | 'text'

export interface AdapterTextPolicy {
	format: RenderFormat
	inlineMention: Record<MentionKind, MentionRender>
	maxTextLength?: number
}

export interface AdapterOutboundPolicy {
	supportedOps: SupportedOutboundOps
	supportsQuote: boolean
	supportsMixedMedia: boolean
	maxCaptionLength?: number
}

export interface AdapterPolicy {
	text: AdapterTextPolicy
	outbound: AdapterOutboundPolicy
}

// ============================================================================
// Parts - 消息内容的原子单元
// ============================================================================

/** 消息内容（对外统一类型别名） */
export type MessageContent = PartInput

// ============================================================================
// Attachments - 富媒体附件封装
// ============================================================================

export type AttachmentSource = 'message' | 'reference'

export interface Attachment<P extends Platform = Platform> {
	platform: P
	kind: MediaKind
	part: MediaPart
	source: AttachmentSource
	/** 获取媒体数据（必须提供） */
	fetch: (signal?: AbortSignal) => Promise<ArrayBuffer | ArrayBufferView | Buffer>
}

export interface ResolvedAttachment<P extends Platform = Platform> extends Omit<Attachment<P>, 'fetch'> {
	data: Buffer
}

// ============================================================================
// User & Channel - 平台感知的用户和频道信息
// ============================================================================

/** 用户信息 */
export interface BotUser<P extends Platform = Platform> {
	id: PlatformRegistry[P]['userId']
	username: string | null
	displayName: string | null
	avatar: string | null
	isBot: boolean | null
}

/** 频道信息 */
export interface BotChannel<P extends Platform = Platform> {
	id: PlatformRegistry[P]['channelId']
	guildId: PlatformRegistry[P]['guildId'] | null
	name: string | null
	isPrivate: boolean | null
}

// ============================================================================
// Message - 核心消息类型
// ============================================================================

export interface ReplyOptions {
	quote?: boolean
	mode?: ReplyMode
}

export type ReplyMode = 'best-effort' | 'strict'

declare global {
	/**
	 * Platform -> AdapterPolicy registry used for stronger typing (Message send* surface, etc).
	 *
	 * Built-in platforms are augmented in their adapter modules; third-party platforms can
	 * augment this interface in their own module to participate in type inference.
	 */
	interface BotLayerPlatformPolicyRegistry {}
}

export type PolicyForPlatform<P extends Platform> =
	P extends keyof BotLayerPlatformPolicyRegistry ? BotLayerPlatformPolicyRegistry[P] : AdapterPolicy

type SupportedOpForPlatform<P extends Platform> = PolicyForPlatform<P>['outbound']['supportedOps'][number]

type WithImageSender<P extends Platform> =
	'image' extends SupportedOpForPlatform<P>
		? { sendImage: (image: ImagePart, caption?: MessageContent, options?: ReplyOptions) => Promise<void> }
		: { sendImage?: never }

type WithAudioSender<P extends Platform> =
	'audio' extends SupportedOpForPlatform<P>
		? { sendAudio: (audio: AudioPart, options?: ReplyOptions) => Promise<void> }
		: { sendAudio?: never }

type WithVideoSender<P extends Platform> =
	'video' extends SupportedOpForPlatform<P>
		? { sendVideo: (video: VideoPart, caption?: MessageContent, options?: ReplyOptions) => Promise<void> }
		: { sendVideo?: never }

type WithFileSender<P extends Platform> =
	'file' extends SupportedOpForPlatform<P>
		? { sendFile: (file: FilePart, options?: ReplyOptions) => Promise<void> }
		: { sendFile?: never }

/**
 * 平台感知的消息类型
 * 使用泛型参数 P 实现 discriminated union
 * if (msg.platform === 'kook') 后 raw/bot/id 等字段自动推导为 KOOK 类型
 */
export type Message<P extends Platform = Platform> = {
	/** 平台标识（discriminant） */
	platform: P
	/** 渲染后的文本内容 */
	text: string
	/** 原始文本内容（平台提供的 raw text/caption） */
	textRaw: string
	/** 结构化消息部件 */
	parts: Part[]
	/** 提及列表（按解析顺序） */
	mentions: MentionPart[]
	/** 附件列表（包含当前消息及引用消息内的媒体） */
	attachments: Attachment<P>[]
	/** 引用/回复的消息（如果存在） */
	reference?: MessageReference<P>
	/** 是否包含富媒体（图片、文件等） */
	rich: boolean
	/** 用户信息 */
	user: BotUser<P>
	/** 频道信息 */
	channel: BotChannel<P>
	/** 消息 ID */
	messageId: PlatformRegistry[P]['messageId'] | null
	/** 平台原始数据（类型安全） */
	raw: PlatformRegistry[P]['raw']
	/** 平台 Bot 实例（类型安全） */
	bot: PlatformRegistry[P]['bot']
	/**
	 * 回复消息（便利层）。
	 *
	 * 行为说明：
	 * - 支持 `string | Part | Part[] | 迭代/嵌套结构`，会先归一为 `Part[]`
	 * - 允许混合内容（多段文本、多张图片、文件夹杂文本等）
	 * - 可能会拆成多条消息发送（按输入顺序，拆分规则见 bot-layer DESIGN.md）
	 * - 文本类 Part 会按平台能力做降级渲染（例如 plain 平台退化为纯文本）
	 * - 对平台不支持的媒体（image/file）会尽量退化为可读文本而不是直接报错
	 * - 当平台对 caption 有长度限制且 caption 超长时，`reply()` 会自动拆分为“图片 + 文本”（`options.mode='strict'` 时会直接报错）
	 */
	reply: (content: MessageContent, options?: ReplyOptions) => Promise<void>
	/**
	 * 显式发送纯文本（原子能力）。
	 *
	 * - 仅允许文本类 Part（`text/mention/link/styled/codeblock`），否则直接报错
	 * - 会按平台能力做降级渲染（例如 plain 平台退化为纯文本）
	 */
	sendText: (content: MessageContent, options?: ReplyOptions) => Promise<void>
} & WithImageSender<P> & WithAudioSender<P> & WithVideoSender<P> & WithFileSender<P>

export interface MessageReference<P extends Platform = Platform> {
	platform: P
	messageId: PlatformRegistry[P]['messageId'] | null
	text: string
	textRaw: string
	parts: Part[]
	mentions: MentionPart[]
	attachments: Attachment<P>[]
	rich: boolean
	user?: BotUser<P> | null
	channel?: BotChannel<P> | null
}

/** 联合类型 - 用于事件签名 */
export type AnyMessage = { [P in Platform]: Message<P> }[Platform]

/** 纯文本消息 */
export type PlainMessage<P extends Platform = Platform> = Message<P> & { rich: false }

/** 富媒体消息 */
export type RichMessage<P extends Platform = Platform> = Message<P> & { rich: true }

// ============================================================================
// Handler - 消息处理器（无 ResponderResult，显式 reply）
// ============================================================================

export type MessageHandler = (msg: AnyMessage) => void | Promise<void>
export type PlainMessageHandler = (msg: PlainMessage) => void | Promise<void>
export type RichMessageHandler = (msg: RichMessage) => void | Promise<void>
