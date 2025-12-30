import type { AnyMessage, MessageContent } from '../types'
import { CommandError, createCommandBus } from '../cmd'

export type ChatCommandResult = MessageContent | void

export type ChatCommandBus = ReturnType<typeof createCommandBus>

export type HandleChatCommandOptions = {
	/** Command prefix, default `/` */
	prefix?: string
	/** Strip `/cmd@botname` to `/cmd` (Telegram style), default true */
	stripAtSuffix?: boolean
	/** Auto reply when handler returns content, default true */
	autoReply?: boolean
}

export const createChatCommandBus = (opts?: { caseInsensitive?: boolean }): ChatCommandBus =>
	createCommandBus<AnyMessage>({ caseInsensitive: opts?.caseInsensitive ?? true })

export const handleChatCommand = async (
	msg: AnyMessage,
	bus: ChatCommandBus,
	opts?: HandleChatCommandOptions,
): Promise<{ handled: boolean; error?: CommandError; result?: ChatCommandResult }> => {
	const prefix = opts?.prefix ?? '/'
	const stripAtSuffix = opts?.stripAtSuffix ?? true
	const autoReply = opts?.autoReply ?? true

	const raw = (msg.textRaw ?? msg.text ?? '').trim()
	if (!raw || !raw.startsWith(prefix)) return { handled: false }

	// "/cmd@botname args" -> "cmd args"
	let input = raw.slice(prefix.length).trim()
	if (!input) return { handled: false }

	if (stripAtSuffix) {
		const firstSpace = input.indexOf(' ')
		const head = firstSpace === -1 ? input : input.slice(0, firstSpace)
		const rest = firstSpace === -1 ? '' : input.slice(firstSpace)
		const at = head.indexOf('@')
		input = (at === -1 ? head : head.slice(0, at)) + rest
	}

	try {
		const result = (await bus.dispatch(input, msg)) as ChatCommandResult | undefined
		if (result === undefined) return { handled: false }
		if (autoReply && result) await msg.reply(result)
		return { handled: true, result }
	} catch (e) {
		const err = e instanceof CommandError ? e : new CommandError((e as any)?.message ?? 'Command failed')
		if (autoReply) {
			await msg.reply(String(err.message))
		}
		return { handled: true, error: err }
	}
}
