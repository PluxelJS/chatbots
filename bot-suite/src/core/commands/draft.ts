import { defaultTokenizer, textTail } from '@pluxel/cmd'
import type { ExecCtx, Infer, Interceptor, Schema } from '@pluxel/cmd'
import type { CmdBuilder, TextConfig } from '@pluxel/cmd'
import { Runtime } from '@sinclair/parsebox'

type Awaitable<T> = T | Promise<T>

type BuilderState = { hasHandle: boolean; hasText: boolean; hasMcp: boolean }
type HandledState<S extends BuilderState> = { hasHandle: true; hasText: S['hasText']; hasMcp: S['hasMcp'] }

const DRAFT_BUILT = Symbol.for('pluxel:chatbots:cmd-draft')

export type BuiltCommandDraft<Ctx extends ExecCtx, R> = {
	readonly [DRAFT_BUILT]: 'command'
	readonly apply: <S extends BuilderState>(
		b: CmdBuilder<any, any, S>,
	) => { builder: CmdBuilder<any, any, HandledState<S>>; text?: Omit<TextConfig, 'triggers'> }
}

export type BuiltOpDraft<Ctx extends ExecCtx, R> = {
	readonly [DRAFT_BUILT]: 'op'
	readonly apply: <S extends BuilderState>(b: CmdBuilder<any, any, S>) => { builder: CmdBuilder<any, any, HandledState<S>> }
}

export type BuiltDraft<Ctx extends ExecCtx = ExecCtx, R = unknown> =
	| BuiltCommandDraft<Ctx, R>
	| BuiltOpDraft<Ctx, R>

export function isBuiltDraft<Ctx extends ExecCtx = ExecCtx>(value: unknown): value is BuiltDraft<Ctx, unknown> {
	return !!value && typeof value === 'object' && (value as any)[DRAFT_BUILT] !== undefined
}

export function isBuiltCommandDraft<Ctx extends ExecCtx = ExecCtx>(value: unknown): value is BuiltCommandDraft<Ctx, unknown> {
	return isBuiltDraft<Ctx>(value) && (value as any)[DRAFT_BUILT] === 'command'
}

export function isBuiltOpDraft<Ctx extends ExecCtx = ExecCtx>(value: unknown): value is BuiltOpDraft<Ctx, unknown> {
	return isBuiltDraft<Ctx>(value) && (value as any)[DRAFT_BUILT] === 'op'
}

type Step = (b: any) => any

const argsTail = (map: (args: string[]) => Record<string, unknown>) =>
	textTail(
		new Runtime.Module({
			Main: Runtime.Until(['\n'], (s) => {
				const raw = String(s ?? '').trim()
				const tokens = raw ? defaultTokenizer(raw) : []
				const args = tokens.map((t) => t.value)
				const patch = map(args)
				if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {}
				const out: Record<string, unknown> = {}
				for (const [k, v] of Object.entries(patch)) {
					if (v === undefined) continue
					out[k] = v
				}
				return out
			}),
		}),
		'Main',
	)

export type CommandDraft<Ctx extends ExecCtx, I = unknown> = {
	input<S extends Schema>(schema: S): CommandDraft<Ctx, Infer<S>>
	output<SOut extends Schema>(schema: SOut): CommandDraft<Ctx, I>
	intercept<TState>(itc: Interceptor<TState>): CommandDraft<Ctx, I>

	/** Configure cmd text execution (tail DSL only; triggers are provided by `kit.command(...)`). */
	text(cfg?: Omit<TextConfig, 'triggers'>): CommandDraft<Ctx, I>

	/**
	 * Convenience for positional args mapping.
	 *
	 * This compiles to `text({ tail })` and maps the tail string into a validated object input.
	 */
	args(map: (args: string[]) => Record<string, unknown>): CommandDraft<Ctx, I>

	handle<R>(fn: (input: I, ctx: Ctx) => Awaitable<R>): BuiltCommandDraft<Ctx, R>
}

export type OpDraft<Ctx extends ExecCtx, I = unknown> = {
	input<S extends Schema>(schema: S): OpDraft<Ctx, Infer<S>>
	output<SOut extends Schema>(schema: SOut): OpDraft<Ctx, I>
	intercept<TState>(itc: Interceptor<TState>): OpDraft<Ctx, I>
	handle<R>(fn: (input: I, ctx: Ctx) => Awaitable<R>): BuiltOpDraft<Ctx, R>
}

function createCommandDraft<Ctx extends ExecCtx, I>(
	steps: readonly Step[],
	text: Omit<TextConfig, 'triggers'> | undefined,
): CommandDraft<Ctx, I> {
	const push = (step: Step, nextText?: Omit<TextConfig, 'triggers'> | undefined) =>
		createCommandDraft<Ctx, I>([...steps, step], nextText === undefined ? text : nextText)

	return {
		input(schema: any) {
			return createCommandDraft<Ctx, any>([...steps, (b) => b.input(schema)], text)
		},
		output(schema: any) {
			return push((b) => b.output(schema))
		},
		intercept(itc: any) {
			return push((b) => b.intercept(itc))
		},
		text(cfg?: any) {
			return push((b) => b, cfg === undefined ? text : cfg)
		},
		args(map: any) {
			return push((b) => b, { tail: argsTail(map) })
		},
		handle(fn) {
			const snapSteps = [...steps]
			const snapText = text
			return {
				[DRAFT_BUILT]: 'command' as const,
				apply(b) {
					let cur: any = b
					for (const step of snapSteps) cur = step(cur)
					cur = cur.handle(fn as any)
					return { builder: cur, ...(snapText ? { text: snapText } : {}) }
				},
			}
		},
	}
}

function createOpDraft<Ctx extends ExecCtx, I>(steps: readonly Step[]): OpDraft<Ctx, I> {
	const push = (step: Step) => createOpDraft<Ctx, I>([...steps, step])

	return {
		input(schema: any) {
			return createOpDraft<Ctx, any>([...steps, (b) => b.input(schema)])
		},
		output(schema: any) {
			return push((b) => b.output(schema))
		},
		intercept(itc: any) {
			return push((b) => b.intercept(itc))
		},
		handle(fn) {
			const snapSteps = [...steps]
			return {
				[DRAFT_BUILT]: 'op' as const,
				apply(b) {
					let cur: any = b
					for (const step of snapSteps) cur = step(cur)
					cur = cur.handle(fn as any)
					return { builder: cur }
				},
			}
		},
	}
}

export function cmd<Ctx extends ExecCtx>(): CommandDraft<Ctx, unknown> {
	return createCommandDraft<Ctx, any>([], undefined) as any
}

export function op<Ctx extends ExecCtx>(): OpDraft<Ctx, unknown> {
	return createOpDraft<Ctx, any>([]) as any
}
