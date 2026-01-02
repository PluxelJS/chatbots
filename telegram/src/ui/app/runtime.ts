import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'

export type TelegramRpc = PluginExtensionContext['services']['hmr']['rpc']['Telegram']
export type TelegramSse = PluginExtensionContext['services']['hmr']['sse']

export function useTelegramRuntime(): { rpc: TelegramRpc; sse: TelegramSse } {
	const ctx = useExtensionContext('plugin')
	return { rpc: ctx.services.hmr.rpc.Telegram, sse: ctx.services.hmr.sse }
}

