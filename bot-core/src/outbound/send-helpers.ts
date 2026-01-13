import type {
	AudioPart,
	FilePart,
	ImagePart,
	MediaPart,
	MessageContent,
	Platform,
	PlatformRegistry,
	ReplyOptions,
	OutboundOpType,
	VideoPart,
} from '../types'
import type { OutboundOp, OutboundText, PlatformAdapter } from '../adapter'
import { assertTextOnly, normalizeTextPartsForAdapter, type TextLikePart } from '../render/normalize'
import { assertValidParts } from '../../parts/validate'

export const createSendHelpers = <P extends Platform>(adapter: PlatformAdapter<P>, session: PlatformRegistry[P]['raw']) => {
	const quoteSupported = adapter.policy.outbound.supportsQuote

	const supports = (type: OutboundOpType): boolean => adapter.policy.outbound.supportedOps.includes(type)

	const toOutboundText = (parts: TextLikePart[]): OutboundText => ({
		parts,
		rendered: adapter.render(parts),
	})

	const safeOptions = (options?: ReplyOptions): ReplyOptions | undefined =>
		options?.quote && !quoteSupported ? { ...options, quote: false } : options

	const normalizeOutboundText = (content: MessageContent, label: string): TextLikePart[] => {
		if (!content.length) return []
		assertValidParts(content, label)
		assertTextOnly(content, label)
		return normalizeTextPartsForAdapter(content as TextLikePart[], adapter)
	}

	const uploadIfNeeded = async <T extends MediaPart>(media: T): Promise<T> => {
		if (!media.data) return media
		if (!adapter.uploadMedia) {
			throw new Error(`bot-core: adapter ${adapter.name} 缺少 uploadMedia，且当前媒体需要上传(data)`)
		}
		return (await adapter.uploadMedia(session, media)) as T
	}

	const sendOp = async (op: OutboundOp, options?: ReplyOptions): Promise<void> =>
		adapter.send(session, op, safeOptions(options))

	const sendText = async (content: MessageContent, options?: ReplyOptions) => {
		if (!supports('text')) throw new Error(`bot-core: platform ${adapter.name} 不支持文本`)
		const parts = normalizeOutboundText(content, 'sendText')
		if (!parts.length) return

		const outbound = toOutboundText(parts)
		if (!outbound.rendered.text) return

		const max = adapter.policy.text.maxTextLength
		if (typeof max === 'number' && outbound.rendered.text.length > max) {
			throw new Error(`bot-core: 文本过长(${outbound.rendered.text.length} > ${max})，请自行拆分发送`)
		}

		await sendOp({ type: 'text', text: outbound }, options)
	}

	const sendImage = async (image: ImagePart, caption?: MessageContent, options?: ReplyOptions) => {
		if (!supports('image')) throw new Error(`bot-core: platform ${adapter.name} 不支持图片`)

		const uploaded = await uploadIfNeeded(image)

		const captionParts = caption === undefined ? [] : normalizeOutboundText(caption, 'sendImage(caption)')
		const outboundCaption = captionParts.length ? toOutboundText(captionParts) : undefined

		if (outboundCaption?.rendered.text && !adapter.policy.outbound.supportsMixedMedia) {
			throw new Error(`bot-core: platform ${adapter.name} 不支持单条图文混排，请自行拆分发送`)
		}

		if (outboundCaption?.rendered.text) {
			const max = adapter.policy.outbound.maxCaptionLength
			if (typeof max === 'number' && outboundCaption.rendered.text.length > max) {
				throw new Error(`bot-core: caption 过长(${outboundCaption.rendered.text.length} > ${max})，请自行拆分发送`)
			}
		}

		await sendOp({ type: 'image', image: uploaded, caption: outboundCaption }, options)
	}

	const sendAudio = async (audio: AudioPart, options?: ReplyOptions) => {
		if (!supports('audio')) throw new Error(`bot-core: platform ${adapter.name} 不支持音频`)
		const uploaded = await uploadIfNeeded(audio)
		await sendOp({ type: 'audio', audio: uploaded }, options)
	}

	const sendVideo = async (video: VideoPart, caption?: MessageContent, options?: ReplyOptions) => {
		if (!supports('video')) throw new Error(`bot-core: platform ${adapter.name} 不支持视频`)

		const uploaded = await uploadIfNeeded(video)
		const captionParts = caption === undefined ? [] : normalizeOutboundText(caption, 'sendVideo(caption)')
		const outboundCaption = captionParts.length ? toOutboundText(captionParts) : undefined

		if (outboundCaption?.rendered.text && !adapter.policy.outbound.supportsMixedMedia) {
			throw new Error(`bot-core: platform ${adapter.name} 不支持单条图文混排，请自行拆分发送`)
		}

		if (outboundCaption?.rendered.text) {
			const max = adapter.policy.outbound.maxCaptionLength
			if (typeof max === 'number' && outboundCaption.rendered.text.length > max) {
				throw new Error(`bot-core: video caption 过长(${outboundCaption.rendered.text.length} > ${max})，请自行拆分发送`)
			}
		}

		await sendOp({ type: 'video', video: uploaded, caption: outboundCaption }, options)
	}

	const sendFile = async (file: FilePart, options?: ReplyOptions) => {
		if (!supports('file')) throw new Error(`bot-core: platform ${adapter.name} 不支持文件`)
		const uploaded = await uploadIfNeeded(file)
		await sendOp({ type: 'file', file: uploaded }, options)
	}

	return { sendText, sendImage, sendAudio, sendVideo, sendFile }
}
