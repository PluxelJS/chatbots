import type { Context } from '@pluxel/hmr'
import type { PlatformAdapter } from '../adapter'
import type { AnyMessage, Platform } from '../types'

export type DispatchFn = (msg: AnyMessage) => Promise<void>

export type CleanupFn = (() => void) | void

/**
 * 桥接定义：描述某个平台的运行时如何被发现、监听并转发消息。
 */
export interface BridgeDefinition<
	P extends Platform = Platform,
	E extends string = string,
	Instance = unknown,
> {
	platform: P
	adapter: PlatformAdapter<P>
	/** 监听的 ready 事件名（平台启动时会 emit 此事件） */
	event: E
	/**
	 * 将平台实例挂载到转发管道，返回可选的清理函数。
	 * attach 内部负责完成 normalize/dispatch 等平台特定逻辑。
	 */
	attach: (ctx: Context, instance: Instance, dispatch: DispatchFn) => CleanupFn
}

export type AnyBridgeDefinition = { [P in Platform]: BridgeDefinition<P, string, any> }[Platform]

export interface BridgeManager {
	list(): AnyBridgeDefinition[]
	get<P extends Platform>(platform: P): BridgeDefinition<P> | undefined
	register<P extends Platform, E extends string, Instance>(def: BridgeDefinition<P, E, Instance>): () => void
}
