import type { Flags, TypeFlag, TypeFlagOptions } from 'type-flag'
import {
	type Awaitable,
	type Command,
	type CommandSpec,
	defineCommand,
	type ExtractCommandParams,
} from './index'

export type CmdNext<C, R = unknown> = (argv: any, ctx: C) => Awaitable<R>
export type CmdMiddleware<C, R = unknown> = (next: CmdNext<C, R>) => CmdNext<C, R>

export interface CommandBuilder<P extends string, F extends Flags, C, R = unknown> {
	/** Original pattern passed to `reg()` (stable; can be used to derive a command key). */
	readonly pattern: P
	alias(...names: string[]): this
	usage(text: string): this
	describe(text: string): this
	/** Attach custom metadata (for help UI, permissions, rate limiting, etc). */
	meta(patch: Partial<CommandMeta>): this
	use(mw: CmdMiddleware<C, R>): this
	action(handler: (argv: TypeFlag<F> & ExtractCommandParams<P>, ctx: C) => Awaitable<R>): Command<P, F, C, R>
}

export interface CommandKit<C> {
	reg<P extends string, F extends Flags = {}, R = unknown>(
		pattern: P,
		flags?: F,
		flagOptions?: TypeFlagOptions,
	): CommandBuilder<P, F, C, R>
	group(name: string, def: (kit: CommandKit<C>) => void): void
	list(): ReadonlyArray<Command<any, any, C, any>>
	help(group?: string): string
}

export type CommandBuilderExt<C> = <P extends string, F extends Flags, R = unknown>(
	builder: CommandBuilder<P, F, C, R>,
) => CommandBuilder<P, F, C, R>

/** Module-augment this interface to add custom command metadata fields. */
export interface CommandMetaExt {}

export type CommandMeta = { desc?: string; group?: string } & CommandMetaExt

const COMMAND_META = Symbol.for('pluxel:cmd:meta')
const LEGACY_COMMAND_META = Symbol.for('chatbots:command:meta')

export const getCommandMeta = <C>(cmd: Command<any, any, C, any>): CommandMeta | undefined =>
	(cmd as any)[COMMAND_META] ?? (cmd as any)[LEGACY_COMMAND_META]

export const updateCommandMeta = <C>(cmd: Command<any, any, C, any>, patch: Partial<CommandMeta>): CommandMeta => {
	const prev = (((cmd as any)[COMMAND_META] ?? (cmd as any)[LEGACY_COMMAND_META]) ?? {}) as CommandMeta
	const next = { ...prev, ...patch } as CommandMeta
	;(cmd as any)[COMMAND_META] = next
	;(cmd as any)[LEGACY_COMMAND_META] = next
	return next
}

export interface CommandKitPlugin<C> {
	extendBuilder?: CommandBuilderExt<C>
	onRegister?: (cmd: Command<any, any, C, any>) => void
}

export function createCommandKit<C>(
	bus: {
		register: (cmd: Command<any, any, C, any>) => any
		list: () => Command<any, any, C, any>[]
	},
	opts?: {
		plugins?: CommandKitPlugin<C>[]
		/** Prefer `plugins` for new code; kept for compatibility. */
		extendBuilder?: CommandBuilderExt<C>
		/** Prefer plugin `onRegister`; kept for compatibility. */
		onRegister?: (cmd: Command<any, any, C, any>) => void
	},
): CommandKit<C> {
	type AnyCmd = Command<any, any, C, any>

	const groupStack: string[] = []

	const setMeta = (cmd: AnyCmd, next: CommandMeta) => updateCommandMeta(cmd, next)
	const readMeta = (cmd: AnyCmd): CommandMeta => getCommandMeta(cmd) ?? {}

	type LocalMeta<R> = { meta: CommandMeta; mws: CmdMiddleware<C, R>[] }
	type Chain<R = unknown> = (argv: any, ctx: C) => Awaitable<R>

	const composeChain = <R>(middlewares: CmdMiddleware<C, R>[], origin: Chain<R>): Chain<R> => {
		if (middlewares.length === 0) return origin
		let next = origin
		for (let i = middlewares.length - 1; i >= 0; i--) {
			next = middlewares[i]!(next)
		}
		return next
	}

	const wrap = <P extends string, F extends Flags, R>(
		full: CommandSpec<P, F, C, R>,
		local: LocalMeta<R>,
	): Command<P, F, C, R> => {
		const origin = full.action
		const chain = composeChain(local.mws, (argv, ctx) => origin(argv as any, ctx))
		const cmd = defineCommand<P, F, C, R>({
			...full,
			action: chain as CommandSpec<P, F, C, R>['action'],
		})
		setMeta(cmd, local.meta)
		bus.register(cmd)
		for (const p of opts?.plugins ?? []) p.onRegister?.(cmd)
		opts?.onRegister?.(cmd)
		return cmd
	}

	const applyBuilderPlugins = <P extends string, F extends Flags, R>(
		builder: CommandBuilder<P, F, C, R>,
	): CommandBuilder<P, F, C, R> => {
		let cur = builder
		for (const p of opts?.plugins ?? []) {
			if (p.extendBuilder) cur = p.extendBuilder(cur)
		}
		return opts?.extendBuilder ? opts.extendBuilder(cur) : cur
	}

	const kit: CommandKit<C> = {
		reg<P extends string, F extends Flags = {}, R = unknown>(pattern: P, flags?: F, flagOptions?: TypeFlagOptions) {
			const group = groupStack[groupStack.length - 1]

			const base = {
				pattern,
				flags: (flags ?? ({} as F)) as F,
				flagOptions,
				aliases: [] as string[],
			} satisfies Omit<CommandSpec<P, F, C, R>, 'action' | 'usage'>

			let usageText: string | undefined
			const local: LocalMeta<R> = { meta: { group }, mws: [] }

			const builder: CommandBuilder<P, F, C, R> = {
				pattern,
				alias(...names) {
					base.aliases.push(...names)
					return this
				},
				usage(text) {
					usageText = text
					return this
				},
				describe(text) {
					local.meta.desc = text
					return this
				},
				meta(patch) {
					Object.assign(local.meta as any, patch)
					return this
				},
				use(mw) {
					local.mws.push(mw)
					return this
				},
				action(handler) {
					const full: CommandSpec<P, F, C, R> = {
						...base,
						...(usageText ? { usage: usageText } : {}),
						action: handler,
					}
					return wrap(full, local)
				},
			}
			return applyBuilderPlugins(builder)
		},

		group(name, def) {
			groupStack.push(name)
			try {
				def(kit)
			} finally {
				groupStack.pop()
			}
		},

		list() {
			return bus.list()
		},

		help(group) {
			const normalizedGroup = group?.trim()
			const lines: string[] = []
			const buckets = new Map<string | undefined, AnyCmd[]>()
			for (const c of bus.list()) {
				const m = readMeta(c)
				const g = m.group
				if (normalizedGroup && g !== normalizedGroup) continue
				let bucket = buckets.get(g)
				if (!bucket) {
					bucket = []
					buckets.set(g, bucket)
				}
				bucket.push(c)
			}
			for (const [groupName, cmds] of buckets) {
				if (cmds.length === 0) continue
				if (groupName) {
					if (lines.length) lines.push('')
					lines.push(`# ${groupName}`)
				}
				for (const c of cmds) {
					const m = readMeta(c)
					lines.push(`- ${c.toUsage()}${m.desc ? ` — ${m.desc}` : ''}`)
				}
			}
			return lines.join('\n')
		},
	}

	return kit
}
