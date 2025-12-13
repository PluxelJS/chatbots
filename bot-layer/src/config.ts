import { v } from '@pluxel/hmr/config'
import { BridgeConfigSchema } from './bridge'

export const BotLayerConfigSchema = v.object({
	cmdPrefix: v.pipe(v.optional(v.string(), '/'), v.minLength(1), v.maxLength(1)),
	bridges: v.optional(BridgeConfigSchema, {
		kook: { enabled: true },
		telegram: { enabled: true },
	}),
	debug: v.optional(v.boolean(), false),
	devCommands: v.optional(v.boolean(), true),
})

export type BotLayerConfig = v.InferOutput<typeof BotLayerConfigSchema>
