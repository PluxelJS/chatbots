import type { InlinePart, Part, Platform, RawPart, StyledPart } from './types'

type Primitive = string | number | boolean | null | undefined
type Child = Primitive | Part | Part[] | Child[]

const isPart = (v: unknown): v is Part =>
	Boolean(v) && typeof v === 'object' && 'type' in (v as any)

const toText = (value: Primitive): string =>
	value === null || value === undefined || typeof value === 'boolean' ? '' : String(value)

const flatten = (children: Child[]): Part[] => {
	const acc: Part[] = []
	for (const child of children) {
		if (Array.isArray(child)) {
			acc.push(...flatten(child))
		} else if (isPart(child)) {
			acc.push(child)
		} else {
			const text = toText(child)
			if (text) acc.push({ type: 'text', text })
		}
	}
	return acc
}

const inlineOnly = (parts: Part[]): InlinePart[] =>
	parts.filter((p): p is InlinePart => p.type === 'text' || p.type === 'styled' || p.type === 'mention' || p.type === 'link')

const inlineText = (parts: InlinePart[]): string =>
	parts
		.map((p) => (p.type === 'text' ? p.text : ''))
		.join('')

const styled = (style: StyledPart['style'], children: Child[]): Part => ({
	type: 'styled',
	style,
	children: inlineOnly(flatten(children)),
})

const link = (href: string, children: Child[], label?: string): Part => {
	const inlines = inlineOnly(flatten(children))
	const text = label ?? inlineText(inlines)
	return { type: 'link', url: href, label: text || undefined }
}

const image = (src: string, alt?: string, children?: Child[]): Part => {
	const fallbackAlt = inlineText(inlineOnly(flatten(children ?? [])))
	return { type: 'image', url: src, alt: alt ?? (fallbackAlt || undefined) }
}

const file = (src: string, name?: string, mime?: string): Part => ({
	type: 'file',
	url: src,
	name,
	mime,
})

const codeblock = (code: string, language?: string): Part => ({ type: 'codeblock', code, language })

const raw = (platform: Platform, payload: unknown): RawPart => ({ type: 'raw', platform, payload })

const build = (type: string, props: any, children: Child[]): Part | Part[] => {
	switch (type) {
		case 'b':
		case 'strong':
			return styled('bold', children)
		case 'i':
		case 'em':
			return styled('italic', children)
		case 's':
		case 'strike':
			return styled('strike', children)
		case 'code':
			return styled('code', children)
		case 'span':
		case 'text': {
			const textContent = inlineText(inlineOnly(flatten(children)))
			return { type: 'text', text: textContent }
		}
		case 'a':
	case 'link':
		return link(props?.href ?? props?.url, children, props?.label)
	case 'mention':
		return { type: 'mention', kind: props?.kind ?? 'user', id: props?.id }
		case 'img':
		case 'image':
			return image(props?.src, props?.alt, children)
		case 'file':
			return file(props?.src ?? props?.url, props?.name, props?.mime)
		case 'pre':
		case 'codeblock': {
			const textContent = inlineText(inlineOnly(flatten(children)))
			return codeblock(props?.code ?? textContent, props?.language ?? props?.lang)
		}
		case 'raw':
			return raw(props?.platform, props?.payload)
		default:
			return flatten(children)
	}
}

export const Fragment = Symbol.for('pluxel.bot-layer.Fragment')

const normalizeChildren = (props: any): Child[] => {
	const c = props?.children
	if (c === undefined) return []
	return Array.isArray(c) ? c : [c]
}

export const jsx = (type: any, props: any = {}) => {
	if (type === Fragment) {
		return flatten(normalizeChildren(props))
	}
	if (typeof type === 'function') {
		return type({ ...props, children: props?.children })
	}
	return build(type as string, props, normalizeChildren(props))
}

export const jsxs = jsx
export const jsxDEV = jsx

export const createElement = (type: any, props: any, ...children: any[]) => {
	const mergedChildren = children.length ? children : props?.children
	return jsx(type, { ...props, children: mergedChildren })
}

export namespace JSX {
	export type Element = Part | Part[]
	export interface ElementClass {
		render: () => Element
	}
	export interface ElementAttributesProperty {
		props: any
	}
	export interface ElementChildrenAttribute {
		children: {}
	}

	export interface IntrinsicElements {
		b: { children?: any }
		strong: { children?: any }
		i: { children?: any }
		em: { children?: any }
		s: { children?: any }
		strike: { children?: any }
		code: { children?: any }
		span: { children?: any }
		text: { children?: any }
		a: { href: string; label?: string; children?: any }
		link: { href?: string; url?: string; label?: string; children?: any }
		mention: { kind: 'user' | 'role' | 'channel' | 'everyone'; id?: string | number }
		img: { src: string; alt?: string; children?: any }
		image: { src: string; alt?: string; children?: any }
		file: { src?: string; url?: string; name?: string; mime?: string }
		pre: { code?: string; language?: string; lang?: string; children?: any }
		codeblock: { code?: string; language?: string; children?: any }
		raw: { platform: Platform; payload: unknown }
	}
}
