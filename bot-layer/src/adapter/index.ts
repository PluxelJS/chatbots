import type { AudioPart, FilePart, ImagePart, Part, Platform, PlatformCapabilities, PlatformRegistry, ReplyOptions, VideoPart } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RenderResult = { text: string; format: PlatformCapabilities['format'] }

export interface OutboundText {
	parts: Part[]
	rendered: RenderResult
}

export interface PlatformAdapter<P extends Platform = Platform> {
	name: P
	capabilities: PlatformCapabilities
	/**
	 * 将"文本类 Part"渲染为平台格式文本。
	 *
	 * 约定：入参应当只包含文本类 Part（`text/mention/link/styled/codeblock`），媒体请由上层拆分为独立发送。
	 */
	render: (parts: Part[]) => RenderResult
	sendText: (session: PlatformRegistry[P]['raw'], text: OutboundText, options?: ReplyOptions) => Promise<void>
	sendImage?: (
		session: PlatformRegistry[P]['raw'],
		image: ImagePart,
		caption?: OutboundText,
		options?: ReplyOptions,
	) => Promise<void>
	sendAudio?: (session: PlatformRegistry[P]['raw'], audio: AudioPart, options?: ReplyOptions) => Promise<void>
	sendVideo?: (
		session: PlatformRegistry[P]['raw'],
		video: VideoPart,
		caption?: OutboundText,
		options?: ReplyOptions,
	) => Promise<void>
	sendFile?: (session: PlatformRegistry[P]['raw'], file: FilePart, options?: ReplyOptions) => Promise<void>
	uploadImage?: (session: PlatformRegistry[P]['raw'], image: ImagePart) => Promise<ImagePart>
	uploadFile?: (session: PlatformRegistry[P]['raw'], file: FilePart) => Promise<FilePart>
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

type AdapterMap = Map<Platform, PlatformAdapter<any>>

const REGISTRY: AdapterMap = new Map()

export const registerAdapter = <P extends Platform>(adapter: PlatformAdapter<P>): (() => void) => {
	REGISTRY.set(adapter.name, adapter as PlatformAdapter<any>)
	return () => REGISTRY.delete(adapter.name)
}

export const getAdapter = <P extends Platform>(platform: P): PlatformAdapter<P> => {
	const found = REGISTRY.get(platform)
	if (!found) throw new Error(`Adapter not registered for platform: ${platform}`)
	return found as PlatformAdapter<P>
}

export const listAdapters = (): PlatformAdapter[] => Array.from(REGISTRY.values())

export const getCapabilities = <P extends Platform>(platform: P): PlatformCapabilities =>
	getAdapter(platform).capabilities

export interface AdapterRegistry {
	register: typeof registerAdapter
	get: typeof getAdapter
	list: typeof listAdapters
}

export const createAdapterRegistry = (): AdapterRegistry => ({
	register: registerAdapter,
	get: getAdapter,
	list: listAdapters,
})

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience (原 platforms/base.ts 兼容导出)
// ─────────────────────────────────────────────────────────────────────────────

export { createReply } from '../outbound/reply'
export { createSendHelpers, createUploadHelpers } from '../outbound/send-helpers'
export {
	assertTextOnly,
	audioToText,
	fileToText,
	imageToText,
	isMediaPart,
	isTextLike,
	mediaToText,
	normalizePartsForAdapter,
	normalizeTextPartsForAdapter,
	videoToText,
	type TextLikePart,
} from '../render/normalize'
