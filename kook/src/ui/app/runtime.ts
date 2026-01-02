import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'

export type KookRpc = PluginExtensionContext['services']['hmr']['rpc']['KOOK']
export type KookSse = PluginExtensionContext['services']['hmr']['sse']

export function useKookRuntime(): { rpc: KookRpc; sse: KookSse } {
	const ctx = useExtensionContext('plugin')
	return { rpc: ctx.services.hmr.rpc.KOOK, sse: ctx.services.hmr.sse }
}

