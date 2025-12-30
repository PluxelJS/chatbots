import type { InlinePart, MentionPart, Part } from './model'

export const text = (t: string): Part => ({ type: 'text', text: t })
export const mention = (
	kind: 'user' | 'role' | 'channel' | 'everyone',
	id?: string | number,
	meta?: Partial<Omit<MentionPart, 'type' | 'kind' | 'id'>>,
): Part => ({ type: 'mention', kind, id, ...(meta ?? {}) })
export const image = (url: string, alt?: string): Part => ({ type: 'image', url, alt })
export const imageData = (
	data: Uint8Array | ArrayBufferLike,
	opts?: { alt?: string; name?: string; mime?: string; width?: number; height?: number; size?: number },
): Part => ({
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
export const file = (url: string, name?: string, mime?: string): Part => ({ type: 'file', url, name, mime })
export const fileData = (
	data: Uint8Array | ArrayBufferLike,
	opts?: { name?: string; mime?: string; size?: number },
): Part => ({
	type: 'file',
	data,
	url: undefined,
	name: opts?.name,
	mime: opts?.mime,
	size: opts?.size,
})
export const link = (url: string, label?: string): Part => ({ type: 'link', url, label })
export const codeblock = (code: string, language?: string): Part => ({ type: 'codeblock', code, language })
export const bold = (...children: InlinePart[]): Part => ({ type: 'styled', style: 'bold', children })
export const italic = (...children: InlinePart[]): Part => ({ type: 'styled', style: 'italic', children })
export const code = (t: string): Part => ({ type: 'styled', style: 'code', children: [{ type: 'text', text: t }] })
export const strike = (...children: InlinePart[]): Part => ({ type: 'styled', style: 'strike', children })

