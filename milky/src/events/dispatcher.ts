import type { Context } from '@pluxel/hmr'
import type { Event as MilkyEvent } from '@saltify/milky-types'
import type { MilkyChannel } from './index'
import type { MilkyBot } from '../bot'
import type { EventMeta, MilkyEventSession, MilkyMessageSession } from './events.types'

export function dispatchMilkyEvent(
	events: MilkyChannel,
	_ctx: Context,
	bot: MilkyBot,
	event: MilkyEvent,
	meta: EventMeta,
) {
	const base: MilkyEventSession = {
		bot,
		event,
		meta,
		selfId: Number(event.self_id),
	}

	events.event.emit(base)

	const typed = (events as any)[event.event_type]
	if (typed?.emit) typed.emit(base)

	if (event.event_type === 'message_receive') {
		const session: MilkyMessageSession = { ...base, message: event.data }
		events.message.emit(session)
		events.message_receive.emit(session)
	}
}

