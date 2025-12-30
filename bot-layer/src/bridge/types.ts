import type { Context } from '@pluxel/hmr'
import type { PlatformAdapter } from '../adapter'
import type { AnyMessage, Platform } from '../types'

export type DispatchFn = (msg: AnyMessage) => Promise<void>

export type CleanupFn = (() => void) | void

/**
 * 桥接定义：描述某个平台的运行时如何被发现、监听并转发消息。
 */
export interface BridgeDefinition<P extends Platform = Platform, Instance = unknown> {
	platform: P
	adapter: PlatformAdapter<P>
	/** 监听的 ready 事件名（平台启动时会 emit 此事件） */
	event: string
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
