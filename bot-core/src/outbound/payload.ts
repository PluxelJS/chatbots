import type { MessageContent, ReplyPayload } from '../types'
import type { Part } from '../../parts'
import { isMessageBatch } from '../../parts'

const isPart = (value: unknown): value is Part =>
	typeof value === 'object' && value !== null && 'type' in (value as any) && typeof (value as any).type === 'string'

const isMessageContent = (value: unknown): value is MessageContent =>
	Array.isArray(value) && value.every((p) => isPart(p))

const safeJsonStringify = (value: unknown): string | null => {
	try {
		const seen = new WeakSet<object>()
		const json = JSON.stringify(
			value,
			(_key, v) => {
				if (typeof v === 'bigint') return v.toString()
				if (v instanceof Error) {
					const extra: Record<string, unknown> = {}
					for (const k of Object.keys(v as any)) extra[k] = (v as any)[k]
					return { name: v.name, message: v.message, stack: v.stack, ...extra }
				}
				if (typeof v === 'object' && v !== null) {
					if (seen.has(v)) return '[Circular]'
					seen.add(v)
				}
				return v
			},
			2,
		)
		return typeof json === 'string' ? json : null
	} catch {
		return null
	}
}

export const normalizeReplyPayload = (value: unknown): ReplyPayload | null => {
	if (value === undefined || value === null) return null

	if (isMessageBatch(value)) return value
	if (isMessageContent(value)) return value
	if (isPart(value)) return [value]

	if (typeof value === 'string' || typeof value === 'number') {
		const text = String(value ?? '')
		return text ? ([{ type: 'text', text }] as MessageContent) : []
	}

	if (typeof value === 'object') {
		const json = safeJsonStringify(value)
		if (json) return [{ type: 'codeblock', language: 'json', code: json }]
	}

	return [{ type: 'text', text: String(value) }]
}
