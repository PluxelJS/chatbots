import { Buffer } from 'node:buffer'

import type {
	AnyMessage,
	Attachment,
	AttachmentSource,
	MediaKind,
	MediaPart,
	ResolvedAttachment,
	Part,
	Platform,
} from '../types'

export interface AttachmentCollectOptions {
	includeReferences?: boolean
}

export interface ResolveAttachmentsOptions extends AttachmentCollectOptions {
	limit?: number
	filter?: (attachment: Attachment) => boolean
	concurrency?: number
	signal?: AbortSignal
}

const MEDIA_TYPES: Set<string> = new Set(['image', 'audio', 'video', 'file'])

const isMediaPart = (part: Part): part is MediaPart => MEDIA_TYPES.has(part.type)

const toAttachmentKey = (attachment: Attachment): string | null => {
	const part = attachment.part
	const id = part.fileId ?? part.url ?? null
	return id ? `${attachment.platform}:${attachment.source}:${id}` : null
}

const toBuffer = (input: ArrayBuffer | ArrayBufferView | Buffer): Buffer => {
	if (Buffer.isBuffer(input)) return input
	if (input instanceof ArrayBuffer) return Buffer.from(input)
	return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
}

const fetchUrl = async (url: string, signal?: AbortSignal): Promise<Buffer> => {
	const res = await fetch(url, signal ? { signal } : undefined)
	if (!res.ok) throw new Error(`bot-core: 下载附件失败 ${res.status} ${res.statusText}`)
	return Buffer.from(await res.arrayBuffer())
}

const throwIfAborted = (signal?: AbortSignal) => {
	if (signal?.aborted) {
		throw new Error('bot-core: resolveAttachments aborted')
	}
}

const downloadAttachment = async (attachment: Attachment, signal?: AbortSignal): Promise<Buffer> => {
	throwIfAborted(signal)

	// fetch 现在是必须的
	const data = await attachment.fetch(signal)
	return toBuffer(data)
}

const normalizeConcurrency = (value: number | undefined, total: number): number => {
	const base = typeof value === 'number' ? Math.floor(value) : 4
	if (!Number.isFinite(base) || base <= 0) return 1
	return Math.min(base, Math.max(1, total))
}

/** 从 URL 或 data 创建 fetch 函数 */
export const createMediaFetch = (part: MediaPart): Attachment['fetch'] => {
	if (part.data) {
		const buffer = toBuffer(part.data as ArrayBuffer | ArrayBufferView)
		return async () => buffer
	}
	if (part.url) {
		return (signal) => fetchUrl(part.url!, signal)
	}
	throw new Error('bot-core: media part 无 url 或 data，无法创建 fetch')
}

const toAttachments = (parts: Part[], platform: Platform, source: AttachmentSource): Attachment[] =>
	parts.filter(isMediaPart).map((part) => ({
		platform,
		kind: part.type as MediaKind,
		part,
		source,
		fetch: createMediaFetch(part),
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

export const resolveAttachments = async (
	msg: AnyMessage,
	opts?: ResolveAttachmentsOptions,
): Promise<ResolvedAttachment[]> => {
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
			results[index] = { platform: att.platform, kind: att.kind, part: att.part, source: att.source, data }
		}
	}

	const workers = Array.from({ length: concurrency }, () => run())
	await Promise.all(workers)
	return results
}
