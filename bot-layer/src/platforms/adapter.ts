import type { FilePart, ImagePart, Part, Platform, PlatformCapabilities, PlatformRegistry, ReplyOptions } from '../types'

export type RenderResult = { text: string; format: PlatformCapabilities['format'] }

export interface OutboundText {
	parts: Part[]
	rendered: RenderResult
}

export interface PlatformAdapter<P extends Platform = Platform> {
	name: P
	capabilities: PlatformCapabilities
	/**
	 * 将“文本类 Part”渲染为平台格式文本。
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
	sendFile?: (session: PlatformRegistry[P]['raw'], file: FilePart, options?: ReplyOptions) => Promise<void>
	uploadImage?: (session: PlatformRegistry[P]['raw'], image: ImagePart) => Promise<ImagePart>
	uploadFile?: (session: PlatformRegistry[P]['raw'], file: FilePart) => Promise<FilePart>
}

