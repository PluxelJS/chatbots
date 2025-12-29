import { f, v } from '@pluxel/hmr/config'

export const MilkyConfig = v.object({
	autoConnect: v.pipe(
		v.optional(v.boolean(), true),
		f.formMeta({
			label: '启动时自动连接已保存 Bot',
			description: '开启后会在 Milky 插件启动时自动连接 registry 中所有 Bot',
		}),
		f.booleanMeta({ variant: 'switch' }),
	),
})

export type MilkyConfigType = typeof MilkyConfig
