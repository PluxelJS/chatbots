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
	let detachInstance: (() => void) | null = null
	let disposeWatcher: (() => void) | null = null
	let disposed = false

	const detach = () => {
		if (!detachInstance) return
		safeRun(ctx, `bot-layer: ${def.platform} bridge detach 失败`, detachInstance)
		detachInstance = null
		status?.setDetached(def.platform)
	}

	const attach = (instance?: unknown) => {
		detach()
		if (!instance || disposed) return
		ctx.logger.debug({ platform: def.platform }, 'bot-layer: bridge attach')
		const res = def.attach(ctx, instance as any, dispatch as any)
		detachInstance = toCleanup(res)
		status?.setAttached(def.platform)
	}

	const watcher = def.watch(ctx, attach)
	disposeWatcher = toCleanup(watcher)

	return () => {
		if (disposed) return
		disposed = true
		detach()
		safeRun(ctx, `bot-layer: ${def.platform} bridge watcher 清理失败`, disposeWatcher)
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
