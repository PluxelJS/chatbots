import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'
import type { ChatbotsRpc as ChatbotsRpcServer } from '../../core/api'
import { useMemo } from 'react'

export type ChatbotsRpc = ChatbotsRpcServer
export type ChatbotsSse = PluginExtensionContext['services']['hmr']['sse']

function useChatbotsRuntime(): { rpc: ChatbotsRpc; sse: ChatbotsSse } {
	const { services } = useExtensionContext('plugin')
	const hmr = services.hmr
	return useMemo(
		() => ({
			rpc: (hmr.ui as any).chatbots as ChatbotsRpc,
			sse: hmr.sse,
		}),
		[hmr],
	)
}

export const useChatbotsRpc = (): ChatbotsRpc => useChatbotsRuntime().rpc
export const useChatbotsSse = (): ChatbotsSse => useChatbotsRuntime().sse
