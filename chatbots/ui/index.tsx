import { definePluginUIModule } from '@pluxel/hmr/web'
import { IconLayoutGrid, IconMessage2, IconShield } from '@tabler/icons-react'
import { ChatbotsSandboxPage } from './sandbox'
import { ChatbotsShowcasePage } from './showcase'
import { ChatbotsPermissionsPage } from './permissions'
import { ensureChatUiStyles } from './styles'

ensureChatUiStyles()

const module = definePluginUIModule({
	routes: [
		{
			definition: {
				path: '/sandbox',
				title: 'Chatbots Sandbox',
				icon: <IconMessage2 size={18} stroke={1.6} />,
				addToNav: true,
				navPriority: 45,
			},
			Component: ChatbotsSandboxPage,
		},
		{
			definition: {
				path: '/showcase',
				title: 'Chatbots Showcase',
				icon: <IconLayoutGrid size={18} stroke={1.6} />,
				addToNav: true,
				navPriority: 44,
			},
			Component: ChatbotsShowcasePage,
		},
		{
			definition: {
				path: '/permissions',
				title: 'Permissions',
				icon: <IconShield size={18} stroke={1.6} />,
				addToNav: true,
				navPriority: 43,
			},
			Component: ChatbotsPermissionsPage,
		},
	],
	setup() {
		console.log('[chatbots] sandbox UI loaded')
	},
})

export default module
