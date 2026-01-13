import type { Part, Platform, ReplyMode } from '../types'
import type { PlatformAdapter } from '../adapter'
import { planOutbound, type OutboundDraftOp } from './plan'
import { assertTextOnly, normalizeTextPartsForAdapter, type TextLikePart } from '../render/normalize'
import { audioToText, fileToText, imageToText, videoToText } from '../render/normalize'
import { assertValidParts } from '../../parts/validate'

export interface CompileReplyOptions {
	mode?: ReplyMode
}

export type OutboundAction =
	| { type: 'text'; parts: TextLikePart[] }
	| { type: 'image'; image: Extract<Part, { type: 'image' }>; captionParts?: TextLikePart[] }
	| { type: 'audio'; audio: Extract<Part, { type: 'audio' }> }
	| { type: 'video'; video: Extract<Part, { type: 'video' }>; captionParts?: TextLikePart[] }
	| { type: 'file'; file: Extract<Part, { type: 'file' }> }

const degradeUnsupportedMedia = <P extends Platform>(parts: Part[], adapter: PlatformAdapter<P>, mode: ReplyMode): Part[] => {
	const outbound = adapter.policy.outbound
	const supports = (type: 'text' | 'image' | 'audio' | 'video' | 'file') => outbound.supportedOps.includes(type)
	const out: Part[] = []

	for (const part of parts) {
		if (part.type === 'image' && !supports('image')) {
			if (mode === 'strict') throw new Error(`bot-core: platform ${adapter.name} 不支持图片`)
			out.push({ type: 'text', text: imageToText(part) })
			continue
		}
		if (part.type === 'audio' && !supports('audio')) {
			if (mode === 'strict') throw new Error(`bot-core: platform ${adapter.name} 不支持音频`)
			if (supports('file')) {
				out.push({ type: 'file', url: part.url, name: part.name, mime: part.mime, data: part.data, size: part.size })
			} else {
				out.push({ type: 'text', text: audioToText(part) })
			}
			continue
		}
		if (part.type === 'video' && !supports('video')) {
			if (mode === 'strict') throw new Error(`bot-core: platform ${adapter.name} 不支持视频`)
			if (supports('file')) {
				out.push({ type: 'file', url: part.url, name: part.name, mime: part.mime, data: part.data, size: part.size })
			} else {
				out.push({ type: 'text', text: videoToText(part) })
			}
			continue
		}
		if (part.type === 'file' && !supports('file')) {
			if (mode === 'strict') throw new Error(`bot-core: platform ${adapter.name} 不支持文件`)
			out.push({ type: 'text', text: fileToText(part) })
			continue
		}
		out.push(part)
	}

	return out
}

const captionTooLong = <P extends Platform>(
	adapter: PlatformAdapter<P>,
	captionParts: TextLikePart[],
): boolean => {
	const max = adapter.policy.outbound.maxCaptionLength
	if (typeof max !== 'number') return false
	const normalized = normalizeTextPartsForAdapter(captionParts, adapter)
	const rendered = adapter.render(normalized)
	return rendered.text.length > max
}

const explodeCaptionIfNeeded = <P extends Platform>(
	adapter: PlatformAdapter<P>,
	op: Extract<OutboundDraftOp, { type: 'image' | 'video' }>,
	mode: ReplyMode,
): OutboundDraftOp[] => {
	if (!op.captionParts?.length) return [op]
	if (!adapter.policy.outbound.supportsMixedMedia) return [op]

	const parts = op.captionParts as TextLikePart[]
	assertTextOnly(parts, `${op.type}(caption)`)
	const normalized = normalizeTextPartsForAdapter(parts, adapter)
	if (!captionTooLong(adapter, normalized)) return [{ ...op, captionParts: normalized }]

	if (mode === 'strict') {
		throw new Error(`bot-core: ${op.type} caption 过长，且 reply.mode=strict`)
	}

	// Split and preserve original caption side preference.
	if (op.captionPosition === 'before') {
		return [{ type: 'text', parts: normalized }, { ...op, captionParts: undefined, captionPosition: undefined }]
	}
	return [{ ...op, captionParts: undefined, captionPosition: undefined }, { type: 'text', parts: normalized }]
}

export const compileReply = <P extends Platform>(
	adapter: PlatformAdapter<P>,
	parts: Part[],
	options?: CompileReplyOptions,
): OutboundAction[] => {
	const mode: ReplyMode = options?.mode ?? 'best-effort'
	assertValidParts(parts, 'reply(content)')
	const normalized = degradeUnsupportedMedia(parts, adapter, mode)
	const draft = planOutbound(normalized, adapter.policy.outbound)
	const exploded: OutboundDraftOp[] = []

	for (const op of draft) {
		if (op.type === 'image' || op.type === 'video') {
			exploded.push(...explodeCaptionIfNeeded(adapter, op, mode))
			continue
		}
		if (op.type === 'text') {
			assertTextOnly(op.parts, 'reply(text)')
			exploded.push({ type: 'text', parts: normalizeTextPartsForAdapter(op.parts as TextLikePart[], adapter) })
			continue
		}
		exploded.push(op)
	}

	return exploded.map((op) => {
		switch (op.type) {
			case 'text':
				return { type: 'text', parts: op.parts as TextLikePart[] }
			case 'image':
				return { type: 'image', image: op.image, captionParts: op.captionParts as TextLikePart[] | undefined }
			case 'video':
				return { type: 'video', video: op.video, captionParts: op.captionParts as TextLikePart[] | undefined }
			case 'audio':
				return { type: 'audio', audio: op.audio }
			case 'file':
				return { type: 'file', file: op.file }
		}
	})
}
