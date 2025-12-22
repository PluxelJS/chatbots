import { defineConfig } from 'tsdown'
import Macros from 'unplugin-macros/rolldown'

export default defineConfig({
	entry: {
		index: './src/kook.ts',
		api: './src/api/index.ts',
	},
	dts: {
		sourcemap: true,
	},
	plugins: [Macros()],
	format: ['esm'],
	env: {},
	copy: [
		// 'assets/**'
	],
	clean: true,
	minify: true,
	treeshake: true,
	// 供 pluxel-cli build 覆盖
	external: [],
})
