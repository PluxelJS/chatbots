import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: './bot-layer.ts',
		chatbots: './chatbots.ts',
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
