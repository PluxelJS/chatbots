import type { MessageContent, ReplyPayload } from '../types'
import type { Part } from '../../parts'
import { isMessageBatch } from '../../parts'

const isPart = (value: unknown): value is Part =>
	typeof value === 'object' && value !== null && 'type' in (value as any) && typeof (value as any).type === 'string'

const isMessageContent = (value: unknown): value is MessageContent =>
	Array.isArray(value) && value.every((p) => isPart(p))

export const normalizeReplyPayload = (value: unknown): ReplyPayload | null => {
	if (value === undefined || value === null) return null

	if (isMessageBatch(value)) return value
	if (isMessageContent(value)) return value
	if (isPart(value)) return [value]

	if (typeof value === 'string' || typeof value === 'number') {
		const text = String(value ?? '')
		return text ? ([{ type: 'text', text }] as MessageContent) : []
	}

	return [{ type: 'text', text: String(value) }]
}
