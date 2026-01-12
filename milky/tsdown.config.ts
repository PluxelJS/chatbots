import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: {
		index: './src/milky.ts',
		api: './src/api/index.ts',
	},
	dts: {
		sourcemap: true,
	},
	plugins: [],
	format: ['esm'],
	env: {},
	copy: [],
	clean: true,
	minify: true,
	treeshake: true,
	// 供 pluxel-cli build 覆盖
	external: [],
})
