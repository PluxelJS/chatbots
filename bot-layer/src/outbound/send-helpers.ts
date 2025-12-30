import type { AudioPart, FilePart, ImagePart, MessageContent, Platform, PlatformRegistry, ReplyOptions, VideoPart } from '../types'
import { normalizeMessageContent } from '../parts'
import type { OutboundText, PlatformAdapter } from '../adapter'
import { assertTextOnly, normalizeTextPartsForAdapter, type TextLikePart } from '../render/normalize'

export const createUploadHelpers =
	<P extends Platform>(adapter: PlatformAdapter<P>, session: PlatformRegistry[P]['raw']) => ({
		uploadImage: async (image: ImagePart): Promise<ImagePart> => {
			if (!adapter.capabilities.supportsImage) {
				throw new Error(`bot-layer: platform ${adapter.name} 不支持图片`)
			}
			if (adapter.uploadImage) return adapter.uploadImage(session, image)
			if (image.data) {
				throw new Error(`bot-layer: platform ${adapter.name} 缺少 uploadImage，且当前图片需要上传(data)`)
			}
			return image
		},
		uploadFile: async (file: FilePart): Promise<FilePart> => {
			if (!adapter.capabilities.supportsFile) {
				throw new Error(`bot-layer: platform ${adapter.name} 不支持文件`)
			}
			if (adapter.uploadFile) return adapter.uploadFile(session, file)
			if (file.data) {
				throw new Error(`bot-layer: platform ${adapter.name} 缺少 uploadFile，且当前文件需要上传(data)`)
			}
			return file
		},
	})

export const createSendHelpers = <P extends Platform>(adapter: PlatformAdapter<P>, session: PlatformRegistry[P]['raw']) => {
	const quoteSupported = adapter.capabilities.supportsQuote
	const uploader = createUploadHelpers(adapter, session)

	const toOutboundText = (parts: TextLikePart[]): OutboundText => ({
		parts,
		rendered: adapter.render(parts),
	})

	const safeOptions = (options?: ReplyOptions): ReplyOptions | undefined =>
		options?.quote && !quoteSupported ? { ...options, quote: false } : options

	const normalizeOutboundText = (content: MessageContent, label: string): TextLikePart[] => {
		const parts = normalizeMessageContent(content)
		if (!parts.length) return []
		assertTextOnly(parts, label)
		return normalizeTextPartsForAdapter(parts as TextLikePart[], adapter)
	}

	const sendText = async (content: MessageContent, options?: ReplyOptions) => {
		const parts = normalizeOutboundText(content, 'sendText')
		if (!parts.length) return

		const outbound = toOutboundText(parts)
		if (!outbound.rendered.text) return

		const max = adapter.capabilities.maxTextLength
		if (typeof max === 'number' && outbound.rendered.text.length > max) {
			throw new Error(`bot-layer: 文本过长(${outbound.rendered.text.length} > ${max})，请自行拆分发送`)
		}

		await adapter.sendText(session, outbound, safeOptions(options))
	}

	const sendImage = async (image: ImagePart, caption?: MessageContent, options?: ReplyOptions) => {
		if (!adapter.capabilities.supportsImage) throw new Error(`bot-layer: platform ${adapter.name} 不支持图片`)
		if (!adapter.sendImage) throw new Error(`bot-layer: adapter ${adapter.name} 缺少 sendImage`)

		const uploaded = image.data ? await uploader.uploadImage(image) : image

		const captionParts = caption === undefined ? [] : normalizeOutboundText(caption, 'sendImage(caption)')
		const outboundCaption = captionParts.length ? toOutboundText(captionParts) : undefined

		if (outboundCaption?.rendered.text) {
			const max = adapter.capabilities.maxCaptionLength
			if (typeof max === 'number' && outboundCaption.rendered.text.length > max) {
				throw new Error(`bot-layer: caption 过长(${outboundCaption.rendered.text.length} > ${max})，请自行拆分发送`)
			}
		}

		await adapter.sendImage(session, uploaded, outboundCaption, safeOptions(options))
	}

	const sendAudio = async (audio: AudioPart, options?: ReplyOptions) => {
		// 如果平台不支持音频，降级为文件
		if (!adapter.capabilities.supportsAudio) {
			const file: FilePart = {
				type: 'file',
				url: audio.url,
				name: audio.name,
				mime: audio.mime,
				data: audio.data,
				size: audio.size,
			}
			await sendFile(file, options)
			return
		}
		if (!adapter.sendAudio) {
			// 没有专门的 sendAudio，降级为文件
			const file: FilePart = {
				type: 'file',
				url: audio.url,
				name: audio.name,
				mime: audio.mime,
				data: audio.data,
				size: audio.size,
			}
			await sendFile(file, options)
			return
		}
		await adapter.sendAudio(session, audio, safeOptions(options))
	}

	const sendVideo = async (video: VideoPart, caption?: MessageContent, options?: ReplyOptions) => {
		// 如果平台不支持视频，降级为文件
		if (!adapter.capabilities.supportsVideo) {
			const file: FilePart = {
				type: 'file',
				url: video.url,
				name: video.name,
				mime: video.mime,
				data: video.data,
				size: video.size,
			}
			await sendFile(file, options)
			return
		}
		if (!adapter.sendVideo) {
			// 没有专门的 sendVideo，降级为文件
			const file: FilePart = {
				type: 'file',
				url: video.url,
				name: video.name,
				mime: video.mime,
				data: video.data,
				size: video.size,
			}
			await sendFile(file, options)
			return
		}

		const captionParts = caption === undefined ? [] : normalizeOutboundText(caption, 'sendVideo(caption)')
		const outboundCaption = captionParts.length ? toOutboundText(captionParts) : undefined

		if (outboundCaption?.rendered.text) {
			const max = adapter.capabilities.maxCaptionLength
			if (typeof max === 'number' && outboundCaption.rendered.text.length > max) {
				throw new Error(`bot-layer: video caption 过长(${outboundCaption.rendered.text.length} > ${max})，请自行拆分发送`)
			}
		}

		await adapter.sendVideo(session, video, outboundCaption, safeOptions(options))
	}

	const sendFile = async (file: FilePart, options?: ReplyOptions) => {
		if (!adapter.capabilities.supportsFile) throw new Error(`bot-layer: platform ${adapter.name} 不支持文件`)
		if (!adapter.sendFile) throw new Error(`bot-layer: adapter ${adapter.name} 缺少 sendFile`)
		const uploaded = file.data ? await uploader.uploadFile(file) : file
		await adapter.sendFile(session, uploaded, safeOptions(options))
	}

	return { sendText, sendImage, sendAudio, sendVideo, sendFile, ...uploader }
}
