import { definePluginUIModule } from '@pluxel/hmr/web'
import { StatusPanel, SummaryPanel } from './components'

const module = definePluginUIModule({
	extensions: [
		{
			point: 'plugin:tabs',
			id: 'kook-tab-manage',
			priority: 12,
			meta: { label: '管理' },
			when: (ctx) => ctx.pluginName === 'KOOK',
			Component: StatusPanel,
		},
		{
			point: 'plugin:info',
			id: 'kook-info',
			priority: 10,
			requireRunning: false,
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
