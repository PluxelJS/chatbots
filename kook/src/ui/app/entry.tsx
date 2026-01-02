import { definePluginUIModule, ExtensionPoints } from '@pluxel/hmr/web'

import { StatusPanel, SummaryPanel } from '../features/status/panels'

const module = definePluginUIModule({
	extensions: [
		{
			point: ExtensionPoints.PluginTabs,
			id: 'kook-tab-manage',
			priority: 12,
			meta: { label: '管理' },
			when: (ctx) => ctx.pluginName === 'KOOK',
			Component: StatusPanel,
		},
		{
			point: ExtensionPoints.PluginInfo,
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

