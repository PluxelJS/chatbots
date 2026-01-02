import { definePluginUIModule, ExtensionPoints } from '@pluxel/hmr/web'

import { ManageTab, SummaryPanel } from '../features/manage/panels'

const module = definePluginUIModule({
	extensions: [
		{
			point: ExtensionPoints.PluginTabs,
			id: 'telegram-tab-manage',
			priority: 10,
			meta: { label: '管理' },
			when: (ctx) => ctx.pluginName === 'Telegram',
			Component: ManageTab,
		},
		{
			point: ExtensionPoints.PluginInfo,
			id: 'telegram-summary',
			priority: 12,
			requireRunning: false,
			when: (ctx) => ctx.pluginName === 'Telegram',
			Component: SummaryPanel,
		},
	],
	setup() {
		console.log('[Telegram] status UI loaded')
	},
})

export const { extensions, setup } = module
export default module

