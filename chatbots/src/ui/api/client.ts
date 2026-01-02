import { type PluginExtensionContext, useExtensionContext } from '@pluxel/hmr/web'

export type ChatbotsRpc = PluginExtensionContext['services']['hmr']['rpc']['chatbots']
export type ChatbotsSse = PluginExtensionContext['services']['hmr']['sse']

export const useChatbotsRpc = (): ChatbotsRpc => useExtensionContext('plugin').services.hmr.rpc.chatbots
export const useChatbotsSse = (): ChatbotsSse => useExtensionContext('plugin').services.hmr.sse
