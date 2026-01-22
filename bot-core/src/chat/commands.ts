import type { AnyMessage, Part, ReplyOptions, ReplyPayload } from '../types'
import type { ExecCtx, Router } from '../cmd'
import { CmdError, createRouter, isErr } from '../cmd'
import { normalizeReplyPayload } from '../outbound/payload'

type Awaitable<T> = T | Promise<T>

/**
 * Chat command helpers built on top of `createRouter`.
 *
 * - Parses `/cmd args` style input from `msg.textRaw` / `msg.text`
 * - Supports Telegram-style `/cmd@botname` stripping
 * - Distinguishes unknown commands via `CmdError(code=E_CMD_NOT_FOUND)`
 * - Allows explicitly passing through via `CHAT_COMMAND_PASS`
 */
export const CHAT_COMMAND_PASS = Symbol.for('pluxel:chat-command:pass')

export type ChatCommandResult =
	| ReplyPayload
	| Part
	| string
	| void
	| typeof CHAT_COMMAND_PASS

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
	/**
	 * Customize the execution ctx passed to command middlewares/handlers.
	 *
	 * Default: `{ msg, actorId, traceId, now }`.
	 */
	makeCtx?: (msg: AnyMessage) => ChatCommandCtx
	/** Customize error-to-reply mapping */
	formatError?: (err: CmdError, msg: AnyMessage) => Awaitable<ChatCommandResult>
}

export type ChatCommandCtx<M extends AnyMessage = AnyMessage> = ExecCtx & { msg: M }

export type ChatCommandRouter<M extends AnyMessage = AnyMessage> = Router

export const createChatCommandRouter = (opts?: { caseInsensitive?: boolean }): ChatCommandRouter =>
	createRouter({ caseInsensitive: opts?.caseInsensitive ?? true })

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

const toReplyPayload = (v: ChatCommandResult): ReplyPayload | null => {
	if (v === undefined || v === CHAT_COMMAND_PASS) return null
	return normalizeReplyPayload(v)
}

export type HandleChatCommandResult =
	| { handled: false; kind: 'not_command' | 'unknown_command'; parsed?: ParsedChatCommand }
	| { handled: false; kind: 'passed_through'; parsed: ParsedChatCommand }
	| { handled: true; kind: 'handled'; parsed: ParsedChatCommand; result?: ChatCommandResult }
	| { handled: true; kind: 'error'; parsed: ParsedChatCommand; error: CmdError }

export const handleChatCommand = async (
	msg: AnyMessage,
	router: ChatCommandRouter,
	opts?: HandleChatCommandOptions,
): Promise<HandleChatCommandResult> => {
	const autoReply = opts?.autoReply ?? true

	const parsed = parseChatCommandText(msg.textRaw ?? msg.text, opts)
	if (!parsed) return { handled: false, kind: 'not_command' }

	const defaultCtx: ChatCommandCtx = {
		msg,
		actorId: msg.user?.id !== undefined && msg.user?.id !== null ? String(msg.user.id) : undefined,
		traceId: msg.messageId !== null ? `${msg.platform}:${String(msg.messageId)}` : undefined,
		now: Date.now(),
	}
	const ctx = opts?.makeCtx ? opts.makeCtx(msg) : defaultCtx

	try {
		const dispatched = await router.dispatch(parsed.input, ctx)
		if (isErr(dispatched)) {
			const err = dispatched.err
			if (err instanceof CmdError && err.code === 'E_CMD_NOT_FOUND') {
				return { handled: false, kind: 'unknown_command', parsed }
			}
			if (autoReply) {
				const out = opts?.formatError ? await opts.formatError(err, msg) : err.publicMessage
				const payload = toReplyPayload(out)
				if (payload) await msg.reply(payload, opts?.replyOptions)
			}
			return { handled: true, kind: 'error', parsed, error: err }
		}

		const result = dispatched.val as ChatCommandResult
		if (result === CHAT_COMMAND_PASS) return { handled: false, kind: 'passed_through', parsed }

		if (autoReply) {
			const payload = toReplyPayload(result as ChatCommandResult)
			if (payload) await msg.reply(payload, opts?.replyOptions)
		}

		return { handled: true, kind: 'handled', parsed, result: result as ChatCommandResult }
	} catch (e) {
		const err =
			e instanceof CmdError
				? e
				: new CmdError('E_INTERNAL', 'Command failed', {
						message: (e as any)?.message ?? 'Command failed',
						cause: e,
					})
		if (autoReply) {
			const out = opts?.formatError ? await opts.formatError(err, msg) : err.publicMessage
			const payload = toReplyPayload(out)
			if (payload) await msg.reply(payload, opts?.replyOptions)
		}
		return { handled: true, kind: 'error', parsed, error: err }
	}
}
