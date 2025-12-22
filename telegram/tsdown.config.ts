import { defineConfig } from 'tsdown'
import Macros from 'unplugin-macros/rolldown'

export default defineConfig({
	entry: {
		index: './src/telegram.ts',
		api: './src/api/index.ts'
	},
	dts: {
		sourcemap: true,
	},
	plugins: [Macros()],
	format: ['esm'],
	env: {},
	copy: [],
	clean: true,
	minify: true,
	treeshake: true,
	external: [],
})
