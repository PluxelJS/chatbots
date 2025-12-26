import { TelegramBotRpc } from './runtime/rpc'
import type { TelegramRuntime } from './runtime/runtime'

export function registerTelegramExtensions(plugin: { ctx: any; runtime: TelegramRuntime }) {
	plugin.ctx.ext.ui.register({ entryPath: './ui/index.tsx' })
	plugin.ctx.ext.rpc.registerExtension(() => new TelegramBotRpc(plugin.runtime))

	if (plugin.ctx.ext.sse) {
		plugin.ctx.ext.sse.registerExtension(() => plugin.runtime.createSseHandler())
	}
}

