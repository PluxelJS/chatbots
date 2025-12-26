// ============================================================================
// Platform Registry - 类型注册表，支持平台特定类型推导
// ============================================================================

import type { Buffer } from 'node:buffer'
import type { FilePart, ImagePart, MentionPart, Part, PartInput } from '@pluxel/parts'

export type {
	CodeBlockPart,
	FilePart,
	ImagePart,
	InlinePart,
	LinkPart,
	MentionPart,
	Part,
	PartInput,
	StyledPart,
	TextPart,
} from '@pluxel/parts'

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
// Parts - 消息内容的原子单元（来自 @pluxel/parts）
// ============================================================================

/** 消息内容（对外统一类型别名） */
export type MessageContent = PartInput

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
	fetch?: (signal?: AbortSignal) => Promise<ArrayBuffer | ArrayBufferView | Buffer>
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
	/**
	 * 控制 `reply()` 在需要“自动拆分”时的策略（发送顺序 / 是否允许拆分）。
	 *
	 * 典型触发条件：
	 * - 平台 `supportsMixedMedia=false` 且输入为“单图 + 单侧 caption”
	 * - 平台支持 mixed，但 caption 超过 `maxCaptionLength`（`reply()` 会将其拆成两条，避免报错）
	 *
	 * - `undefined`：默认（auto），按输入顺序发送（caption 在前则 text-first，在后则 media-first）
	 * - `text-first`：强制先发文本后发图片
	 * - `media-first`：强制先发图片后发文本
	 * - `forbid`：直接报错（适用于你不希望 `reply()` 拆分的场景）
	 */
	splitFallback?: 'forbid' | 'text-first' | 'media-first'
}

/**
 * 平台感知的消息类型
 * 使用泛型参数 P 实现 discriminated union
 * if (msg.platform === 'kook') 后 raw/bot/id 等字段自动推导为 KOOK 类型
 */
export interface Message<P extends Platform = Platform> {
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
	 * - 当平台对 caption 有长度限制且 caption 超长时，`reply()` 会自动拆分为“图片 + 文本”（除非 `splitFallback='forbid'`）
	 */
	reply: (content: MessageContent, options?: ReplyOptions) => Promise<void>
	/**
	 * 显式发送纯文本（原子能力）。
	 *
	 * - 仅允许文本类 Part（`text/mention/link/styled/codeblock`），否则直接报错
	 * - 会按平台能力做降级渲染（例如 plain 平台退化为纯文本）
	 */
	sendText?: (content: MessageContent, options?: ReplyOptions) => Promise<void>
	/**
	 * 显式发送图片（原子能力）。
	 *
	 * - 平台不支持图片时直接报错
	 * - caption 只允许文本类 Part
	 * - caption 过长会直接报错（不会自动截断/拆分）
	 */
	sendImage?: (image: ImagePart, caption?: MessageContent, options?: ReplyOptions) => Promise<void>
	/**
	 * 显式发送文件（原子能力）。
	 *
	 * - 平台不支持文件时直接报错
	 */
	sendFile?: (file: FilePart, options?: ReplyOptions) => Promise<void>
	/** 上传图片（如果平台支持/需要） */
	uploadImage?: (image: ImagePart) => Promise<ImagePart>
	/** 上传文件（如果平台支持/需要） */
	uploadFile?: (file: FilePart) => Promise<FilePart>
}

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
