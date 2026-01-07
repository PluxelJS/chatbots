import { BasePlugin, Plugin } from '@pluxel/core'
import type {} from '@pluxel/hmr/services'
import { Config as UseConfig, type Config as InferConfig } from '@pluxel/hmr'
import { WretchPlugin } from 'pluxel-plugin-wretch'
import { MilkyConfig, type MilkyConfigType } from './config'
import { MilkyRuntime, type MilkySnapshot } from './runtime'
import { registerMilkyExtensions } from './extensions'
import type { MilkyBotRpc } from './runtime/rpc'

export * from './api'
export * from './bot'
export * from './events'
export type { MilkySnapshot }

@Plugin({ name: 'Milky', type: 'service', startTimeoutMs: 10_000 })
export class Milky extends BasePlugin {
	@UseConfig(MilkyConfig) private config!: InferConfig<MilkyConfigType>

	public readonly runtime: MilkyRuntime

	constructor(wretch: WretchPlugin) {
		super()
		this.runtime = new MilkyRuntime(wretch)
	}

	override async init(abort: AbortSignal): Promise<void> {
		await this.runtime.bootstrap(this.ctx, this.config, abort)
		if (abort.aborted) return
		registerMilkyExtensions({ ctx: this.ctx, runtime: this.runtime })
		this.ctx.events.emit('milky:ready', this)
	}

	override async stop(): Promise<void> {
		await this.runtime.teardown()
	}

	getOverview() {
		return this.runtime.getOverview()
	}

	getBotStatuses() {
		return this.runtime.getBotStatuses()
	}

	createBot(...args: Parameters<MilkyRuntime['createBot']>) {
		return this.runtime.createBot(...args)
	}

	connectBot(...args: Parameters<MilkyRuntime['connectBot']>) {
		return this.runtime.connectBot(...args)
	}

	disconnectBot(...args: Parameters<MilkyRuntime['disconnectBot']>) {
		return this.runtime.disconnectBot(...args)
	}

	deleteBot(...args: Parameters<MilkyRuntime['deleteBot']>) {
		return this.runtime.deleteBot(...args)
	}

	updateBot(...args: Parameters<MilkyRuntime['updateBot']>) {
		return this.runtime.updateBot(...args)
	}

	snapshot() {
		return this.runtime.snapshot()
	}
}

declare module '@pluxel/hmr/services' {
	namespace UI {
		interface rpc {
			Milky: MilkyBotRpc
		}
		interface sse {
			Milky: MilkySnapshot
		}
	}
}

declare module '@pluxel/core/services' {
	interface Events {
		'milky:ready': [Milky]
	}
}
