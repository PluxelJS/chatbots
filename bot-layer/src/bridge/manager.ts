import type { BridgeManager, BridgeDefinition } from './types'
import type { Platform } from '../types'
import { getBridgeDefinitions, getBridgeDefinition, registerBridgeDefinition } from './definitions'

export const createBridgeManager = (): BridgeManager => {
	return {
		list() {
			return getBridgeDefinitions()
		},
		get<P extends Platform>(platform: P) {
			return getBridgeDefinition(platform)
		},
		register<P extends Platform>(def: BridgeDefinition<P>) {
			return registerBridgeDefinition(def)
		},
	}
}

