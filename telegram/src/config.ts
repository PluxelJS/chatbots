import { f, v } from '@pluxel/hmr/config'

/** 主配置 schema */
export const TelegramConfig = v.object({
	apiBase: v.pipe(
		v.optional(v.pipe(v.string(), v.url()), 'https://api.telegram.org'),
		f.formMeta({ label: 'API 基础 URL', description: '可用于代理服务器' }),
		f.stringMeta({ placeholder: 'https://api.telegram.org' }),
	),
	syncCommands: v.pipe(
		v.optional(v.boolean(), true),
		f.formMeta({ label: '自动同步指令', description: '启动时自动将注册的指令同步到 Telegram' }),
		f.booleanMeta({ variant: 'switch' }),
	),
})

export type TelegramConfigType = typeof TelegramConfig
