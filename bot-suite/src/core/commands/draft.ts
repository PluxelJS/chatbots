import type { ExecCtx, Interceptor } from '@pluxel/cmd'
import type { AnyStdSchema, CmdBuilder, TextConfig, VSchema } from '@pluxel/cmd'

type Awaitable<T> = T | Promise<T>

type BuilderState = { hasHandle: boolean; hasText: boolean; hasMcp: boolean }
type HandledState<S extends BuilderState> = { hasHandle: true; hasText: S['hasText']; hasMcp: S['hasMcp'] }

const DRAFT_BUILT = Symbol.for('pluxel:chatbots:cmd-draft')

type InferOut<S extends AnyStdSchema> =
	NonNullable<S['~standard']['types']> extends { output: infer O } ? O : unknown

export type BuiltCommandDraft<Ctx extends ExecCtx, R> = {
	readonly [DRAFT_BUILT]: 'command'
	readonly apply: <S extends BuilderState>(
		b: CmdBuilder<any, any, S>,
	) => { builder: CmdBuilder<any, any, HandledState<S>>; text?: Omit<TextConfig, 'triggers' | 'tokenize'> }
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

export type CommandDraft<Ctx extends ExecCtx, SIn extends AnyStdSchema = VSchema> = {
	input<S extends AnyStdSchema>(schema: S): CommandDraft<Ctx, S>
	output<SOut extends AnyStdSchema>(schema: SOut): CommandDraft<Ctx, SIn>
	intercept<TState>(itc: Interceptor<TState>): CommandDraft<Ctx, SIn>

	/**
	 * Configure text argv parsing for this command.
	 *
	 * - `.argv()` keeps the default (type-flag; derive flags from input schema)
	 * - `.argv(map)` maps parsed argv into input candidate (positionals, custom flags, ...)
	 * - `.argv({ ... })` provides full argv config
	 */
	argv(): CommandDraft<Ctx, SIn>
	argv(map: NonNullable<TextConfig['map']>): CommandDraft<Ctx, SIn>
	argv(cfg: Omit<TextConfig, 'triggers' | 'tokenize'>): CommandDraft<Ctx, SIn>

	handle<R>(fn: (input: InferOut<SIn>, ctx: Ctx) => Awaitable<R>): BuiltCommandDraft<Ctx, R>
}

export type OpDraft<Ctx extends ExecCtx, SIn extends AnyStdSchema = VSchema> = {
	input<S extends AnyStdSchema>(schema: S): OpDraft<Ctx, S>
	output<SOut extends AnyStdSchema>(schema: SOut): OpDraft<Ctx, SIn>
	intercept<TState>(itc: Interceptor<TState>): OpDraft<Ctx, SIn>
	handle<R>(fn: (input: InferOut<SIn>, ctx: Ctx) => Awaitable<R>): BuiltOpDraft<Ctx, R>
}

function createCommandDraft<Ctx extends ExecCtx, SIn extends AnyStdSchema>(
	steps: readonly Step[],
	text: Omit<TextConfig, 'triggers' | 'tokenize'> | undefined,
): CommandDraft<Ctx, SIn> {
	const push = (step: Step, nextText?: Omit<TextConfig, 'triggers' | 'tokenize'> | undefined) =>
		createCommandDraft<Ctx, SIn>([...steps, step], nextText === undefined ? text : nextText)

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
		argv(arg?: any) {
			// `.argv()` is a semantic marker; default argv config is handled by cmdkit when `.text()` is applied.
			if (arguments.length === 0) return push((b) => b, text)
			if (typeof arg === 'function') return push((b) => b, { map: arg })
			return push((b) => b, arg)
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

function createOpDraft<Ctx extends ExecCtx, SIn extends AnyStdSchema>(steps: readonly Step[]): OpDraft<Ctx, SIn> {
	const push = (step: Step) => createOpDraft<Ctx, SIn>([...steps, step])

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

export function cmd<Ctx extends ExecCtx>(): CommandDraft<Ctx, VSchema> {
	return createCommandDraft<Ctx, any>([], undefined) as any
}

export function op<Ctx extends ExecCtx>(): OpDraft<Ctx, VSchema> {
	return createOpDraft<Ctx, any>([]) as any
}
