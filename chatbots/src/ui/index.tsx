import { definePluginUIModule } from '@pluxel/hmr/web'
import { IconLayoutGrid, IconMessage2, IconShield } from '@tabler/icons-react'
import { ChatbotsSandboxPage } from './features/sandbox/page'
import { ChatbotsShowcasePage } from './features/showcase/page'
import { ChatbotsPermissionsPage } from './features/permissions/page'
import { ensureChatUiStyles } from './shared/styles/chatui'

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
			render: () => <ChatbotsSandboxPage />,
		},
		{
			definition: {
				path: '/showcase',
				title: 'Chatbots Showcase',
				icon: <IconLayoutGrid size={18} stroke={1.6} />,
				addToNav: true,
				navPriority: 44,
			},
			render: () => <ChatbotsShowcasePage />,
		},
		{
			definition: {
				path: '/permissions',
				title: 'Permissions',
				icon: <IconShield size={18} stroke={1.6} />,
				addToNav: true,
				navPriority: 43,
			},
			render: () => <ChatbotsPermissionsPage />,
		},
	],
})

export default module
