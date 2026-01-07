import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'
import { useMemo } from 'react'

export type TelegramRpc = PluginExtensionContext['services']['hmr']['ui']['Telegram']
export type TelegramSse = PluginExtensionContext['services']['hmr']['sse']

export function useTelegramPluginName(): string {
	const { pluginName } = useExtensionContext('plugin')
	return pluginName
}

export function useTelegramRuntime(): { rpc: TelegramRpc; sse: TelegramSse } {
	const { services } = useExtensionContext('plugin')
	const hmr = services.hmr
	return useMemo(() => ({ rpc: hmr.ui.Telegram, sse: hmr.sse }), [hmr])
}
