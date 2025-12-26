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
	username?: string
	displayName?: string
	avatar?: string
	isBot?: boolean
}

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

/** 文件 */
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

/** 内联元素 */
export type InlinePart = TextPart | StyledPart | MentionPart | LinkPart

/** 所有 Part 类型 */
export type Part = InlinePart | ImagePart | FilePart | CodeBlockPart

/**
 * Outbound 输入内容（`reply/sendText` 等的参数类型）。
 *
 * - 支持任意嵌套数组/可迭代结构，便于 JSX Fragment / 条件拼接展开
 * - 最终会归一为 `Part[]`（相邻 `text` 会自动合并）
 */
export type PartInput =
	| string
	| Part
	| Iterable<PartInput | null | undefined>
	| null
	| undefined
