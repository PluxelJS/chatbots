import type { Context } from '@pluxel/hmr'
import { v } from '@pluxel/hmr/config'
import type { Platform } from '../types'
import type { BridgeDefinition, BridgeManager, DispatchFn } from './types'
import { kookBridge } from './kook'
import { milkyBridge } from './milky'
import { telegramBridge } from './telegram'
import { registerAdapter } from '../adapter'
import { startBridges } from './runtime'
import type { BridgeStatusTracker } from '../status'

// ─────────────────────────────────────────────────────────────────────────────
// Bridge Registry
// ─────────────────────────────────────────────────────────────────────────────

const DEFINITIONS = new Map<Platform, BridgeDefinition>()

const addBuiltin = (def: BridgeDefinition) => {
	DEFINITIONS.set(def.platform, def)
	registerAdapter(def.adapter as any)
}

addBuiltin(kookBridge as BridgeDefinition)
addBuiltin(milkyBridge as BridgeDefinition)
addBuiltin(telegramBridge as BridgeDefinition)

/** 获取当前所有桥接定义 */
export const getBridgeDefinitions = (): BridgeDefinition[] => Array.from(DEFINITIONS.values())

/** 获取某个平台的桥接定义 */
export const getBridgeDefinition = <P extends Platform>(platform: P) =>
	DEFINITIONS.get(platform) as unknown as BridgeDefinition<P>

/** 运行时注册桥接定义（第三方平台扩展用） */
export const registerBridgeDefinition = <P extends Platform>(def: BridgeDefinition<P>): (() => void) => {
	DEFINITIONS.set(def.platform, def as unknown as BridgeDefinition)
	const disposeAdapter = registerAdapter(def.adapter as any)
	return () => {
		disposeAdapter()
		DEFINITIONS.delete(def.platform)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge Manager
// ─────────────────────────────────────────────────────────────────────────────

export const createBridgeManager = (): BridgeManager => ({
	list: getBridgeDefinitions,
	get: getBridgeDefinition,
	register: registerBridgeDefinition,
})

// ─────────────────────────────────────────────────────────────────────────────
// Config & Registration
// ─────────────────────────────────────────────────────────────────────────────

export const BridgeConfigSchema = v.object({
	kook: v.optional(v.object({ enabled: v.optional(v.boolean(), true) }), { enabled: true }),
	milky: v.optional(v.object({ enabled: v.optional(v.boolean(), true) }), { enabled: true }),
	telegram: v.optional(v.object({ enabled: v.optional(v.boolean(), true) }), { enabled: true }),
})

export type BridgeConfig = v.InferOutput<typeof BridgeConfigSchema>

/** 统一注册所有平台桥接 */
export const registerAllBridges = (
	ctx: Context,
	dispatch: DispatchFn,
	config?: BridgeConfig,
	status?: BridgeStatusTracker,
): (() => void) => {
	const enabled = getBridgeDefinitions().filter((def) => (config as any)?.[def.platform]?.enabled !== false)
	return startBridges(ctx, enabled, dispatch, status)
}
