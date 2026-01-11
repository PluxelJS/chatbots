import type { Command, ExtractCommandParams, Flags, TypeFlag, TypeFlagOptions } from '@pluxel/bot-layer'
import {
	createCommandKit,
	getCommandNameTokens,
	type CommandBuilder as BaseCommandBuilder,
	type CommandKit as BaseCommandKit,
	type CommandKitPlugin,
} from '@pluxel/bot-layer'
import type { ChatbotsCommandContext } from '../types'
import { Decision } from '../../permissions/decision'
import type { PermissionService } from '../../permissions/service'
import { resolvePermRef, type PermRef } from '../../permissions/ref'
import { CommandError } from '@pluxel/bot-layer'
import type { KvRateRule, RateDecision, RateRule, Rates } from 'pluxel-plugin-kv'

declare module '@pluxel/bot-layer' {
	interface CommandMetaExt {
		/** Full permission node string, e.g. `ns.cmd.reload` */
		permNode?: string
		/** Chatbots-level rate limiting info (best-effort). */
		rate?: { scope: RateScope; key: string; rule: RateRule }
	}
}

export type RateScope = 'user' | 'identity' | 'channel' | 'global'

export type CommandKit<C = ChatbotsCommandContext> = {
	reg<P extends string, F extends Flags = {}>(
		pattern: P,
		flags?: F,
		flagOptions?: TypeFlagOptions,
	): CommandBuilder<P, F, C>
	group: BaseCommandKit<C>['group']
	list: BaseCommandKit<C>['list']
	help: BaseCommandKit<C>['help']
}

export type CommandBuilder<P extends string, F extends Flags, C> = BaseCommandBuilder<P, F, C, unknown> & {
	/** Require a declared permission node (capability-level). */
	perm: (ref: PermRef, message?: string) => CommandBuilder<P, F, C>
	/**
	 * Best-effort rate limiting via KV.
	 *
	 * Notes:
	 * - This consumes the budget *before* calling the handler (counts attempts, not only successes).
	 * - Scope is configured per plugin owner by default (KV scopeKey is provided by Chatbots runtime).
	 */
	rates: (rule: KvRateRule, opts?: { scope?: RateScope; key?: string; message?: string }) => CommandBuilder<P, F, C>
}

export function attachPermissionBuilder<P extends string, F extends Flags, C extends ChatbotsCommandContext>(
	base: BaseCommandBuilder<P, F, C, unknown>,
	perms: PermissionService,
): CommandBuilder<P, F, C> {
	return createPermissionPlugin(perms).extendBuilder?.(base as any) as any
}

export function attachRatesBuilder<P extends string, F extends Flags, C extends ChatbotsCommandContext>(
	base: BaseCommandBuilder<P, F, C, unknown>,
	rates: Rates,
	opts: { scopeKey: string },
): CommandBuilder<P, F, C> {
	return createRatesPlugin(rates, opts).extendBuilder?.(base as any) as any
}

export function withPermissions<C extends ChatbotsCommandContext>(
	kit: BaseCommandKit<C>,
	perms: PermissionService,
): CommandKit<C> {
	return {
		reg(pattern, flags, flagOptions) {
			const base = kit.reg(pattern as any, flags as any, flagOptions as any)
			return attachPermissionBuilder(base as any, perms) as any
		},
		group: kit.group.bind(kit),
		list: kit.list.bind(kit),
		help: kit.help.bind(kit),
	}
}

export function createPermissionPlugin<C extends ChatbotsCommandContext>(
	perms: PermissionService,
): CommandKitPlugin<C> {
	return {
		extendBuilder(builder) {
			const b = builder as unknown as CommandBuilder<any, any, C>
			if (typeof b.perm === 'function') return b as any

			b.perm = (ref: PermRef, message: string = 'Permission denied.') => {
				builder.meta({ permNode: ref.node } as any)
				builder.use((next) => async (argv: any, ctx: any) => {
					const nodeRef = resolvePermRef(perms, ref)
					if (!nodeRef) throw new CommandError(message)
					const cached = perms.authorizeUserSync(ctx.user.id, nodeRef)
					const d = cached ?? (await perms.authorizeUser(ctx.user.id, nodeRef))
					if (d !== Decision.Allow) throw new CommandError(message)
					return next(argv, ctx)
				})
				return b as any
			}

			return b as any
		},
	}
}

const formatRateLimitedMessage = (decision: Extract<RateDecision, { ok: false }>) => {
	const secs = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
	return `Rate limited. Retry after ${secs}s.`
}

const defaultRateKeyFromPattern = (pattern: string) => getCommandNameTokens(pattern).join(' ') || pattern

export function createRatesPlugin<C extends ChatbotsCommandContext>(
	rates: Rates,
	opts: { scopeKey: string },
): CommandKitPlugin<C> {
	const scopeKey = opts.scopeKey
	return {
		extendBuilder(builder) {
			const b = builder as unknown as CommandBuilder<any, any, C>
			if (typeof b.rates === 'function') return b as any

			b.rates = (rule: KvRateRule, options?: { scope?: RateScope; key?: string; message?: string }) => {
				const scope = options?.scope ?? 'user'
				const key = String(options?.key ?? defaultRateKeyFromPattern(String(builder.pattern)))
				const message = options?.message

				builder.meta({ rate: { scope, key, rule } } as any)
				builder.use((next) => async (argv: any, ctx: any) => {
					const subject =
						scope === 'global'
							? 'global'
							: scope === 'user'
								? ctx.user.id
								: scope === 'identity'
									? `${ctx.identity.platform}:${ctx.identity.platformUserId}`
									: `${ctx.msg.platform}:${ctx.msg.channel.id}`

					const parts = ['cmd', key, scope, subject] as Array<string | number>

					const decision =
						rule.type === 'cooldown'
							? await rates.cooldown(parts, rule.ttlMs, scopeKey)
							: rule.type === 'fixed'
								? await rates.fixedWindow(parts, rule.periodMs, rule.limit, scopeKey)
								: await rates.tokenBucket(parts, rule.cap, rule.refillPerSec, rule.cost ?? 1, scopeKey)

					if (!decision.ok) {
						throw new CommandError(message ?? formatRateLimitedMessage(decision))
					}
					return next(argv, ctx)
				})

				return b as any
			}

			return b as any
		},
	}
}

export function createPermissionCommandKit<C extends ChatbotsCommandContext>(
	bus: {
		register: (cmd: Command<any, any, C, any>) => any
		list: () => Command<any, any, C, any>[]
	},
	perms: PermissionService,
	opts?: { onRegister?: (cmd: Command<any, any, C, any>) => void; rates?: Rates; scopeKey?: string },
): CommandKit<C> {
	const plugins: CommandKitPlugin<C>[] = [createPermissionPlugin(perms)]
	if (opts?.rates) {
		plugins.push(createRatesPlugin(opts.rates, { scopeKey: opts.scopeKey ?? 'chatbots' }))
	}
	return createCommandKit<C>(bus, {
		plugins,
		onRegister: opts?.onRegister,
	}) as CommandKit<C>
}

export type { Command, TypeFlag, TypeFlagOptions, ExtractCommandParams }
