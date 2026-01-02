import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'

export type MilkyRpc = PluginExtensionContext['services']['hmr']['rpc']['Milky']
export type MilkySse = PluginExtensionContext['services']['hmr']['sse']

export function useMilkyRuntime(): { rpc: MilkyRpc; sse: MilkySse } {
	const ctx = useExtensionContext('plugin')
	return { rpc: ctx.services.hmr.rpc.Milky, sse: ctx.services.hmr.sse }
}

