import { RpcTarget } from '@pluxel/hmr/capnweb'
import type { CreateBotInput, UpdateBotInput } from './bot-registry'
import type { KookRuntime } from '../runtime'

export class KOOKBotRpc extends RpcTarget {
	constructor(private readonly runtime: KookRuntime) {
		super()
	}

	overview() {
		return this.runtime.getOverview()
	}

	bots() {
		return this.runtime.getBotStatuses()
	}

	createBot(input: CreateBotInput) {
		return this.runtime.createBot(input)
	}

	connectBot(id: string) {
		return this.runtime.connectBot(id)
	}

	disconnectBot(id: string) {
		return this.runtime.disconnectBot(id)
	}

	deleteBot(id: string) {
		return this.runtime.deleteBot(id)
	}

	updateBot(id: string, patch: UpdateBotInput) {
		return this.runtime.updateBot(id, patch)
	}

	snapshot() {
		return this.runtime.snapshot()
	}
}
