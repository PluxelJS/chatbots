import type { Part } from './model'

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isValidId = (id: unknown): id is string | number =>
	(typeof id === 'string' && id.length > 0) || (typeof id === 'number' && Number.isFinite(id))

const formatValuePreview = (value: unknown): string => {
	if (value === null) return 'null'
	if (value === undefined) return 'undefined'
	if (typeof value === 'string') return JSON.stringify(value.length > 80 ? value.slice(0, 77) + '...' : value)
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value)
		} catch {
			return Object.prototype.toString.call(value)
		}
	}
	return String(value)
}

export const assertValidPart = (part: Part): void => {
	switch (part.type) {
		case 'text':
			if (typeof part.text !== 'string') throw new Error('bot-layer: text.text must be a string')
			return

		case 'mention':
			if (part.kind === 'everyone') {
				if ('id' in part) throw new Error('bot-layer: mention(kind=everyone) must not have id')
				return
			}
			if (part.kind !== 'user' && part.kind !== 'role' && part.kind !== 'channel') {
				throw new Error(`bot-layer: mention.kind is invalid: ${(part as any).kind}`)
			}
			if (!isValidId((part as any).id)) throw new Error(`bot-layer: mention(kind=${part.kind}) requires a valid id`)
			return

		case 'link':
			if (!isNonEmptyString(part.url)) throw new Error('bot-layer: link.url must be a non-empty string')
			if (part.label !== undefined && typeof part.label !== 'string') throw new Error('bot-layer: link.label must be a string')
			return

		case 'styled':
			if (!Array.isArray(part.children) || part.children.length === 0) {
				throw new Error('bot-layer: styled.children must be non-empty')
			}
			for (const child of part.children) assertValidPart(child as any)
			return

		case 'codeblock':
			if (typeof part.code !== 'string') throw new Error('bot-layer: codeblock.code must be a string')
			if (part.code.length === 0) throw new Error('bot-layer: codeblock.code must not be empty')
			return

		case 'image':
		case 'audio':
		case 'video':
		case 'file': {
			const hasRef =
				(part as any).data !== undefined ||
				isNonEmptyString((part as any).url) ||
				isNonEmptyString((part as any).fileId)
			if (!hasRef) throw new Error(`bot-layer: ${part.type} must have one of {url,data,fileId}`)
			return
		}

		default:
			throw new Error(`bot-layer: unknown part.type: ${(part as any).type}`)
	}
}

export const assertValidParts = (parts: readonly Part[], label = 'parts'): void => {
	if (!Array.isArray(parts)) throw new Error(`bot-layer: ${label} must be an array of Part`)
	for (let i = 0; i < parts.length; i++) {
		const part = (parts as any)[i]
		if (!part || typeof part !== 'object') {
			throw new Error(
				`bot-layer: ${label}[${i}] must be a Part object, got ${typeof part} ${formatValuePreview(part)}. ` +
					`If you used parts\`...\`, make sure each \${...} expression evaluates to a Part (e.g. p.text(value), p.mentionUser(id), p.link(url)).`,
			)
		}
		if (typeof (part as any).type !== 'string') {
			throw new Error(
				`bot-layer: ${label}[${i}] must have a string "type", got ${formatValuePreview((part as any).type)}. ` +
					`If you used parts\`...\`, make sure each \${...} expression evaluates to a Part.`,
			)
		}
		assertValidPart(part as Part)
	}
}
