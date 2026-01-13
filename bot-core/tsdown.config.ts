import { defineConfig } from 'tsdown'
import { partsTransformPlugin } from './parts/rolldown/parts-transform.ts'

export default defineConfig({
	entry: {
		index: './src/index.ts',
		'parts/index': './parts/index.ts',
		'parts/runtime': './parts/runtime.ts',
		'parts/rolldown': './parts/rolldown/parts-transform.ts',
		web: './src/web.ts',
	},
	dts: {
		sourcemap: true,
	},
	plugins: [partsTransformPlugin()],
	format: ['esm'],
	env: {},
	copy: [],
	clean: true,
	minify: true,
	treeshake: true,
	external: [],
})
