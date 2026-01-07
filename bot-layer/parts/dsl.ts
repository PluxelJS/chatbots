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
} from './model'

type NonTextInlinePart = Exclude<InlinePart, { type: 'text' }>

export type InlineValue = NonTextInlinePart | string | number | null | undefined

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isValidId = (id: unknown): id is string | number =>
	(typeof id === 'string' && id.length > 0) || (typeof id === 'number' && Number.isFinite(id))

const toInlineParts = (values: readonly InlineValue[]): InlinePart[] => {
	const out: InlinePart[] = []
	for (const value of values) {
		if (value === null || value === undefined) continue
		if (typeof value === 'string' || typeof value === 'number') {
			const text = String(value)
			if (!text) continue
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

export const mentionUser = (id?: string | number | null, meta?: MentionMeta): MentionUserPart | null =>
	isValidId(id) ? ({ type: 'mention', kind: 'user', id, ...(meta ?? {}) } as MentionUserPart) : null

export const mentionRole = (id?: string | number | null, meta?: MentionMeta): MentionRolePart | null =>
	isValidId(id) ? ({ type: 'mention', kind: 'role', id, ...(meta ?? {}) } as MentionRolePart) : null

export const mentionChannel = (id?: string | number | null, meta?: MentionMeta): MentionChannelPart | null =>
	isValidId(id) ? ({ type: 'mention', kind: 'channel', id, ...(meta ?? {}) } as MentionChannelPart) : null

export const mentionEveryone = (meta?: MentionMeta): MentionEveryonePart => ({ type: 'mention', kind: 'everyone', ...(meta ?? {}) })

export const image = (url?: string | null, alt?: string): ImagePart | null =>
	isNonEmptyString(url) ? { type: 'image', url, alt } : null

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

export const file = (url?: string | null, name?: string, mime?: string): FilePart | null =>
	isNonEmptyString(url) ? { type: 'file', url, name, mime } : null

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

export const link = (url?: string | null, label?: string): LinkPart | null =>
	isNonEmptyString(url) ? ({ type: 'link', url, label } satisfies LinkPart) : null

export const codeblock = (code?: string | null, language?: string): CodeBlockPart | null =>
	isNonEmptyString(code) ? { type: 'codeblock', code, language } : null

type Styled = Extract<Part, { type: 'styled' }>

const styled = (style: Styled['style'], children: readonly InlineValue[]): Styled | null => {
	const normalized = toInlineParts(children)
	return normalized.length ? { type: 'styled', style, children: normalized } : null
}

export const bold = (...children: InlineValue[]): Styled | null => styled('bold', children)
export const italic = (...children: InlineValue[]): Styled | null => styled('italic', children)
export const underline = (...children: InlineValue[]): Styled | null => styled('underline', children)
export const code = (...children: InlineValue[]): Styled | null => styled('code', children)
export const strike = (...children: InlineValue[]): Styled | null => styled('strike', children)
