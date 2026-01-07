import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'
import { useMemo } from 'react'

export type MilkyRpc = PluginExtensionContext['services']['hmr']['ui']['Milky']
export type MilkySse = PluginExtensionContext['services']['hmr']['sse']

export function useMilkyPluginName(): string {
	const { pluginName } = useExtensionContext('plugin')
	return pluginName
}

export function useMilkyRuntime(): { rpc: MilkyRpc; sse: MilkySse } {
	const { services } = useExtensionContext('plugin')
	const hmr = services.hmr
	return useMemo(() => ({ rpc: hmr.ui.Milky, sse: hmr.sse }), [hmr])
}
