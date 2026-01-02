import type {
	AdapterPolicy,
	AudioPart,
	FilePart,
	ImagePart,
	MediaPart,
	Part,
	Platform,
	PlatformRegistry,
	ReplyOptions,
	VideoPart,
} from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RenderResult = { text: string; format: AdapterPolicy['text']['format'] }

export interface OutboundText {
	parts: Part[]
	rendered: RenderResult
}

export type OutboundOp =
	| { type: 'text'; text: OutboundText }
	| { type: 'image'; image: ImagePart; caption?: OutboundText }
	| { type: 'audio'; audio: AudioPart }
	| { type: 'video'; video: VideoPart; caption?: OutboundText }
	| { type: 'file'; file: FilePart }

export interface PlatformAdapter<P extends Platform = Platform, Policy extends AdapterPolicy = AdapterPolicy> {
	name: P
	policy: Policy
	/**
	 * 将"文本类 Part"渲染为平台格式文本。
	 *
	 * 约定：入参应当只包含文本类 Part（`text/mention/link/styled/codeblock`），媒体请由上层拆分为独立发送。
	 */
	render: (parts: Part[]) => RenderResult

	/**
	 * 将媒体转换为“可发送引用”（典型场景：平台需要先上传得到 url/fileId）。
	 * 约定：仅在 `media.data` 存在时才会被 outbound 层调用。
	 */
	uploadMedia?: (session: PlatformRegistry[P]['raw'], media: MediaPart) => Promise<MediaPart>

	/**
	 * 发送一个“原子操作”（Outbound 层会完成 normalize/降级/拆分/上传）。
	 */
	send: (session: PlatformRegistry[P]['raw'], op: OutboundOp, options?: ReplyOptions) => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

type AdapterMap = Map<Platform, PlatformAdapter<any>>

const REGISTRY: AdapterMap = new Map()

const assertValidAdapter = (adapter: PlatformAdapter<any>) => {
	if (!adapter.policy.outbound.supportedOps.includes('text')) {
		throw new Error(`Adapter ${adapter.name}: policy.outbound.supportedOps 必须包含 'text'`)
	}
}

export const registerAdapter = <P extends Platform>(adapter: PlatformAdapter<P>): (() => void) => {
	assertValidAdapter(adapter as PlatformAdapter<any>)
	REGISTRY.set(adapter.name, adapter as PlatformAdapter<any>)
	return () => REGISTRY.delete(adapter.name)
}

export const defineAdapter = <P extends Platform, Policy extends AdapterPolicy>(
	adapter: PlatformAdapter<P, Policy>,
): PlatformAdapter<P, Policy> => {
	assertValidAdapter(adapter as unknown as PlatformAdapter<any>)
	return adapter
}

export const getAdapter = <P extends Platform>(platform: P): PlatformAdapter<P> => {
	const found = REGISTRY.get(platform)
	if (!found) throw new Error(`Adapter not registered for platform: ${platform}`)
	return found as PlatformAdapter<P>
}

export const listAdapters = (): PlatformAdapter[] => Array.from(REGISTRY.values())

export const getPolicy = <P extends Platform>(platform: P): AdapterPolicy => getAdapter(platform).policy

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
// Re-exports for convenience
// ─────────────────────────────────────────────────────────────────────────────

export { createReply } from '../outbound/reply'
export { createSendHelpers } from '../outbound/send-helpers'
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
