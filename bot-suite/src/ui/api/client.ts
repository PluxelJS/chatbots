import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'
import type {} from '../../core/api'
import { useMemo } from 'react'

export const CHATBOTS_NAMESPACE = 'bot-suite' as const

export type ChatbotsRpc = PluginExtensionContext['services']['hmr']['ui'][typeof CHATBOTS_NAMESPACE]
export type ChatbotsSse = PluginExtensionContext['services']['hmr']['sse']

function useChatbotsRuntime(): { rpc: ChatbotsRpc; sse: ChatbotsSse } {
	const { services } = useExtensionContext('plugin')
	const hmr = services.hmr
	return useMemo(
		() => ({
			rpc: hmr.ui[CHATBOTS_NAMESPACE],
			sse: hmr.sse,
		}),
		[hmr],
	)
}

export const useChatbotsRpc = (): ChatbotsRpc => useChatbotsRuntime().rpc
export const useChatbotsSse = (): ChatbotsSse => useChatbotsRuntime().sse
