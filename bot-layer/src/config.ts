import { v } from '@pluxel/hmr/config'
import { BridgeConfigSchema } from './bridge'

export const BotLayerConfigSchema = v.object({
	bridges: v.optional(BridgeConfigSchema, {
		kook: { enabled: true },
		telegram: { enabled: true },
	}),
	debug: v.optional(v.boolean(), false),
})

export type BotLayerConfig = v.InferOutput<typeof BotLayerConfigSchema>
