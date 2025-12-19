import type { Flags, TypeFlag, TypeFlagOptions } from 'type-flag'

import type { Command, ExtractCommandParams } from '../../bot-layer/cmd'
import type { CommandBuilder as BaseCommandBuilder, CommandKit as BaseCommandKit } from '../../bot-layer/cmd/kit'
import type { ChatbotsCommandContext } from '../types'
import { Decision } from '../../permissions/decision'
import type { NodeRef } from '../../permissions/resolver'
import type { PermissionService } from '../../permissions/service'
import { resolvePermRef, type PermRef } from '../../permissions/ref'

export type CommandKit<C = ChatbotsCommandContext> = {
	reg<P extends string, F extends Flags = {}, R = unknown>(
		pattern: P,
		flags?: F,
		flagOptions?: TypeFlagOptions,
	): CommandBuilder<P, F, C, R>
	group: BaseCommandKit<C>['group']
	list: BaseCommandKit<C>['list']
	help: BaseCommandKit<C>['help']
}

export type CommandBuilder<P extends string, F extends Flags, C, R = unknown> = BaseCommandBuilder<P, F, C, R> & {
	/** Require a declared permission node (capability-level). */
	perm: (ref: PermRef, message?: string) => CommandBuilder<P, F, C, R>
}

export function withPermissions<C extends ChatbotsCommandContext>(
	kit: BaseCommandKit<C>,
	perms: PermissionService,
): CommandKit<C> {
	return {
		reg(pattern, flags, flagOptions) {
			const base = kit.reg(pattern as any, flags as any, flagOptions as any)
			const builder = base as unknown as CommandBuilder<any, any, C, any>

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

			return builder as any
		},
		group: kit.group.bind(kit),
		list: kit.list.bind(kit),
		help: kit.help.bind(kit),
	}
}

export type { Command, TypeFlag, TypeFlagOptions, ExtractCommandParams }
