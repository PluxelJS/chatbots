// KyPlugin.ts

import { BasePlugin, Config, Plugin } from '@pluxel/hmr'
import { f, v } from '@pluxel/hmr/config'
import type { HttpClient } from 'pluxel-plugin-wretch'
// biome-ignore lint/style/useImportType: <explanation>
import { middlewares, WretchPlugin } from 'pluxel-plugin-wretch'
import { Bot } from './bot'
import { createCommandBus, defineCommand, defineFor } from './cmd'
import { createCommandKit } from './cmd/kit'
import { createKookChannel } from './events'
import type { MessageSession } from './types'

export * from './types'

const BotConfig = v.object({
	cmdPrefix: v.pipe(v.optional(v.string(), '/'), v.minLength(1), v.maxLength(1)),
	bots: v.pipe(
		v.record(v.string(), v.boolean()),
		f.recordMeta({
			valueMode: 'boolean',
			keyPlaceholder: 'token',
			valuePlaceholder: 'Webhook',
		}),
	),
})

export type Bots = Record<string, Bot>
type CMDCTX = MessageSession
@Plugin({ name: 'KOOKBOT' })
export class KOOKBOT extends BasePlugin {
	@Config(BotConfig) private config!: Config<typeof BotConfig>

	/** 共享实例：其他插件直接用它 */
	public baseClient: HttpClient
	public bots: Bots = {}
	private readonly events = createKookChannel(this.ctx)
	private readonly bus = createCommandBus<CMDCTX>({
		/* prefix 可选 */
	})
	public readonly cmd = createCommandKit<CMDCTX>(this.bus)

	constructor(wretch: WretchPlugin) {
		super()
		const base = wretch.createClient({
			baseUrl: 'https://www.kookapp.cn',
			throwHttpErrors: true,
		})
		this.baseClient = base.middlewares([
			middlewares.retry({
				maxAttempts: 2,
				retryOnNetworkError: true,
			}),
		])
	}

	async init(_abort: AbortSignal): Promise<void> {
		// 指令处理器
		this.events.message.on((session, next) => {
			const msg = session.data.content
			if (msg[0] !== this.config.cmdPrefix) return next(session)

			this.bus
				.dispatch(msg.slice(1), session)
				.catch((e) => this.ctx.logger.error(e, `执行 ${msg} 遇到以下问题：`))

			return undefined
		})

		// 内置 /help
		this.cmd
			.reg('help')
			.describe('查看帮助')
			.action(() => this.cmd.help())

		for (const token in this.config.bots) {
			new Bot(
				this.baseClient.headers({ Authorization: `Bot ${token}` }),
				this.bots,
				this.ctx,
				this.events,
			)
		}
	}

	async stop(abort: AbortSignal): Promise<void> {
		for (const bot of Object.values(this.bots)) {
			await bot.stop()
		}
	}
}
