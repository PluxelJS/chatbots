import { definePluginUIModule } from '@pluxel/hmr/web'
import { HeaderIndicator, StatusPanel, SummaryPanel } from './components'

const module = definePluginUIModule({
	extensions: [
		{
			point: 'header:actions',
			meta: { priority: 40, id: 'KOOK:header' },
			when: (ctx) => ctx.pluginName === 'KOOK',
			Component: HeaderIndicator,
		},
		{
			point: 'plugin:tabs',
			meta: { priority: 12, label: '管理', id: 'KOOK:tabs:manage' },
			when: (ctx) => ctx.pluginName === 'KOOK',
			Component: StatusPanel,
		},
		{
			point: 'plugin:info',
			meta: { priority: 10, id: 'KOOK:info', requireRunning: false },
			when: (ctx) => ctx.pluginName === 'KOOK',
			Component: SummaryPanel,
		},
	],
	setup() {
		console.log('[KOOK] status UI loaded')
	},
})

export const { extensions, setup } = module
export default module
