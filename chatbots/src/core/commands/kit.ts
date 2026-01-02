import type { Command, ExtractCommandParams, Flags, TypeFlag, TypeFlagOptions } from '@pluxel/bot-layer'
import { createCommandKit, type CommandBuilder as BaseCommandBuilder, type CommandKit as BaseCommandKit } from '@pluxel/bot-layer'
import type { ChatbotsCommandContext } from '../types'
import { Decision } from '../../permissions/decision'
import type { NodeRef } from '../../permissions/resolver'
import type { PermissionService } from '../../permissions/service'
import { resolvePermRef, type PermRef } from '../../permissions/ref'

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
}

export function attachPermissionBuilder<P extends string, F extends Flags, C extends ChatbotsCommandContext>(
	base: BaseCommandBuilder<P, F, C, unknown>,
	perms: PermissionService,
): CommandBuilder<P, F, C> {
	const builder = base as CommandBuilder<P, F, C>
	if (typeof builder.perm === 'function') return builder

	builder.perm = (ref: PermRef, message: string = 'Permission denied.') => {
		base.use((next) => async (argv: any, ctx: any) => {
			const nodeRef = resolvePermRef(perms, ref)
			if (!nodeRef) return message
			const cached = perms.authorizeUserSync(ctx.user.id, nodeRef)
			const d = cached ?? (await perms.authorizeUser(ctx.user.id, nodeRef))
			if (d !== Decision.Allow) return message
			return next(argv, ctx)
		})
		return builder
	}

	return builder
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

export function createPermissionCommandKit<C extends ChatbotsCommandContext>(
	bus: {
		register: (cmd: Command<any, any, C, any>) => any
		list: () => Command<any, any, C, any>[]
	},
	perms: PermissionService,
	opts?: { onRegister?: (cmd: Command<any, any, C, any>) => void },
): CommandKit<C> {
	return createCommandKit<C>(bus, {
		extendBuilder: (builder) => attachPermissionBuilder(builder as any, perms) as any,
		onRegister: opts?.onRegister,
	}) as CommandKit<C>
}

export type { Command, TypeFlag, TypeFlagOptions, ExtractCommandParams }
