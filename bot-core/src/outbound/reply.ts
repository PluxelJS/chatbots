import type { MessageContent, Platform, PlatformRegistry, ReplyOptions, ReplyPayload } from '../types'
import type { PlatformAdapter } from '../adapter'
import { isMessageBatch } from '../../parts'
import { createSendHelpers } from './send-helpers'
import { compileReply } from './compile'

export const createReply =
	<P extends Platform>(adapter: PlatformAdapter<P>, session: PlatformRegistry[P]['raw']) =>
	async (payload: ReplyPayload, options?: ReplyOptions) => {
		const helpers = createSendHelpers(adapter, session)
		const quoteFirst = Boolean(options?.quote)

		const sendOne = async (content: MessageContent, opts?: ReplyOptions) => {
			if (!content.length) return
			const actions = compileReply(adapter, content, { mode: opts?.mode })
			for (const op of actions) {
				switch (op.type) {
					case 'text':
						await helpers.sendText(op.parts, opts)
						break
					case 'file':
						await helpers.sendFile(op.file, opts)
						break
					case 'audio':
						await helpers.sendAudio(op.audio, opts)
						break
					case 'video':
						await helpers.sendVideo(op.video, op.captionParts, opts)
						break
					case 'image':
						await helpers.sendImage(op.image, op.captionParts, opts)
						break
				}
			}
		}

		if (!isMessageBatch(payload)) {
			await sendOne(payload, options)
			return
		}

		const atomic = payload.atomic ?? true
		const failures: Array<{ index: number; error: Error }> = []
		const messages = payload.messages as MessageContent[]

		for (let index = 0; index < messages.length; index++) {
			const content = messages[index] ?? []
			if (!content.length) continue

			const opts =
				index === 0 || !quoteFirst ? options : ({ ...(options ?? {}), quote: false } satisfies ReplyOptions)

			try {
				await sendOne(content, opts)
			} catch (e) {
				const error = e instanceof Error ? e : new Error(String(e))
				if (atomic) {
					const wrapped = new Error(`bot-core: reply(batch.messages[${index}]) failed: ${error.message}`)
					;(wrapped as any).cause = error
					throw wrapped
				}
				failures.push({ index, error })
			}
		}

		if (failures.length) {
			const summary = failures.map((f) => f.index).join(', ')
			const err = new Error(`bot-core: reply(batch) failed for message index(es): ${summary}`)
			;(err as any).failures = failures
			throw err
		}
	}
