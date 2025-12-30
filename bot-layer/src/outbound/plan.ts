import type { FilePart, ImagePart, Part, PlatformCapabilities } from '../types'

export type OutboundDraftOp =
	| { type: 'text'; parts: Part[] }
	| { type: 'image'; image: ImagePart; captionParts?: Part[]; captionPosition?: 'before' | 'after' }
	| { type: 'file'; file: FilePart }

const isTextLike = (part: Part): boolean =>
	part.type !== 'image' && part.type !== 'file'

export const planOutbound = (parts: Part[], capabilities: PlatformCapabilities): OutboundDraftOp[] => {
	const ops: OutboundDraftOp[] = []
	let textBuffer: Part[] = []

	const flushText = () => {
		if (!textBuffer.length) return
		ops.push({ type: 'text', parts: textBuffer })
		textBuffer = []
	}

	for (let index = 0; index < parts.length; index++) {
		const part = parts[index]!
		if (isTextLike(part)) {
			textBuffer.push(part)
			continue
		}

		if (part.type === 'image') {
			const supportsMixed = capabilities.supportsMixedMedia === true
			// Only treat adjacent text as caption when it's one-sided (all before or all after).
			// If text exists on both sides of the image, keep the original order and don't bind a caption.
			if (supportsMixed && textBuffer.length && index + 1 < parts.length && isTextLike(parts[index + 1]!)) {
				flushText()
				ops.push({ type: 'image', image: part })
				continue
			}
			if (supportsMixed && textBuffer.length) {
				ops.push({ type: 'image', image: part, captionParts: textBuffer, captionPosition: 'before' })
				textBuffer = []
			} else {
				if (supportsMixed && index + 1 < parts.length) {
					const start = index + 1
					let end = start
					while (end < parts.length && isTextLike(parts[end]!)) end++
					const hasTrailingText = end > start
					const hasMoreMediaAfterTrailingText = end < parts.length

					if (hasTrailingText && !hasMoreMediaAfterTrailingText) {
						ops.push({
							type: 'image',
							image: part,
							captionParts: parts.slice(start, end),
							captionPosition: 'after',
						})
						index = end - 1
						continue
					}
				}

				flushText()
				ops.push({ type: 'image', image: part })
			}
			continue
		}

		if (part.type === 'file') {
			flushText()
			ops.push({ type: 'file', file: part })
			continue
		}
	}

	flushText()
	return ops
}
