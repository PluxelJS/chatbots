import { f, v } from '@pluxel/hmr/config'

export const BotMode = ['gateway', 'webhook', 'api'] as const
export type BotMode = (typeof BotMode)[number]

const sections = {
	basic: '基础设置',
	webhook: 'Webhook 接入',
} as const

export const common = v.object({
	cmdPrefix: v.pipe(
		v.optional(v.string(), '/'),
		v.minLength(1),
		v.maxLength(1),
		f.formMeta({ label: '指令前缀', description: '用于识别指令的前缀字符', section: sections.basic }),
		f.stringMeta({ placeholder: '/' }),
	),
	apiBase: v.pipe(
		v.optional(v.pipe(v.string(), v.url()), 'https://www.kookapp.cn'),
		f.formMeta({ label: 'API 基础 URL', description: '覆盖默认 KOOK API 域名', section: sections.basic }),
		f.stringMeta({ placeholder: 'https://www.kookapp.cn' }),
	),
	path: v.pipe(
		v.optional(v.string(), '/kook/webhook'),
		f.formMeta({
			label: 'Webhook 路径',
			description: '监听路径，例如 /kook/webhook',
			section: sections.webhook,
		}),
	),
})
export const KookConfig = v.object({
	common,
	autoConnect: v.pipe(
		v.optional(v.boolean(), true),
		f.formMeta({ label: '启动时自动连接已保存 Bot', description: '开启后会在 KOOK 插件启动时自动连接 registry 中所有 Bot' }),
		f.booleanMeta({ variant: 'switch' }),
	),
})

export type KookConfigType = typeof KookConfig
