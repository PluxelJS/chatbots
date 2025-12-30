import type { AudioPart, FilePart, ImagePart, MessageContent, Part, Platform, PlatformRegistry, ReplyOptions, VideoPart } from '../types'
import { normalizeMessageContent } from '../parts'
import { planOutbound } from './plan'
import type { PlatformAdapter } from '../adapter'
import { createSendHelpers } from './send-helpers'
import { assertTextOnly, audioToText, fileToText, imageToText, normalizeTextPartsForAdapter, videoToText, type TextLikePart } from '../render/normalize'

const degradeUnsupportedMediaForReply = <P extends Platform>(parts: Part[], adapter: PlatformAdapter<P>): Part[] => {
	const { capabilities } = adapter
	const out: Part[] = []

	for (const part of parts) {
		if (part.type === 'image' && !capabilities.supportsImage) {
			out.push({ type: 'text', text: imageToText(part) })
			continue
		}
		if (part.type === 'audio') {
			if (!capabilities.supportsAudio) {
				// 音频不支持时降级为文件
				if (capabilities.supportsFile) {
					out.push({ type: 'file', url: part.url, name: part.name, mime: part.mime, data: part.data, size: part.size })
				} else {
					out.push({ type: 'text', text: audioToText(part) })
				}
				continue
			}
		}
		if (part.type === 'video') {
			if (!capabilities.supportsVideo) {
				// 视频不支持时降级为文件
				if (capabilities.supportsFile) {
					out.push({ type: 'file', url: part.url, name: part.name, mime: part.mime, data: part.data, size: part.size })
				} else {
					out.push({ type: 'text', text: videoToText(part) })
				}
				continue
			}
		}
		if (part.type === 'file' && !capabilities.supportsFile) {
			out.push({ type: 'text', text: fileToText(part) })
			continue
		}
		out.push(part)
	}
	return out
}

const getSingleImageCaptionCandidate = (
	parts: Part[],
): { image: ImagePart; captionParts: TextLikePart[]; position: 'before' | 'after' } | null => {
	const images = parts.filter((p): p is ImagePart => p.type === 'image')
	const files = parts.filter((p): p is FilePart => p.type === 'file')
	const audios = parts.filter((p): p is AudioPart => p.type === 'audio')
	const videos = parts.filter((p): p is VideoPart => p.type === 'video')
	if (images.length !== 1 || files.length || audios.length || videos.length) return null

	const imageIndex = parts.findIndex((p) => p.type === 'image')
	if (imageIndex < 0) return null

	const before = parts.slice(0, imageIndex)
	const after = parts.slice(imageIndex + 1)

	if (before.length && after.length) return null
	if (!before.length && !after.length) return null

	assertTextOnly(before.concat(after), 'reply(image caption)')
	const captionParts = (before.length ? before : after) as TextLikePart[]
	return { image: images[0]!, captionParts, position: before.length ? 'before' : 'after' }
}

const resolveSplitOrder = (
	options: ReplyOptions | undefined,
	position: 'before' | 'after',
): 'text-first' | 'media-first' | 'forbid' => {
	const split = options?.splitFallback
	if (split === 'forbid' || split === 'text-first' || split === 'media-first') return split
	return position === 'before' ? 'text-first' : 'media-first'
}

const captionTooLongForAdapter = <P extends Platform>(
	adapter: PlatformAdapter<P>,
	captionParts: TextLikePart[],
): boolean => {
	const max = adapter.capabilities.maxCaptionLength
	if (typeof max !== 'number') return false
	const normalized = normalizeTextPartsForAdapter(captionParts, adapter)
	const rendered = adapter.render(normalized)
	return rendered.text.length > max
}

export const createReply =
	<P extends Platform>(adapter: PlatformAdapter<P>, session: PlatformRegistry[P]['raw']) =>
	async (content: MessageContent, options?: ReplyOptions) => {
		const input = normalizeMessageContent(content)
		if (!input.length) return

		const parts = degradeUnsupportedMediaForReply(input, adapter)
		const helpers = createSendHelpers(adapter, session)

		// 平台不支持 mixed 时：仅对"单图 + 单侧 caption"形态提供可控拆分（forbid/text-first/media-first/auto）
		if (!adapter.capabilities.supportsMixedMedia) {
			const candidate = getSingleImageCaptionCandidate(parts)
			if (candidate) {
				const order = resolveSplitOrder(options, candidate.position)
				if (order === 'forbid') {
					throw new Error(
						'bot-layer: 当前平台不支持单条图文混排，且 splitFallback=forbid；请改用 msg.sendImage/msg.sendText 自行编排',
					)
				}

				if (order === 'text-first') {
					await helpers.sendText(candidate.captionParts, options)
					await helpers.sendImage(candidate.image, undefined, options)
				} else {
					await helpers.sendImage(candidate.image, undefined, options)
					await helpers.sendText(candidate.captionParts, options)
				}
				return
			}
		}

		const ops = planOutbound(parts, adapter.capabilities)
		for (const op of ops) {
			switch (op.type) {
				case 'text':
					await helpers.sendText(op.parts, options)
					break
				case 'file':
					await helpers.sendFile(op.file, options)
					break
				case 'audio':
					await helpers.sendAudio(op.audio, options)
					break
				case 'video': {
					if (op.captionParts?.length && adapter.capabilities.supportsMixedMedia) {
						const captionParts = op.captionParts as TextLikePart[]
						if (captionTooLongForAdapter(adapter, captionParts)) {
							const order = resolveSplitOrder(options, op.captionPosition ?? 'after')
							if (order === 'forbid') {
								throw new Error('bot-layer: video caption 过长且 splitFallback=forbid；请自行拆分发送')
							}
							if (order === 'text-first') {
								await helpers.sendText(captionParts, options)
								await helpers.sendVideo(op.video, undefined, options)
							} else {
								await helpers.sendVideo(op.video, undefined, options)
								await helpers.sendText(captionParts, options)
							}
							break
						}
					}
					await helpers.sendVideo(op.video, op.captionParts, options)
					break
				}
				case 'image': {
					if (op.captionParts?.length && adapter.capabilities.supportsMixedMedia) {
						const captionParts = op.captionParts as TextLikePart[]
						if (captionTooLongForAdapter(adapter, captionParts)) {
							const order = resolveSplitOrder(options, op.captionPosition ?? 'after')
							if (order === 'forbid') {
								throw new Error('bot-layer: caption 过长且 splitFallback=forbid；请自行拆分发送')
							}
							if (order === 'text-first') {
								await helpers.sendText(captionParts, options)
								await helpers.sendImage(op.image, undefined, options)
							} else {
								await helpers.sendImage(op.image, undefined, options)
								await helpers.sendText(captionParts, options)
							}
							break
						}
					}

					await helpers.sendImage(op.image, op.captionParts, options)
					break
				}
			}
		}
	}
