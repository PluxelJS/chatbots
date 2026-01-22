import { pluginMethodDecorator } from '@pluxel/hmr'
import { Chatbots } from '../plugin'

type AnyFn = (...args: any[]) => any

/**
 * Method decorator: install `@ChatCommand` / `@ChatOp` decorated factories after the method runs.
 *
 * Intended usage: decorate a plugin's `init()` method.
 */
export function InstallChatCommands(opts?: { group?: string; scope?: string }): MethodDecorator {
	return pluginMethodDecorator(Chatbots, async function (original: AnyFn, chatbots: Chatbots, _key, ...args: any[]) {
		const out = await original.apply(this, args)
		let kit = chatbots.cmd
		if (opts?.group) kit = kit.group(opts.group)
		if (opts?.scope) kit = kit.scope(opts.scope)
		kit.install(this as any)
		return out
	})
}
