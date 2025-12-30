import type { Context } from '@pluxel/hmr'
import type { BridgeDefinition, CleanupFn, DispatchFn } from './types'
import type { BridgeStatusTracker } from '../status'

const toCleanup = (fn: CleanupFn): (() => void) | null => (typeof fn === 'function' ? fn : null)

const safeRun = (ctx: Context, label: string, fn?: (() => void) | null) => {
	if (!fn) return
	try {
		fn()
	} catch (e) {
		ctx.logger.warn(e, label)
	}
}

const startBridge = <P extends BridgeDefinition>(
	ctx: Context,
	def: P,
	dispatch: DispatchFn,
	status?: BridgeStatusTracker,
): (() => void) => {
	let disposed = false

	const attach = (instance: { ctx: Context }) => {
		if (disposed || !instance) return

		ctx.logger.debug({ platform: def.platform }, 'bot-layer: bridge attach')
		const detachInstance = toCleanup(def.attach(ctx, instance as any, dispatch as any))
		status?.setAttached(def.platform)

		// 通过平台实例的 scope 自动管理生命周期
		instance.ctx.scope.collectEffect(() => {
			safeRun(ctx, `bot-layer: ${def.platform} bridge detach 失败`, detachInstance)
			status?.setDetached(def.platform)
		})
	}

	// 监听平台 ready 事件
	const unlisten = ctx.events.on(def.event as any, attach)

	return () => {
		if (disposed) return
		disposed = true
		safeRun(ctx, `bot-layer: ${def.platform} bridge watcher 清理失败`, unlisten)
	}
}

export const startBridges = (
	ctx: Context,
	definitions: BridgeDefinition[],
	dispatch: DispatchFn,
	status?: BridgeStatusTracker,
): (() => void) => {
	const disposers: Array<() => void> = definitions.map((def) => startBridge(ctx, def, dispatch, status))

	return () => {
		while (disposers.length) {
			const dispose = disposers.pop()
			if (dispose) {
				safeRun(ctx, 'bot-layer: bridge runtime 清理失败', dispose)
			}
		}
	}
}
