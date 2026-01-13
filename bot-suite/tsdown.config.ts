import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: './src/index.ts',
		core: './src/bot-core.ts',
		'core/parts': './src/bot-core/parts.ts',
		'core/parts/runtime': './src/bot-core/parts/runtime.ts',
		'core/parts/rolldown': './src/bot-core/parts/rolldown.ts',
		'core/web': './src/bot-core/web.ts',
	},
	dts: {
		sourcemap: true,
	},
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
