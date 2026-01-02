import { definePluginUIModule, ExtensionPoints } from '@pluxel/hmr/web'

import { ManageTab, SummaryPanel } from '../features/manage/panels'

const module = definePluginUIModule({
	extensions: [
		{
			point: ExtensionPoints.PluginTabs,
			id: 'milky-tab-manage',
			priority: 12,
			meta: { label: '管理' },
			when: (ctx) => ctx.pluginName === 'Milky',
			Component: ManageTab,
		},
		{
			point: ExtensionPoints.PluginInfo,
			id: 'milky-info',
			priority: 10,
			requireRunning: false,
			when: (ctx) => ctx.pluginName === 'Milky',
			Component: SummaryPanel,
		},
	],
	setup() {
		console.log('[Milky] status UI loaded')
	},
})

export const { extensions, setup } = module
export default module

