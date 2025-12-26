import { KOOKBotRpc } from './runtime/rpc'
import type { KookRuntime } from './runtime'

export function registerKookExtensions(plugin: { ctx: any; runtime: KookRuntime }) {
	plugin.ctx.ext.ui.register({ entryPath: './ui/index.tsx' })
	plugin.ctx.ext.rpc.registerExtension(() => new KOOKBotRpc(plugin.runtime))

	if (plugin.ctx.ext.sse) {
		plugin.ctx.ext.sse.registerExtension(() => plugin.runtime.createSseHandler())
	}
}

