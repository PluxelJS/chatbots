import { definePluginUIModule, ExtensionPoints } from '@pluxel/hmr/web'

import { ManageTab, SummaryPanel } from '../features/manage/panels'

const module = definePluginUIModule({
	extensions: [
		{
			point: ExtensionPoints.PluginTabs,
			id: 'milky-tab-manage',
			priority: 12,
			meta: { label: '管理' },
			render: () => <ManageTab />,
		},
		{
			point: ExtensionPoints.PluginInfo,
			id: 'milky-info',
			priority: 10,
			requireRunning: false,
			render: () => <SummaryPanel />,
		},
	],
	setup() {},
})

export const { extensions, setup } = module
export default module
