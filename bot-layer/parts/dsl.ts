import type {
	CodeBlockPart,
	FilePart,
	ImagePart,
	InlinePart,
	LinkPart,
	MentionChannelPart,
	MentionEveryonePart,
	MentionPart,
	MentionRolePart,
	MentionUserPart,
	Part,
	TextPart,
} from './model'

type NonTextInlinePart = Exclude<InlinePart, { type: 'text' }>

export type InlineValue = NonTextInlinePart | string | number

const toInlineParts = (values: readonly InlineValue[]): InlinePart[] => {
	const out: InlinePart[] = []
	for (const value of values) {
		if (typeof value === 'string' || typeof value === 'number') {
			const text = String(value)
			const prev = out[out.length - 1]
			if (prev?.type === 'text') prev.text += text
			else out.push({ type: 'text', text })
			continue
		}
		out.push(value)
	}
	return out
}

type MentionMeta = Partial<Omit<MentionPart, 'type' | 'kind' | 'id'>>

export const text = (value: string | number): TextPart => ({ type: 'text', text: String(value) })

export const mentionUser = (id: string | number, meta?: MentionMeta): MentionUserPart =>
	({ type: 'mention', kind: 'user', id, ...(meta ?? {}) } satisfies MentionUserPart)

export const mentionRole = (id: string | number, meta?: MentionMeta): MentionRolePart =>
	({ type: 'mention', kind: 'role', id, ...(meta ?? {}) } satisfies MentionRolePart)

export const mentionChannel = (id: string | number, meta?: MentionMeta): MentionChannelPart =>
	({ type: 'mention', kind: 'channel', id, ...(meta ?? {}) } satisfies MentionChannelPart)

export const mentionEveryone = (meta?: MentionMeta): MentionEveryonePart => ({ type: 'mention', kind: 'everyone', ...(meta ?? {}) })

export const image = (url: string, alt?: string): ImagePart => ({ type: 'image', url, alt })

export const imageData = (
	data: Uint8Array | ArrayBufferLike,
	opts?: { alt?: string; name?: string; mime?: string; width?: number; height?: number; size?: number },
): ImagePart => ({
	type: 'image',
	data,
	url: undefined,
	alt: opts?.alt,
	name: opts?.name,
	mime: opts?.mime,
	width: opts?.width,
	height: opts?.height,
	size: opts?.size,
})

export const file = (url: string, name?: string, mime?: string): FilePart => ({ type: 'file', url, name, mime })

export const fileData = (
	data: Uint8Array | ArrayBufferLike,
	opts?: { name?: string; mime?: string; size?: number },
): FilePart => ({
	type: 'file',
	data,
	url: undefined,
	name: opts?.name,
	mime: opts?.mime,
	size: opts?.size,
})

export const link = (url: string, label?: string): LinkPart => ({ type: 'link', url, label } satisfies LinkPart)

export const codeblock = (code: string, language?: string): CodeBlockPart => ({ type: 'codeblock', code, language })

type Styled = Extract<Part, { type: 'styled' }>

const styled = (style: Styled['style'], children: readonly InlineValue[]): Styled => {
	const normalized = toInlineParts(children)
	return { type: 'styled', style, children: normalized }
}

type NonEmptyInlineValues = readonly [InlineValue, ...InlineValue[]]

export const bold = (...children: NonEmptyInlineValues): Styled => styled('bold', children)
export const italic = (...children: NonEmptyInlineValues): Styled => styled('italic', children)
export const underline = (...children: NonEmptyInlineValues): Styled => styled('underline', children)
export const code = (...children: NonEmptyInlineValues): Styled => styled('code', children)
export const strike = (...children: NonEmptyInlineValues): Styled => styled('strike', children)
