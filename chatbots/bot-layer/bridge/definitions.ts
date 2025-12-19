import type { Platform } from '../types'
import type { BridgeDefinition } from './types'
import { kookBridge } from './kook'
import { telegramBridge } from './telegram'
import { registerAdapter } from '../platforms/registry'

const DEFINITIONS = new Map<Platform, BridgeDefinition>()

const addBuiltin = (def: BridgeDefinition) => {
	DEFINITIONS.set(def.platform, def)
	// 平台桥接自带 adapter，默认注册到全局平台注册表
	registerAdapter(def.adapter as any)
}

addBuiltin(kookBridge as BridgeDefinition)
addBuiltin(telegramBridge as BridgeDefinition)

/** 获取当前所有桥接定义（包含运行时动态注册的） */
export const getBridgeDefinitions = (): BridgeDefinition[] => Array.from(DEFINITIONS.values())

/** 获取某个平台的桥接定义 */
export const getBridgeDefinition = <P extends Platform>(platform: P) =>
	DEFINITIONS.get(platform) as unknown as BridgeDefinition<P>

/**
 * 运行时注册桥接定义。
 * 便于第三方平台通过模块扩展 PlatformRegistry + BridgeDefinition 接入。
 */
export const registerBridgeDefinition = <P extends Platform>(def: BridgeDefinition<P>): (() => void) => {
	DEFINITIONS.set(def.platform, def as unknown as BridgeDefinition)
	const disposeAdapter = registerAdapter(def.adapter as any)
	return () => {
		disposeAdapter()
		DEFINITIONS.delete(def.platform)
	}
}
