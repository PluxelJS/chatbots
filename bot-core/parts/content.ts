import type { Part } from './model'
import { codeblock, fileData, imageData, text } from './dsl'

export type MessageContentLike = Part[] | Part | string | number | null | undefined

/**
 * Explicit multi-message payload (ordered).
 *
 * - Used when the caller *intends* to send multiple messages, instead of relying on platform-driven auto splitting.
 * - `atomic=true` means "fail-fast": stop at first failure and throw (platforms usually can't rollback already-sent messages).
 */
export interface MessageBatch {
	kind: 'message-batch'
	messages: Part[][]
	atomic?: boolean
}

const isPart = (value: unknown): value is Part =>
	typeof value === 'object' && value !== null && 'type' in (value as any) && typeof (value as any).type === 'string'

export const isMessageBatch = (value: unknown): value is MessageBatch =>
	typeof value === 'object' &&
	value !== null &&
	(value as any).kind === 'message-batch' &&
	Array.isArray((value as any).messages)

const pushText = (out: Part[], value: string) => {
	if (!value) return
	const prev = out[out.length - 1]
	if (prev?.type === 'text') {
		prev.text += value
		return
	}
	out.push({ type: 'text', text: value })
}

const pushParts = (out: Part[], parts: readonly Part[]) => {
	for (const part of parts) {
		if (part.type === 'text') pushText(out, part.text)
		else out.push(part)
	}
}

export const content = {
	empty(): Part[] {
		return []
	},

	text(value: string | number | null | undefined): Part[] {
		const s = String(value ?? '')
		return s ? [text(s)] : []
	},

	lines(...lines: Array<string | number | null | undefined>): Part[] {
		const s = lines
			.map((x) => String(x ?? ''))
			.filter(Boolean)
			.join('\n')
		return s ? [text(s)] : []
	},

	json(payload: unknown): Part[] {
		return [codeblock(JSON.stringify(payload, null, 2), 'json')]
	},

	imageData(
		data: Uint8Array | ArrayBufferLike,
		opts?: { alt?: string; name?: string; mime?: string; width?: number; height?: number; size?: number },
	): Part[] {
		return [imageData(data, opts)]
	},

	fileData(
		data: Uint8Array | ArrayBufferLike,
		opts?: { name?: string; mime?: string; size?: number },
	): Part[] {
		return [fileData(data, opts)]
	},

	of(...items: MessageContentLike[]): Part[] {
		const out: Part[] = []
		for (const item of items) {
			if (item == null) continue
			if (typeof item === 'string' || typeof item === 'number') {
				pushText(out, String(item))
				continue
			}
			if (Array.isArray(item)) {
				pushParts(out, item)
				continue
			}
			if (isPart(item)) {
				if (item.type === 'text') pushText(out, item.text)
				else out.push(item)
				continue
			}
			pushText(out, String(item))
		}
		return out
	},

	/** 显式表达“多条消息”。 */
	batch(...messages: MessageContentLike[]): MessageBatch {
		const out: Part[][] = []
		for (const m of messages) {
			const parts = content.of(m)
			if (parts.length) out.push(parts)
		}
		return { kind: 'message-batch', messages: out }
	},

	/** 显式表达“多条消息”，并标记为 best-effort（尽量发送完所有条目）。 */
	batchBestEffort(...messages: MessageContentLike[]): MessageBatch {
		const batch = content.batch(...messages)
		return { ...batch, atomic: false }
	},
} as const

/** Alias: message content helpers */
export const mc = content
