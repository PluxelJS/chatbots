import type { Context } from '@pluxel/hmr'
import { v } from '@pluxel/hmr/config'
import type { DispatchFn } from './types'
import { getBridgeDefinitions } from './definitions'
import { startBridges } from './runtime'
import type { BridgeStatusTracker } from '../status'

export const BridgeConfigSchema = v.object({
	kook: v.optional(
		v.object({
			enabled: v.optional(v.boolean(), true),
		}),
		{ enabled: true },
	),
	telegram: v.optional(
		v.object({
			enabled: v.optional(v.boolean(), true),
		}),
		{ enabled: true },
	),
})

export type BridgeConfig = v.InferOutput<typeof BridgeConfigSchema>

/**
 * 统一注册所有平台桥接，便于在主插件文件中保持简洁。
 */
export const registerAllBridges = (
	ctx: Context,
	dispatch: DispatchFn,
	config?: BridgeConfig,
	status?: BridgeStatusTracker,
): (() => void) => {
	const enabled = getBridgeDefinitions().filter((def) => (config as any)?.[def.platform]?.enabled !== false)
	return startBridges(ctx, enabled, dispatch, status)
}

export { registerBridgeDefinition } from './definitions'
export { createBridgeManager } from './manager'
