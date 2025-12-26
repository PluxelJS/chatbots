import type { Platform, PlatformCapabilities } from '../types'
import type { PlatformAdapter } from './base'

type AdapterMap = Map<Platform, PlatformAdapter<any>>

const REGISTRY: AdapterMap = new Map()

export const registerAdapter = <P extends Platform>(adapter: PlatformAdapter<P>): (() => void) => {
	REGISTRY.set(adapter.name, adapter as PlatformAdapter<any>)
	return () => REGISTRY.delete(adapter.name)
}

export const getAdapter = <P extends Platform>(platform: P): PlatformAdapter<P> => {
	const found = REGISTRY.get(platform)
	if (!found) throw new Error(`Adapter not registered for platform: ${platform}`)
	return found as PlatformAdapter<P>
}

export const listAdapters = (): PlatformAdapter[] => Array.from(REGISTRY.values())

export const getCapabilities = <P extends Platform>(platform: P): PlatformCapabilities =>
	getAdapter(platform).capabilities

export interface AdapterRegistry {
	register: typeof registerAdapter
	get: typeof getAdapter
	list: typeof listAdapters
}

export const createAdapterRegistry = (): AdapterRegistry => ({
	register: registerAdapter,
	get: getAdapter,
	list: listAdapters,
})
