import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: './src/index.ts',
		'jsx-runtime': './src/jsx-runtime.ts',
		web: './src/web.ts',
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
