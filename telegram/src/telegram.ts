import { BasePlugin, Config, Plugin } from '@pluxel/hmr'
import { v } from '@pluxel/hmr/config'

const CfgSchema = v.object({
  test: v.optional(v.boolean(), true),
})

@Plugin({ name: 'pluxel-plugin-telegram' })
export class Telegram extends BasePlugin {
  @Config(CfgSchema)
  private config!: Config<typeof CfgSchema>

  async init(_abort: AbortSignal): Promise<void> {
    this.ctx.logger.info('Telegram initialized')
  }

  async stop(_abort: AbortSignal): Promise<void> {
    this.ctx.logger.info('Telegram stopped')
  }
}

export default Telegram
