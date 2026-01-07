import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'
import { useMemo } from 'react'

export type KookRpc = PluginExtensionContext['services']['hmr']['ui']['KOOK']
export type KookSse = PluginExtensionContext['services']['hmr']['sse']

export function useKookPluginName(): string {
	const { pluginName } = useExtensionContext('plugin')
	return pluginName
}

export function useKookRuntime(): { rpc: KookRpc; sse: KookSse } {
	const { services } = useExtensionContext('plugin')
	const hmr = services.hmr
	return useMemo(() => ({ rpc: hmr.ui.KOOK, sse: hmr.sse }), [hmr])
}
