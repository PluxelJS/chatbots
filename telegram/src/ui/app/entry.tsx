import { definePluginUIModule, ExtensionPoints } from '@pluxel/hmr/web'

import { ManageTab, SummaryPanel } from '../features/manage/panels'

const module = definePluginUIModule({
	extensions: [
		{
			point: ExtensionPoints.PluginTabs,
			id: 'telegram-tab-manage',
			priority: 10,
			meta: { label: '管理' },
			render: () => <ManageTab />,
		},
		{
			point: ExtensionPoints.PluginInfo,
			id: 'telegram-summary',
			priority: 12,
			requireRunning: false,
			render: () => <SummaryPanel />,
		},
	],
	setup() {},
})

export const { extensions, setup } = module
export default module
