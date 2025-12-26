export type { OutboundText, PlatformAdapter, RenderResult } from './adapter'

export { createReply } from '../outbound/reply'
export { createSendHelpers, createUploadHelpers } from '../outbound/send-helpers'
export {
	assertTextOnly,
	fileToText,
	imageToText,
	isTextLike,
	normalizePartsForAdapter,
	normalizeTextPartsForAdapter,
	type TextLikePart,
} from '../render/normalize'

