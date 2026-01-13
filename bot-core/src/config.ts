import { v } from '@pluxel/hmr/config'
import { BridgeConfigSchema } from './bridge'

export const BotCoreConfigSchema = v.object({
	bridges: v.optional(BridgeConfigSchema, {
		kook: { enabled: true },
		milky: { enabled: true },
		telegram: { enabled: true },
	}),
	debug: v.optional(v.boolean(), false),
})

export type BotCoreConfig = v.InferOutput<typeof BotCoreConfigSchema>
