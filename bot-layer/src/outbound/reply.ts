import type { MessageContent, Platform, PlatformRegistry, ReplyOptions } from '../types'
import type { PlatformAdapter } from '../adapter'
import { createSendHelpers } from './send-helpers'
import { compileReply } from './compile'

export const createReply =
	<P extends Platform>(adapter: PlatformAdapter<P>, session: PlatformRegistry[P]['raw']) =>
	async (content: MessageContent, options?: ReplyOptions) => {
		if (!content.length) return

		const helpers = createSendHelpers(adapter, session)
		const actions = compileReply(adapter, content, { mode: options?.mode })

		for (const op of actions) {
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
				case 'video':
					await helpers.sendVideo(op.video, op.captionParts, options)
					break
				case 'image':
					await helpers.sendImage(op.image, op.captionParts, options)
					break
			}
		}
	}
