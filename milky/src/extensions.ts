import { MilkyBotRpc } from './runtime/rpc'
import type { MilkyRuntime } from './runtime'

export function registerMilkyExtensions(plugin: { ctx: any; runtime: MilkyRuntime }) {
	plugin.ctx.ext.ui.register({ entryPath: './ui/index.tsx' })
	plugin.ctx.ext.rpc.registerExtension(() => new MilkyBotRpc(plugin.runtime))

	if (plugin.ctx.ext.sse) {
		plugin.ctx.ext.sse.registerExtension(() => plugin.runtime.createSseHandler())
	}
}

