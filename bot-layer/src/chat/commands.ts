import type { AnyMessage, MessageContent, Part, ReplyOptions } from '../types'
import type { Awaitable, CommandBus } from '../cmd'
import { CommandError, createCommandBus } from '../cmd'

/**
 * Chat command helpers built on top of `createCommandBus`.
 *
 * - Parses `/cmd args` style input from `msg.textRaw` / `msg.text`
 * - Supports Telegram-style `/cmd@botname` stripping
 * - Supports "void result but still handled" via `dispatchDetailed` (no ambiguity with unknown commands)
 * - Allows explicitly passing through via `CHAT_COMMAND_PASS`
 */
export const CHAT_COMMAND_PASS = Symbol.for('pluxel:chat-command:pass')

export type ChatCommandResult = MessageContent | Part | string | void | typeof CHAT_COMMAND_PASS

export type ChatCommandBus = CommandBus<AnyMessage>

export type ParsedChatCommand = {
	/** Original message text (trimmed) */
	raw: string
	/** Matched prefix */
	prefix: string
	/** Normalized input passed to command bus (no prefix, optional `@bot` stripped) */
	input: string
	/** Command name (first token, after optional `@bot` stripping) */
	command: string
	/** Remainder text after the command name (trimmed) */
	argsText: string
}

export type HandleChatCommandOptions = {
	/** Command prefix, default `/` */
	prefix?: string
	/** Strip `/cmd@botname` to `/cmd` (Telegram style), default true */
	stripAtSuffix?: boolean
	/** Auto reply when handler returns content, default true */
	autoReply?: boolean
	/** Forwarded to `msg.reply(...)` when auto replying */
	replyOptions?: ReplyOptions
	/** Customize error-to-reply mapping */
	formatError?: (err: CommandError, msg: AnyMessage) => Awaitable<ChatCommandResult>
}

export const createChatCommandBus = (opts?: { caseInsensitive?: boolean }): ChatCommandBus =>
	createCommandBus<AnyMessage>({ caseInsensitive: opts?.caseInsensitive ?? true })

export const parseChatCommandText = (
	text: string | null | undefined,
	opts?: Pick<HandleChatCommandOptions, 'prefix' | 'stripAtSuffix'>,
): ParsedChatCommand | null => {
	const prefix = opts?.prefix ?? '/'
	const stripAtSuffix = opts?.stripAtSuffix ?? true

	const raw = String(text ?? '').trim()
	if (!raw.startsWith(prefix)) return null

	const afterPrefix = raw.slice(prefix.length).trim()
	if (!afterPrefix) return null

	const firstWs = afterPrefix.search(/\s/)
	const head = firstWs === -1 ? afterPrefix : afterPrefix.slice(0, firstWs)
	const rest = firstWs === -1 ? '' : afterPrefix.slice(firstWs)

	const at = stripAtSuffix ? head.indexOf('@') : -1
	const command = (at === -1 ? head : head.slice(0, at)).trim()
	if (!command) return null

	const input = command + rest
	return { raw, prefix, input, command, argsText: rest.trim() }
}

const isMessageContent = (v: unknown): v is MessageContent =>
	Array.isArray(v) &&
	v.every((p) => p != null && typeof p === 'object' && typeof (p as any).type === 'string')

const toMessageContent = (v: ChatCommandResult): MessageContent | null => {
	if (v === undefined || v === CHAT_COMMAND_PASS) return null
	if (typeof v === 'string') return v ? [{ type: 'text', text: v }] : []
	if (isMessageContent(v)) return v
	if (v && typeof v === 'object' && typeof (v as any).type === 'string') return [v as Part]
	return null
}

export type HandleChatCommandResult =
	| { handled: false; kind: 'not_command' | 'unknown_command'; parsed?: ParsedChatCommand }
	| { handled: false; kind: 'passed_through'; parsed: ParsedChatCommand }
	| { handled: true; kind: 'handled'; parsed: ParsedChatCommand; result?: ChatCommandResult }
	| { handled: true; kind: 'error'; parsed: ParsedChatCommand; error: CommandError }

export const handleChatCommand = async (
	msg: AnyMessage,
	bus: ChatCommandBus,
	opts?: HandleChatCommandOptions,
): Promise<HandleChatCommandResult> => {
	const autoReply = opts?.autoReply ?? true

	const parsed = parseChatCommandText(msg.textRaw ?? msg.text, opts)
	if (!parsed) return { handled: false, kind: 'not_command' }

	try {
		const dispatched = await bus.dispatchDetailed(parsed.input, msg)
		if (!dispatched.matched) return { handled: false, kind: 'unknown_command', parsed }

		const result = dispatched.result as ChatCommandResult
		if (result === CHAT_COMMAND_PASS) return { handled: false, kind: 'passed_through', parsed }

			if (autoReply) {
				const content = toMessageContent(result)
				if (content?.length) await msg.reply(content, opts?.replyOptions)
			}

		return { handled: true, kind: 'handled', parsed, result }
	} catch (e) {
		const err = e instanceof CommandError ? e : new CommandError((e as any)?.message ?? 'Command failed')
			if (autoReply) {
				const out = opts?.formatError ? await opts.formatError(err, msg) : String(err.message)
				const content = toMessageContent(out)
				if (content?.length) await msg.reply(content, opts?.replyOptions)
			}
		return { handled: true, kind: 'error', parsed, error: err }
	}
}
