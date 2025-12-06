import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: './src/telegram.ts',
		api: './src/api/index.ts'
	},
	dts: {
		sourcemap: true,
	},
	format: ['esm'],
	env: {},
	copy: [],
	clean: true,
	minify: true,
	treeshake: true,
	external: [],
})
