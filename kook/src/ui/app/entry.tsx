import { definePluginUIModule, ExtensionPoints } from '@pluxel/hmr/web'

import { StatusPanel, SummaryPanel } from '../features/status/panels'

const module = definePluginUIModule({
	extensions: [
		{
			point: ExtensionPoints.PluginTabs,
			id: 'kook-tab-manage',
			priority: 12,
			meta: { label: '管理' },
			render: () => <StatusPanel />,
		},
		{
			point: ExtensionPoints.PluginInfo,
			id: 'kook-info',
			priority: 10,
			requireRunning: false,
			render: () => <SummaryPanel />,
		},
	],
	setup() {},
})

export const { extensions, setup } = module
export default module
