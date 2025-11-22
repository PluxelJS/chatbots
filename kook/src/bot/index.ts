import type { Context } from '@pluxel/hmr'
import type { HttpClient } from 'pluxel-plugin-wretch'
import { internalWebhook } from '../event-trigger'
import type { Bots } from '../kook'
import type { User } from '../types'
import { AbstractBot } from './api'
import { KookGatewayClient } from './websocket'
import type { KookChannel } from '../events'

export class Bot extends AbstractBot {
	public selfInfo!: User
	client?: KookGatewayClient

	constructor(
		public http: HttpClient,
		private bots: Bots,
		private ctx: Context,
		private events: KookChannel,
	) {
		super()

		this.start()
			.then((id) => {
				this.bots[id] = this
			})
			.catch((e) => {
				ctx.logger.error(e, '机器人启动失败')
				this.stop().catch()
			})
	}

	private async start() {
		const res = await this.getUserMe()
		if (res.ok ===false) throw new Error(res.message)
			this.selfInfo = res.data
		const client = new KookGatewayClient({
			compress: 0,
			getGatewayUrl: async ({ resume, sn, session_id, compress }) => {
				const gateway = await this.getGateway({ compress })
				if (gateway.ok === false) throw new Error(gateway.message)
				const u = new URL(gateway.data.url)
				if (resume) {
					u.searchParams.set('resume', '1')
					u.searchParams.set('sn', String(sn ?? 0))
					if (session_id) u.searchParams.set('session_id', session_id)
				}
				return u.toString()
			},
			onEvent: (sn, data) => {
				/* 你自己的业务处理（已按 SN 有序） */
				internalWebhook(this.events, this.ctx, this, data)
			},
			onError: (e) => this.ctx.logger.error(e),
			onStateChange: (prev, next, meta) => {
				this.ctx.logger.info(meta, `[state] ${prev} -> ${next}`) // ← 明确看到每一步
			},
		})
		await client.start()
		this.client = client
		return this.selfInfo.id
	}

	async stop() {
		await this.client?.stop()
		await this.offline()
		this.ctx.logger.info('机器人已停止。')
	}
}
