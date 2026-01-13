// ============================================================================
// Parts - 消息内容的原子单元（只保留跨平台共性）
// ============================================================================

/** 纯文本 */
export interface TextPart {
	type: 'text'
	text: string
}

/** @提及 */
interface MentionMeta {
	username?: string
	displayName?: string
	avatar?: string
	isBot?: boolean
}

export interface MentionUserPart extends MentionMeta {
	type: 'mention'
	kind: 'user'
	id: string | number
}

export interface MentionRolePart extends MentionMeta {
	type: 'mention'
	kind: 'role'
	id: string | number
}

export interface MentionChannelPart extends MentionMeta {
	type: 'mention'
	kind: 'channel'
	id: string | number
}

export interface MentionEveryonePart extends MentionMeta {
	type: 'mention'
	kind: 'everyone'
	id?: never
}

export type MentionPart = MentionUserPart | MentionRolePart | MentionChannelPart | MentionEveryonePart

/** 图片 */
export interface ImagePart {
	type: 'image'
	url?: string
	alt?: string
	fileId?: string
	name?: string
	mime?: string
	data?: Uint8Array | ArrayBufferLike
	width?: number
	height?: number
	size?: number
}

/** 音频 */
export interface AudioPart {
	type: 'audio'
	url?: string
	name?: string
	mime?: string
	fileId?: string
	data?: Uint8Array | ArrayBufferLike
	size?: number
	/** 时长（秒） */
	duration?: number
}

/** 视频 */
export interface VideoPart {
	type: 'video'
	url?: string
	name?: string
	mime?: string
	fileId?: string
	data?: Uint8Array | ArrayBufferLike
	size?: number
	width?: number
	height?: number
	/** 时长（秒） */
	duration?: number
	/** 缩略图 */
	thumbnail?: ImagePart
}

/** 通用文件/文档 */
export interface FilePart {
	type: 'file'
	url?: string
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

/** 格式化文本（跨平台共性样式） */
export interface StyledPart {
	type: 'styled'
	style: 'bold' | 'italic' | 'code' | 'strike' | 'underline'
	children: InlinePart[]
}

/** 代码块 */
export interface CodeBlockPart {
	type: 'codeblock'
	language?: string
	code: string
}

/** 内联元素 */
export type InlinePart = TextPart | StyledPart | MentionPart | LinkPart

/** 媒体元素 */
export type MediaPart = ImagePart | AudioPart | VideoPart | FilePart

/** 媒体类型标识 */
export type MediaKind = MediaPart['type']

/** 所有 Part 类型 */
export type Part = InlinePart | MediaPart | CodeBlockPart
