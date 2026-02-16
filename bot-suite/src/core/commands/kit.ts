import type { Context } from '@pluxel/hmr'

import { CmdError, cmd } from '@pluxel/cmd'
import type { CmdBuilder, ExecCtx, Interceptor, McpConfig, TextConfig, TextExecutable } from '@pluxel/cmd'
import type { KvRateRule, RateDecision, RatesApi } from 'pluxel-plugin-kv'

import { Decision } from '../../permissions/decision'
import type { PermissionEffect, PermissionMeta } from '../../permissions/registry'
import type { PermissionService } from '../../permissions/service'
import { perm, resolvePermRef, type PermRef } from '../../permissions/ref'
import type { ChatbotsCommandContext } from '../types'
import type { CommandRegistry, RegisteredCommandInfo } from '../runtime/command-registry'

import type { BuiltCommandDraft, BuiltOpDraft, CommandDraft, OpDraft } from './draft'
import { cmd as cmdDraft, isBuiltCommandDraft, isBuiltDraft, isBuiltOpDraft, op as opDraft, type BuiltDraft } from './draft'
import type { OpSpec, PermSpecInput, RateScope, TextCommandSpec } from './spec'

type PermSpec = false | { ref: PermRef; message?: string; declare?: { default: PermissionEffect } & PermissionMeta }

type CommonSpec = {
	title?: string
	description?: string
	tags?: readonly string[]
	perm?: PermSpec
	rates?: { rule: KvRateRule; scope?: RateScope; key?: string; message?: string }
	mcp?: McpConfig
}

export type CommandKit<C extends ExecCtx = ChatbotsCommandContext> = {
	group(name: string): CommandKit<C>
	group(name: string, fn: (kit: CommandKit<C>) => void): void

	scope(prefix: string): CommandKit<C>
	scope(prefix: string, fn: (kit: CommandKit<C>) => void): void

	/**
	 * Register a text command.
	 */
	command<R>(spec: { localId: string } & TextCommandSpec, factory: (c: CommandDraft<C>) => BuiltCommandDraft<C, R>): void
	command<R>(spec: { localId: string } & TextCommandSpec, built: BuiltCommandDraft<C, R>): void

	/** Register a non-text op. */
	op<R>(spec: { localId: string } & OpSpec, factory: (o: OpDraft<C>) => BuiltOpDraft<C, R>): void
	op<R>(spec: { localId: string } & OpSpec, built: BuiltOpDraft<C, R>): void

	list(): Array<{
		id: string
		name: string
		usage?: string
		aliases: string[]
		description?: string
		group?: string
		permNode?: string
	}>

	help(group?: string): string
}

const uniqueStrings = (xs: readonly string[]) => {
	const out: string[] = []
	const seen = new Set<string>()
	for (const x of xs) {
		const s = String(x).trim()
		if (!s) continue
		if (seen.has(s)) continue
		seen.add(s)
		out.push(s)
	}
	return out
}

const defaultTriggerFromLocalId = (localId: string) => localId.trim().replace(/\.+/g, '.').replace(/\./g, ' ')

const sanitizeMcpName = (s: string) => {
	const raw = String(s ?? '').trim()
	if (!raw) return ''
	// Keep it registry-friendly and deterministic.
	return raw
		.replace(/\s+/g, '_')
		.replace(/[^a-zA-Z0-9_.-]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
}

const defaultMcpName = (nsKey: string, localId: string) => {
	const base = sanitizeMcpName(localId)
	return base ? `${nsKey}.${base}` : nsKey
}

const deriveGroupFromLocalId = (localId: string) => {
	const s = localId.trim()
	const dot = s.indexOf('.')
	if (dot <= 0) return undefined
	const g = s.slice(0, dot).trim()
	return g || undefined
}

const joinLocalId = (prefix: string | undefined, localId: string) => {
	const p = String(prefix ?? '').trim().replace(/\.+/g, '.').replace(/\.$/, '')
	const l = String(localId).trim().replace(/^\.+/g, '').replace(/\.+/g, '.')
	if (!p) return l
	if (!l) return p
	return `${p}.${l}`
}

const toRateLimitedMessage = (decision: Extract<RateDecision, { ok: false }>) => {
	const secs = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
	return `Rate limited. Retry after ${secs}s.`
}

const withRatesInterceptor = <C extends ChatbotsCommandContext>(
	rates: RatesApi,
	opts: { scopeKey: string; scope: RateScope; key: string; rule: KvRateRule; message?: string },
): Interceptor<void> => {
	const scopeKey = opts.scopeKey
	const scope = opts.scope
	const key = opts.key
	const rule = opts.rule
	const message = opts.message

	return {
		name: 'rates',
		async before(ctx, _candidate) {
			const c = ctx as unknown as C
			const subject =
				scope === 'global'
					? 'global'
					: scope === 'user'
						? c.user.id
						: scope === 'identity'
							? `${c.identity.platform}:${c.identity.platformUserId}`
							: `${c.msg.platform}:${c.msg.channel.id}`

			const parts = ['cmd', key, scope, subject] as Array<string | number>
			const decision =
				rule.type === 'cooldown'
					? await rates.cooldown(parts, rule.ttlMs, scopeKey)
					: rule.type === 'fixed'
						? await rates.fixedWindow(parts, rule.periodMs, rule.limit, scopeKey)
						: await rates.tokenBucket(parts, rule.cap, rule.refillPerSec, rule.cost ?? 1, scopeKey)

			if (!decision.ok) {
				throw new CmdError('E_RATE_LIMITED', message ?? toRateLimitedMessage(decision), {
					message: 'Rate limited',
					details: { decision },
				})
			}

			return { kind: 'continue' }
		},
	}
}

const withPermInterceptor = <C extends ChatbotsCommandContext>(
	perms: PermissionService,
	ref: PermRef,
	message: string,
): Interceptor<void> => {
	return {
		name: 'perm',
		async before(ctx, _candidate) {
			const c = ctx as unknown as C
			const nodeRef = resolvePermRef(perms, ref)
			if (!nodeRef) {
				throw new CmdError('E_FORBIDDEN', message, { message: 'Permission denied (undeclared)' })
			}
			const d = await perms.authorizeUserFast(c.user.id, nodeRef)
			if (d !== Decision.Allow) {
				throw new CmdError('E_FORBIDDEN', message, { message: 'Permission denied' })
			}
			return { kind: 'continue' }
		},
	}
}

export function createPermissionCommandKit<C extends ChatbotsCommandContext>(
	registry: CommandRegistry<C>,
	perms: PermissionService,
	opts: {
		owner: Context
		scopeKey: string
		rates?: RatesApi
		permDefaults?: {
			/** When auto-declaring permissions, which effect should be used. Default: `allow`. */
			defaultEffect?: PermissionEffect
			/** Declare permissions automatically if not already declared. Default: true. */
			autoDeclare?: boolean
			/** Auto-declare `cmd.*` and `cmd.<group>.*` stars for bulk granting. Default: true. */
			autoDeclareStars?: boolean
		}
	},
): CommandKit<C> {
	const owner = opts.owner
	const scopeKey = opts.scopeKey
	const rates = opts.rates
	const permDefaults = {
		defaultEffect: opts.permDefaults?.defaultEffect ?? 'allow',
		autoDeclare: opts.permDefaults?.autoDeclare ?? true,
		autoDeclareStars: opts.permDefaults?.autoDeclareStars ?? true,
	} as const

	const nsKey = owner.pluginInfo?.id
	if (!nsKey) throw new Error('[chatbots] createPermissionCommandKit(): missing owner.pluginInfo.id')

	const ensurePermDeclared = (ref: PermRef, def: { default: PermissionEffect } & PermissionMeta): void => {
		if (!permDefaults.autoDeclare) return
		const node = String(ref.node).trim()
		if (!node) return

		const dot = node.indexOf('.')
		if (dot <= 0 || dot === node.length - 1) return
		const nodeNsKey = node.slice(0, dot)
		const local = node.slice(dot + 1)
		if (nodeNsKey !== nsKey) {
			throw new Error(`[chatbots] permissions must be declared in the same namespace: ${nsKey} (got ${nodeNsKey})`)
		}

		const resolved = perms.resolver.resolve(node)
		if (!resolved) perms.declareExact(nsKey, local, def)
	}

	const ensureStarDeclared = (localPrefix: string, def: { default: PermissionEffect } & PermissionMeta): void => {
		if (!permDefaults.autoDeclareStars) return
		const s = String(localPrefix).trim().replace(/\.*$/, '')
		if (!s) return
		const node = `${nsKey}.${s}.*`
		const exists = perms.resolver.resolveGrant(node)
		if (!exists) perms.declareStar(nsKey, s, def)
	}

	const normalizePermSpec = (localId: string, spec: PermSpecInput | undefined): PermSpec => {
		const permSpec: PermSpecInput = spec === undefined ? true : spec
		if (permSpec === false) return false

		const permLocal =
			permSpec === true
				? `cmd.${localId}`
				: typeof permSpec === 'string'
					? permSpec
					: (permSpec.local ?? `cmd.${localId}`)

		const message =
			permSpec === true || typeof permSpec === 'string' || permSpec === false
				? undefined
				: permSpec.message

		const declare =
			permSpec === true || typeof permSpec === 'string' || permSpec === false
				? undefined
				: ({
						default: permSpec.default ?? permDefaults.defaultEffect,
						description: permSpec.description,
						tags: permSpec.tags ? [...permSpec.tags] : undefined,
						...(permSpec.hidden !== undefined ? { hidden: permSpec.hidden } : {}),
						...(permSpec.deprecated !== undefined ? { deprecated: permSpec.deprecated } : {}),
					} satisfies { default: PermissionEffect } & PermissionMeta)

		return {
			ref: perm(`${nsKey}.${String(permLocal).trim()}`),
			...(message ? { message } : {}),
			...(declare ? { declare } : {}),
		}
	}

	const makeKit = (state: { group?: string; tags?: readonly string[]; scopePrefix?: string }): CommandKit<C> => {
		const group = state.group
		const tags = state.tags ? uniqueStrings(state.tags) : undefined
		const scopePrefix = state.scopePrefix

		const fullId = (localId: string) => `${nsKey}.cmd.${String(localId).trim()}`

		const applyCommon = <I, O, S extends { hasHandle: boolean; hasText: boolean; hasMcp: boolean }>(
			b: CmdBuilder<I, O, S>,
			spec: CommonSpec & { localId: string; group?: string },
		): CmdBuilder<I, O, S> => {
			let out = b
			if (spec.perm && spec.perm !== false) {
				const message = spec.perm.message ?? 'Permission denied.'
				const declare = spec.perm.declare ?? { default: permDefaults.defaultEffect }
				const effectiveGroup = spec.group ?? group ?? deriveGroupFromLocalId(spec.localId)

				ensurePermDeclared(spec.perm.ref, {
					default: declare.default,
					description: declare.description ?? spec.description,
					tags: declare.tags ?? (tags ? [...tags] : undefined),
					...(declare.hidden !== undefined ? { hidden: declare.hidden } : {}),
					...(declare.deprecated !== undefined ? { deprecated: declare.deprecated } : {}),
				})
				ensureStarDeclared('cmd', { default: 'deny', description: 'All chat commands' })
				if (effectiveGroup) ensureStarDeclared(`cmd.${effectiveGroup}`, { default: 'deny', description: `${effectiveGroup} commands` })

				out = out.intercept(withPermInterceptor(perms, spec.perm.ref, message))
			}

			if (spec.rates) {
				if (!rates) throw new Error('[chatbots] rates requested but rate service is not available')
				const scope = spec.rates.scope ?? 'user'
				const key = String(spec.rates.key ?? fullId(spec.localId))
				out = out.intercept(withRatesInterceptor(rates, { scopeKey, scope, key, rule: spec.rates.rule, message: spec.rates.message }))
			}

			return out
		}

		const registerText = (exec: TextExecutable<any, any>, info: RegisteredCommandInfo) => {
			registry.registerTextCommand(exec, owner)
			registry.setInfo(exec.id, info)
		}

		function buildFromFactory<R>(
			kind: 'command',
			factoryOrBuilt: BuiltCommandDraft<C, R> | ((c: CommandDraft<C>) => BuiltCommandDraft<C, R>),
		): BuiltCommandDraft<C, R>
		function buildFromFactory<R>(
			kind: 'op',
			factoryOrBuilt: BuiltOpDraft<C, R> | ((o: OpDraft<C>) => BuiltOpDraft<C, R>),
		): BuiltOpDraft<C, R>
		function buildFromFactory(kind: 'command' | 'op', factoryOrBuilt: unknown): BuiltDraft<C, unknown> {
			if (kind === 'command' && isBuiltCommandDraft<C>(factoryOrBuilt)) return factoryOrBuilt
			if (kind === 'op' && isBuiltOpDraft<C>(factoryOrBuilt)) return factoryOrBuilt

			if (isBuiltDraft<C>(factoryOrBuilt)) {
				throw new Error(`[chatbots] ${kind}(): got a built draft of the wrong kind`)
			}

			if (typeof factoryOrBuilt !== 'function') {
				throw new Error(`[chatbots] ${kind}(): expected a built draft or a factory function`)
			}

			const d = kind === 'op' ? opDraft<C>() : cmdDraft<C>()
			const out = (factoryOrBuilt as any)(d)
			if (kind === 'command' && isBuiltCommandDraft<C>(out)) return out
			if (kind === 'op' && isBuiltOpDraft<C>(out)) return out

			throw new Error(`[chatbots] ${kind}(): factory must return a built draft (call .handle(...))`)
		}

		const registerOp = <R,>(spec: { localId: string } & OpSpec, built: BuiltOpDraft<C, R>) => {
			if (spec.enabled === false) return

			const localId = joinLocalId(scopePrefix, String(spec.localId).trim())
			if (!localId) return
			const id = fullId(localId)

			const perm = normalizePermSpec(localId, spec.perm)
			const common: CommonSpec & { localId: string; group?: string } = {
				localId,
				...(spec.title ? { title: spec.title } : {}),
				...(spec.tags ? { tags: spec.tags } : {}),
				...(perm === false ? { perm: false } : perm ? { perm } : {}),
				...(spec.rates ? { rates: spec.rates } : {}),
				...(spec.mcp ? { mcp: spec.mcp } : {}),
				...(spec.group ? { group: spec.group } : {}),
			}

			let b = cmd(id)
			const applied = built.apply(b)
			b = applyCommon(applied.builder, common)
			if (common.mcp) {
				const m: McpConfig = {
					...common.mcp,
					...(common.mcp.name ? {} : { name: defaultMcpName(nsKey, localId) }),
				}
				b = b.mcp(m)
			}
			const exec = b.build()
			registry.registerOp(exec, owner)
		}

		const registerCommand = <R,>(spec: { localId: string } & TextCommandSpec, built: BuiltCommandDraft<C, R>) => {
			if (spec.enabled === false) return

			const localId = joinLocalId(scopePrefix, String(spec.localId).trim())
			if (!localId) return
			const id = fullId(localId)

			const triggers = uniqueStrings([
				...(spec.triggers?.length ? spec.triggers : [defaultTriggerFromLocalId(localId)]),
				...(spec.aliases ?? []),
			])
			if (!triggers.length) throw new Error(`[chatbots] command("${id}") requires at least one trigger`)

			const perm = normalizePermSpec(localId, spec.perm)
			const common: CommonSpec & { localId: string; group?: string } = {
				localId,
				...(spec.title ? { title: spec.title } : {}),
				...(spec.tags ? { tags: spec.tags } : {}),
				...(perm === false ? { perm: false } : perm ? { perm } : {}),
				...(spec.rates ? { rates: spec.rates } : {}),
				...(spec.mcp ? { mcp: spec.mcp } : {}),
				...(spec.group ? { group: spec.group } : {}),
				...(spec.description ? { description: spec.description } : {}),
			}

			let b = cmd(id)
			const applied = built.apply(b)
			b = applyCommon(applied.builder, common)
			if (common.mcp) {
				const m: McpConfig = {
					...common.mcp,
					...(common.mcp.name ? {} : { name: defaultMcpName(nsKey, localId) }),
				}
				b = b.mcp(m)
			}

			if (spec.description) b = b.doc({ description: spec.description })

			const partialTextCfg = applied.text as Omit<TextConfig, 'triggers'> | undefined
			const textCfg: TextConfig = {
				triggers,
				...(partialTextCfg ? partialTextCfg : {}),
			}

			const exec = b.text(textCfg).build()

			const effectiveGroup = common.group ?? group ?? deriveGroupFromLocalId(localId)
			const info: RegisteredCommandInfo = {
				name: triggers[0]!,
				aliases: triggers.slice(1),
				usage: spec.usage,
				description: spec.description,
				group: effectiveGroup,
				...(perm && perm !== false ? { permNode: perm.ref.node } : {}),
			}

			registerText(exec, info)
		}

		return {
			group(name: string, fn?: (kit: CommandKit<C>) => void) {
				const derived = makeKit({ group: name, tags, scopePrefix })
				if (typeof fn === 'function') return fn(derived)
				return derived
			},

			scope(prefix: string, fn?: (kit: CommandKit<C>) => void) {
				const derived = makeKit({ group, tags, scopePrefix: joinLocalId(scopePrefix, prefix) })
				if (typeof fn === 'function') return fn(derived)
				return derived
			},

			command<R>(
				spec: { localId: string } & TextCommandSpec,
				factoryOrBuilt: BuiltCommandDraft<C, R> | ((c: CommandDraft<C>) => BuiltCommandDraft<C, R>),
			) {
				const built = buildFromFactory('command', factoryOrBuilt)
				registerCommand(spec, built)
			},

			op<R>(spec: { localId: string } & OpSpec, factoryOrBuilt: BuiltOpDraft<C, R> | ((o: OpDraft<C>) => BuiltOpDraft<C, R>)) {
				const built = buildFromFactory('op', factoryOrBuilt)
				registerOp(spec, built)
			},

			list() {
				const out: Array<{
					id: string
					name: string
					usage?: string
					aliases: string[]
					description?: string
					group?: string
					permNode?: string
				}> = []

				for (const { id, info } of registry.list()) {
					out.push({
						id,
						name: info.name,
						aliases: info.aliases,
						usage: info.usage,
						description: info.description,
						group: info.group,
						permNode: info.permNode,
					})
				}

				out.sort((a, b) => a.name.localeCompare(b.name))
				return out
			},

			help(arg?: string) {
				const groupArg = String(arg ?? '').trim()
				const list = this.list().filter((c) => !groupArg || (c.group ?? '').toLowerCase() === groupArg.toLowerCase())
				if (list.length === 0) return ''
				const lines: string[] = []
				for (const c of list) {
					const head = c.usage ?? c.name
					const desc = c.description ? ` — ${c.description}` : ''
					lines.push(`- ${head}${desc}`)
				}
				return lines.join('\n')
			},
		}
	}

	return makeKit({})
}
