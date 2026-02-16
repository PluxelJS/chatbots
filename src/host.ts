import { createHmrHost } from '@pluxel/hmr/host'
import Macro from 'unplugin-macros/vite'
import { partsTransformVitePlugin } from 'pluxel-plugin-bot-core/parts/rolldown'

const { ctx } = await createHmrHost({
	debug: ['pluxel:hmr:*'],
	profile: process.env.PLUXEL_HMR_PROFILE,
	configPath: process.env.PLUXEL_HMR_CONFIG,
	store: {
		seedConfig: 'default.json',
	},
	vitePlugins: [Macro() as any, partsTransformVitePlugin()],
	cjsExternal: ['pluxel-plugin-napi-rs/*', '@napi-rs/*', '@memecrafters/meme-generator'],
	registry: {},
})

await ctx.root.hmrService.start()

ctx.logger.info`HMR host ready`

