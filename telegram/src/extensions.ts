import { TelegramBotRpc } from './runtime/rpc'
import type { TelegramRuntime } from './runtime'
import type {} from '@pluxel/hmr/services'
import type { Context } from '@pluxel/core'

export function registerTelegramExtensions(plugin: { ctx: Context; runtime: TelegramRuntime }) {
	if (!plugin.ctx.env.isHmrRuntime) return

	plugin.ctx.ext.ui.register({ entryPath: './ui/index.tsx' })
	plugin.ctx.ext.rpc.registerExtension(() => new TelegramBotRpc(plugin.runtime))
	plugin.ctx.ext.sse.registerExtension(() => plugin.runtime.createSseHandler())
}
