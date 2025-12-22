import { Buffer } from 'node:buffer'

import type {
	AnyMessage,
	Attachment,
	AttachmentSource,
	ResolvedAttachment,
	Part,
	Platform,
} from './types'

export interface AttachmentCollectOptions {
	includeReferences?: boolean
}

export interface ResolveAttachmentsOptions extends AttachmentCollectOptions {
	limit?: number
	filter?: (attachment: Attachment) => boolean
	concurrency?: number
	signal?: AbortSignal
}

const isAttachmentPart = (part: Part): part is Extract<Part, { type: 'image' | 'file' }> =>
	part.type === 'image' || part.type === 'file'

const toAttachmentKey = (attachment: Attachment): string | null => {
	const id = (attachment.part as any).fileId ?? attachment.part.url ?? null
	return id ? `${attachment.platform}:${attachment.source}:${id}` : null
}

const toBuffer = (input: ArrayBuffer | ArrayBufferView | Buffer): Buffer => {
	if (Buffer.isBuffer(input)) return input
	if (input instanceof ArrayBuffer) return Buffer.from(input)
	return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
}

const fetchUrl = async (url: string, signal?: AbortSignal): Promise<Buffer> => {
	const res = await fetch(url, signal ? { signal } : undefined)
	if (!res.ok) throw new Error(`bot-layer: 下载附件失败 ${res.status} ${res.statusText}`)
	return Buffer.from(await res.arrayBuffer())
}

const throwIfAborted = (signal?: AbortSignal) => {
	if (signal?.aborted) {
		throw new Error('bot-layer: resolveAttachments aborted')
	}
}

const downloadAttachment = async (attachment: Attachment, signal?: AbortSignal): Promise<Buffer> => {
	throwIfAborted(signal)
	if (attachment.fetch) {
		const data = await attachment.fetch(signal)
		return toBuffer(data)
	}

	const part = attachment.part
	if ((part as any).data) {
		return toBuffer((part as any).data)
	}

	if (part.url) {
		return fetchUrl(part.url, signal)
	}

	throw new Error('bot-layer: attachment 无可用下载方式')
}

const normalizeConcurrency = (value: number | undefined, total: number): number => {
	const base = typeof value === 'number' ? Math.floor(value) : 4
	if (!Number.isFinite(base) || base <= 0) return 1
	return Math.min(base, Math.max(1, total))
}

const toAttachments = (parts: Part[], platform: Platform, source: AttachmentSource): Attachment[] =>
	parts
		.filter(isAttachmentPart)
		.map((part) => ({
			platform,
			kind: part.type,
			part: part as Extract<Part, { type: 'image' | 'file' }>,
			source,
		}))

export const collectAttachments = (msg: AnyMessage, opts?: AttachmentCollectOptions): Attachment[] => {
	const includeReferences = opts?.includeReferences ?? true
	const attachments: Attachment[] = []
	const seen = new Set<string>()

	const push = (att: Attachment) => {
		const key = toAttachmentKey(att)
		if (key) {
			if (seen.has(key)) return
			seen.add(key)
		}
		attachments.push(att)
	}

	const baseAtt = msg.attachments?.length
		? (msg.attachments as Attachment[])
		: toAttachments(msg.parts, msg.platform, 'message')
	baseAtt.forEach(push)

	if (includeReferences && msg.reference) {
		const refAtt = msg.reference.attachments?.length
			? (msg.reference.attachments as Attachment[])
			: toAttachments(msg.reference.parts, msg.reference.platform, 'reference')
		refAtt.forEach(push)
	}

	return attachments
}

export const resolveAttachments = async (msg: AnyMessage, opts?: ResolveAttachmentsOptions): Promise<ResolvedAttachment[]> => {
	const includeReferences = opts?.includeReferences ?? true
	const filtered = collectAttachments(msg, { includeReferences }).filter((att) =>
		typeof opts?.filter === 'function' ? opts.filter(att) : true,
	)
	const limited = typeof opts?.limit === 'number' ? filtered.slice(0, opts.limit) : filtered

	if (!limited.length) return []
	const signal = opts?.signal
	const concurrency = normalizeConcurrency(opts?.concurrency, limited.length)
	const results = new Array<ResolvedAttachment>(limited.length)
	let cursor = 0

	const run = async () => {
		while (true) {
			throwIfAborted(signal)
			const index = cursor++
			if (index >= limited.length) return
			const att = limited[index]
			const data = await downloadAttachment(att, signal)
			results[index] = { ...att, data }
		}
	}

	const workers = Array.from({ length: concurrency }, () => run())
	await Promise.all(workers)
	return results
}
