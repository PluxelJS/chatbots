import type { Context } from '@pluxel/hmr'
import type { PlatformAdapter } from '../platforms/base'
import type { AnyMessage, Message, Platform } from '../types'

export type DispatchFn = (msg: AnyMessage) => Promise<void>

export type CleanupFn = (() => void) | void

/**
 * 桥接定义：描述某个平台的运行时如何被发现、监听并转发消息。
 */
export interface BridgeDefinition<P extends Platform = Platform, Instance = unknown> {
	platform: P
	adapter: PlatformAdapter<P>
	/** 侦听平台实例的出现/变更，返回可选的清理函数 */
	watch: (ctx: Context, attach: (instance?: Instance) => void) => CleanupFn
	/**
	 * 将平台实例挂载到转发管道，返回可选的清理函数。
	 * attach 内部负责完成 normalize/dispatch 等平台特定逻辑。
	 */
	attach: (ctx: Context, instance: Instance, dispatch: DispatchFn) => CleanupFn
}

export interface BridgeManager {
	list(): BridgeDefinition[]
	get<P extends Platform>(platform: P): BridgeDefinition<P> | undefined
	register<P extends Platform>(def: BridgeDefinition<P>): () => void
}
