import type { InlinePart, Part, PartInput } from './model'

const isPart = (value: unknown): value is Part =>
	Boolean(value) && typeof value === 'object' && 'type' in (value as any)

const normalizeInline = (children: InlinePart[]): InlinePart[] => {
	const acc: InlinePart[] = []
	for (const child of children) {
		switch (child.type) {
			case 'text': {
				if (!child.text) continue
				const prev = acc[acc.length - 1]
				if (prev?.type === 'text') {
					prev.text += child.text
				} else {
					acc.push(child)
				}
				break
			}
			case 'styled': {
				const normalized = normalizeInline(child.children)
				if (normalized.length) {
					acc.push({ ...child, children: normalized })
				}
				break
			}
			default:
				acc.push(child)
		}
	}
	return acc
}

const pushPart = (acc: Part[], part: Part) => {
	if (part.type === 'text') {
		if (!part.text) return
		const prev = acc[acc.length - 1]
		if (prev?.type === 'text') {
			prev.text += part.text
		} else {
			acc.push(part)
		}
		return
	}

	if (part.type === 'styled') {
		const children = normalizeInline(part.children)
		if (children.length) {
			acc.push({ ...part, children })
		}
		return
	}

	acc.push(part)
}

export const normalizeMessageContent = (input: PartInput): Part[] => {
	const acc: Part[] = []

	const visit = (value: PartInput | Part | unknown): void => {
		if (value === null || value === undefined) return

		if (typeof value === 'string') {
			pushPart(acc, { type: 'text', text: value })
			return
		}

		if (Array.isArray(value)) {
			for (const item of value) visit(item as PartInput)
			return
		}

		if (isPart(value)) {
			pushPart(acc, value)
			return
		}

		if (typeof value === 'object' && Symbol.iterator in (value as any)) {
			for (const item of value as Iterable<PartInput | null | undefined>) {
				visit(item)
			}
			return
		}
	}

	visit(input)
	return acc
}

export const toPartArray = (content: PartInput): Part[] => normalizeMessageContent(content)
