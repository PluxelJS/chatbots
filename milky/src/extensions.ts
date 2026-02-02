import { MilkyBotRpc } from './runtime/rpc'
import type { MilkyRuntime } from './runtime'
import type {} from '@pluxel/hmr/services'
import type { Context } from '@pluxel/core'

export function registerMilkyExtensions(plugin: { ctx: Context; runtime: MilkyRuntime }) {
	if (!plugin.ctx.env.isHmrRuntime) return

	plugin.ctx.ext.ui.register({ entryPath: './ui/index.tsx' })
	plugin.ctx.ext.rpc.registerExtension(() => new MilkyBotRpc(plugin.runtime))
	plugin.ctx.ext.sse.registerExtension(() => plugin.runtime.createSseHandler())
}
