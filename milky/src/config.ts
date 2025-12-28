import { f, v } from '@pluxel/hmr/config'

export const MilkyEventTransport = ['sse', 'ws'] as const
export type MilkyEventTransport = (typeof MilkyEventTransport)[number]

export const MilkyConfig = v.object({
	autoConnect: v.pipe(
		v.optional(v.boolean(), true),
		f.formMeta({
			label: '启动时自动连接已保存 Bot',
			description: '开启后会在 Milky 插件启动时自动连接 registry 中所有 Bot',
		}),
		f.booleanMeta({ variant: 'switch' }),
	),
	defaultTransport: v.pipe(
		v.optional(v.picklist(MilkyEventTransport), 'sse'),
		f.formMeta({ label: '默认事件连接方式', description: '新建 Bot 的默认事件接入方式（SSE / WebSocket）' }),
		f.picklistMeta({
			variant: 'segmented',
			labels: { sse: 'SSE', ws: 'WebSocket' },
		}),
	),
})

export type MilkyConfigType = typeof MilkyConfig

