// ============================================================================
// Platform Registry - 类型注册表，支持平台特定类型推导
// ============================================================================

import type { Buffer } from 'node:buffer'

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
	telegram: {
		raw: import('pluxel-plugin-telegram').MessageSession
		bot: import('pluxel-plugin-telegram').MessageSession['bot']
		userId: number
		channelId: number
		guildId: never
		messageId: number
	}
}

export type Platform = keyof PlatformRegistry

/** 平台能力与渲染偏好 */
export type RenderFormat = 'plain' | 'markdown' | 'html'
export interface PlatformCapabilities {
	format: RenderFormat
	supportsQuote: boolean
	supportsImage: boolean
	supportsFile: boolean
	supportsMixedMedia?: boolean
	supportsRaw?: boolean
	supportsInlineMention: {
		user: boolean
		role: boolean
		channel: boolean
		everyone: boolean
	}
	maxTextLength?: number
	maxCaptionLength?: number
}

// ============================================================================
// Parts - 消息内容的原子单元（只保留跨平台共性）
// ============================================================================

/** 纯文本 */
export interface TextPart {
	type: 'text'
	text: string
}

/** @提及 */
export interface MentionPart {
	type: 'mention'
	kind: 'user' | 'role' | 'channel' | 'everyone'
	id?: string | number
}

/** 图片 */
export interface ImagePart {
	type: 'image'
	url: string
	alt?: string
	fileId?: string
	name?: string
	mime?: string
	data?: Uint8Array | ArrayBufferLike
	width?: number
	height?: number
	size?: number
}

/** 文件 */
export interface FilePart {
	type: 'file'
	url: string
	name?: string
	mime?: string
	fileId?: string
	size?: number
	data?: Uint8Array | ArrayBufferLike
}

/** 链接 */
export interface LinkPart {
	type: 'link'
	url: string
	label?: string
}

/** 格式化文本（大多数平台支持） */
export interface StyledPart {
	type: 'styled'
	style: 'bold' | 'italic' | 'code' | 'strike'
	children: InlinePart[]
}

/** 代码块 */
export interface CodeBlockPart {
	type: 'codeblock'
	language?: string
	code: string
}

/** 平台原生透传（Card 等平台特有功能走这里） */
export interface RawPart<P extends Platform = Platform> {
	type: 'raw'
	platform: P
	payload: unknown
}

/** 内联元素 */
export type InlinePart = TextPart | StyledPart | MentionPart | LinkPart

/** 所有 Part 类型 */
export type Part = InlinePart | ImagePart | FilePart | CodeBlockPart | RawPart

/** 消息内容（reply 的参数类型） */
export type MessageContent = string | Part | Part[]

// ============================================================================
// Attachments - 富媒体附件封装
// ============================================================================

export type AttachmentKind = 'image' | 'file'
export type AttachmentSource = 'message' | 'reference'

export interface Attachment<P extends Platform = Platform> {
	platform: P
	kind: AttachmentKind
	part: Extract<Part, { type: AttachmentKind }>
	source: AttachmentSource
	fetch?: () => Promise<ArrayBuffer | ArrayBufferView | Buffer>
}

export interface ResolvedAttachment<P extends Platform = Platform> extends Attachment<P> {
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
}

/**
 * 平台感知的消息类型
 * 使用泛型参数 P 实现 discriminated union
 * if (msg.platform === 'kook') 后 raw/bot/id 等字段自动推导为 KOOK 类型
 */
export interface Message<P extends Platform = Platform> {
	/** 平台标识（discriminant） */
	platform: P
	/** 纯文本内容 */
	text: string
	/** 结构化消息部件 */
	parts: Part[]
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
	/** 回复消息 */
	reply: (content: MessageContent, options?: ReplyOptions) => Promise<void>
}

export interface MessageReference<P extends Platform = Platform> {
	platform: P
	messageId: PlatformRegistry[P]['messageId'] | null
	text: string
	parts: Part[]
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
