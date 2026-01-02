import type { Flags, TypeFlag, TypeFlagOptions } from 'type-flag'
import { typeFlag } from 'type-flag'

/* ──────────────────────────────────────────────────────────────
 * 类型层：从 pattern 推断参数类型
 * 支持：<req>  [opt]  以及  [...rest]（至多一个）
 * ---------------------------------------------------------------- */

type Trim<S extends string> = S extends ` ${infer A}`
	? Trim<A>
	: S extends `${infer A} `
		? Trim<A>
		: S

type ParseRequired<S extends string> = S extends `${infer B}<${infer P}>${infer A}`
	? Record<Trim<P>, string> & ParseRequired<`${B}${A}`>
	: {}

type ParseOptional<S extends string> =
	S extends `${infer B}[...${string}]${infer A}`
		? ParseOptional<`${B}${A}`>
		: S extends `${infer B}[${infer P}]${infer A}`
			? Partial<Record<Trim<P>, string>> & ParseOptional<`${B}${A}`>
			: {}

type ParseRest<S extends string> = S extends `${infer _B}[...${infer R}]${infer _A}`
	? { [K in Trim<R>]?: string[] }
	: {}

export type ExtractCommandParams<P extends string> = ParseRequired<P> & ParseOptional<P> & ParseRest<P>

/* ──────────────────────────────────────────────────────────────
 * 运行时结构
 * ---------------------------------------------------------------- */

export type Awaitable<T> = T | Promise<T>

export interface CommandSpec<P extends string, F extends Flags, C = unknown, R = unknown> {
	pattern: P
	flags: F
	flagOptions?: TypeFlagOptions
	usage?: string
	aliases?: string[]
	action: (argv: TypeFlag<F> & ExtractCommandParams<P>, ctx: C) => Awaitable<R>
}

export interface Command<P extends string, F extends Flags, C = unknown, R = unknown> {
	readonly nameTokens: readonly string[]
	toUsage(): string
	runTokens(tokens: string[], ctx: C): Promise<R>
	run(input: string, ctx: C): Promise<R>
	readonly pattern: P
	readonly aliases: readonly string[]
}

/* ──────────────────────────────────────────────────────────────
 * 分词器：支持简单引号/转义
 * ---------------------------------------------------------------- */
export function parseArgsStringToArgv(input: string): string[] {
	const out: string[] = []
	let cur = ''
	let i = 0
	let quote: '"' | "'" | null = null
	while (i < input.length) {
		const ch = input[i++]
		if (quote) {
			if (ch === '\\') {
				if (i < input.length) cur += input[i++]
				continue
			}
			if (ch === quote) {
				quote = null
				continue
			}
			cur += ch
		} else {
			if (ch === '"' || ch === "'") {
				quote = ch
				continue
			}
			if (/\s/.test(ch)) {
				if (cur) {
					out.push(cur)
					cur = ''
				}
				continue
			}
			if (ch === '\\') {
				if (i < input.length) cur += input[i++]
				continue
			}
			cur += ch
		}
	}
	if (cur) out.push(cur)
	return out
}

/* ──────────────────────────────────────────────────────────────
 * 编译 pattern：nameTokens / required[] / optional[] / restKey?
 * ---------------------------------------------------------------- */

interface CompiledPattern {
	nameTokens: string[]
	required: string[]
	optional: string[]
	restKey?: string
	usage: string
}

function compilePattern(pattern: string): CompiledPattern {
	const parts = pattern.trim().split(/\s+/)
	const nameTokens: string[] = []
	let i = 0
	for (; i < parts.length; i++) {
		const p = parts[i]
		if (p.startsWith('<') || p.startsWith('[')) break
		nameTokens.push(p)
	}

	const required: string[] = []
	const optional: string[] = []
	let restKey: string | undefined

	for (; i < parts.length; i++) {
		const p = parts[i]
		if (p.startsWith('<') && p.endsWith('>')) {
			required.push(p.slice(1, -1).trim())
		} else if (p.startsWith('[') && p.endsWith(']')) {
			const inner = p.slice(1, -1).trim()
			if (inner.startsWith('...')) {
				if (restKey) throw new Error(`Duplicate rest in pattern: ${pattern}`)
				restKey = inner.slice(3).trim()
				if (!restKey) throw new Error(`Empty rest name in pattern: ${pattern}`)
			} else {
				optional.push(inner)
			}
		} else {
			throw new Error(`Invalid token in pattern "${pattern}": ${p}`)
		}
	}

	const usage = `${nameTokens.join(' ')}${required.map((k) => ` <${k}>`).join('')}${optional.map((k) => ` [${k}]`).join('')}${restKey ? ` [...${restKey}]` : ''}`

	return { nameTokens, required, optional, restKey, usage }
}

/* ──────────────────────────────────────────────────────────────
 * defineCommand：把 Spec 编译成可执行命令
 * ---------------------------------------------------------------- */

export function defineCommand<P extends string, F extends Flags, C = unknown, R = unknown>(
	spec: CommandSpec<P, F, C, R>,
): Command<P, F, C, R> {
	const cp = compilePattern(spec.pattern)

	const aliases = Object.freeze(
		Array.from(new Set((spec.aliases ?? []).map((s) => s.trim()).filter(Boolean))),
	)
	for (const a of aliases) {
		if (/[<>[\]]/.test(a)) {
			throw new Error(`Alias should not contain parameters: "${a}"`)
		}
	}

	const usage = spec.usage ?? cp.usage
	const toUsage = () => usage

	const runCore = async (tokens: string[], ctx: C) => {
		const argv = typeFlag(spec.flags as any, tokens, spec.flagOptions)

		const pos = (argv._ as string[]) ?? []
		if (pos.length < cp.required.length) {
			throw new CommandError(`Expected ${cp.required.length} args, got ${pos.length}. Usage: ${usage}`)
		}

		const params: Record<string, any> = Object.create(null)
		let k = 0

		for (let i = 0; i < cp.required.length; i++) params[cp.required[i]] = pos[k++]

		for (let i = 0; i < cp.optional.length; i++) {
			const v = pos[k]
			if (v !== undefined) {
				params[cp.optional[i]] = v
				k++
			}
		}

		if (cp.restKey) {
			params[cp.restKey] = pos.slice(k)
			k = pos.length
		} else if (k < pos.length) {
			throw new CommandError(`Too many positional args. Usage: ${usage}`)
		}

		const merged = Object.assign(Object.create(null), argv, params) as TypeFlag<F> & ExtractCommandParams<P>
		return spec.action(merged, ctx)
	}

	return {
		nameTokens: cp.nameTokens,
		pattern: spec.pattern,
		aliases,
		toUsage,
		runTokens(tokens, ctx) {
			return runCore(tokens, ctx)
		},
		run(input, ctx) {
			return runCore(parseArgsStringToArgv(input), ctx)
		},
	}
}

/* ──────────────────────────────────────────────────────────────
 * Router（Command Bus）：单词快表 + Trie 最长匹配
 * ---------------------------------------------------------------- */

export class CommandError extends Error {
	constructor(msg: string) {
		super(msg)
		this.name = 'CommandError'
	}
}

export function createCommandBus<C = unknown>(opts?: { prefix?: string; caseInsensitive?: boolean }) {
	type AnyCmd = Command<any, any, C, any>
	const norm = (s: string) => (opts?.caseInsensitive ? s.toLowerCase() : s)

	const byHead = new Map<string, AnyCmd>()
	const all = new Set<AnyCmd>()

	type Node = { cmd?: AnyCmd; next: Map<string, Node> }
	const root: Node = { next: new Map() }

	const put = (tokens: readonly string[], cmd: AnyCmd) => {
		let cur = root
		for (const raw of tokens) {
			const t = norm(raw)
			let n = cur.next.get(t)
			if (!n) cur.next.set(t, (n = { next: new Map() }))
			cur = n
		}
		cur.cmd = cmd
	}

	const getNode = (tokens: readonly string[]): Node | null => {
		let cur = root
		for (const raw of tokens) {
			const t = norm(raw)
			const n = cur.next.get(t)
			if (!n) return null
			cur = n
		}
		return cur
	}

	const remove = (tokens: readonly string[], cmd: AnyCmd) => {
		const stack: Array<{ node: Node; key: string }> = []
		let cur = root
		for (const raw of tokens) {
			const t = norm(raw)
			const n = cur.next.get(t)
			if (!n) return
			stack.push({ node: cur, key: t })
			cur = n
		}
		if (cur.cmd !== cmd) return
		delete cur.cmd
		for (let i = stack.length - 1; i >= 0; i--) {
			const { node, key } = stack[i]!
			const child = node.next.get(key)
			if (!child) break
			if (child.cmd || child.next.size) break
			node.next.delete(key)
		}
	}

	const rebuildByHead = () => {
		byHead.clear()
		for (const cmd of all) {
			if (cmd.nameTokens.length === 1) byHead.set(norm(cmd.nameTokens[0]), cmd)
			for (const a of cmd.aliases) {
				const toks = a.split(/\s+/)
				if (toks.length === 1) byHead.set(norm(toks[0]), cmd)
			}
		}
	}

	const assertNoConflict = (tokens: readonly string[], cmd: AnyCmd) => {
		const node = getNode(tokens)
		if (node?.cmd && node.cmd !== cmd) {
			throw new Error(
				`Command name conflict: "${tokens.join(' ')}" already registered by pattern "${node.cmd.pattern}"`,
			)
		}
	}

	const find = (tokens: string[]) => {
		let cur = root
		let last: AnyCmd | undefined
		let consumed = 0
		for (let i = 0; i < tokens.length; i++) {
			const t = norm(tokens[i])
			const n = cur.next.get(t)
			if (!n) break
			cur = n
			consumed = i + 1
			if (cur.cmd) last = cur.cmd
		}
		return last ? { cmd: last, consumed } : undefined
	}

	return {
		register<CMD extends AnyCmd>(cmd: CMD) {
			all.add(cmd)
			if (cmd.nameTokens.length === 0) throw new Error(`Empty command name in pattern "${cmd.pattern}"`)
			assertNoConflict(cmd.nameTokens, cmd)
			if (cmd.nameTokens.length === 1) byHead.set(norm(cmd.nameTokens[0]), cmd)
			put(cmd.nameTokens, cmd)
			for (const a of cmd.aliases) {
				const toks = a.split(/\s+/)
				if (toks.join(' ') !== cmd.nameTokens.join(' ')) {
					assertNoConflict(toks, cmd)
				}
				if (toks.length === 1) byHead.set(norm(toks[0]), cmd)
				put(toks, cmd)
			}
			return this
		},

		unregister(cmd: AnyCmd) {
			all.delete(cmd)
			remove(cmd.nameTokens, cmd)
			for (const a of cmd.aliases) {
				remove(a.split(/\s+/), cmd)
			}
			rebuildByHead()
		},

		list(): AnyCmd[] {
			return Array.from(all)
		},

		async dispatch(input: string, ctx: C): Promise<any> {
			const tokens = parseArgsStringToArgv(input)
			if (!tokens.length) throw new CommandError('Empty input')

			if (opts?.prefix) {
				const p = opts.prefix
				if (tokens[0]?.startsWith(p)) {
					tokens[0] = tokens[0].slice(p.length)
					if (!tokens[0]) tokens.shift()
				} else {
					throw new CommandError(`Missing prefix "${p}"`)
				}
			}
			if (!tokens.length) throw new CommandError('Missing command name')

			const fast = byHead.get(norm(tokens[0]))
			if (fast && fast.nameTokens.length === 1) {
				return fast.runTokens(tokens.slice(1), ctx)
			}

			const found = find(tokens)
			if (!found) return undefined
			const rest = tokens.slice(found.consumed)
			return found.cmd.runTokens(rest, ctx)
		},
	}
}

export function defineFor<C>() {
	return function define<P extends string, F extends Flags>(spec: CommandSpec<P, F, C>) {
		return defineCommand<P, F, C>(spec)
	}
}

export type { Flags, TypeFlag, TypeFlagOptions } from 'type-flag'
