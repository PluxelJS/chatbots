import { KOOKBotRpc } from './runtime/rpc'
import type { KookRuntime } from './runtime'
import type {} from '@pluxel/hmr/services'
import type { Context } from '@pluxel/core'

export function registerKookExtensions(plugin: { ctx: Context; runtime: KookRuntime }) {
	if (!plugin.ctx.env.isHmrRuntime) return

	plugin.ctx.ext.ui.register({ entryPath: './ui/index.tsx' })
	plugin.ctx.ext.rpc.registerExtension(() => new KOOKBotRpc(plugin.runtime))
	plugin.ctx.ext.sse.registerExtension(() => plugin.runtime.createSseHandler())
}
