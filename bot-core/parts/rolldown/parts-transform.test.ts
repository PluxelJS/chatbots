import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Rolldown } from 'tsdown'
import { partsTransformPlugin } from './parts-transform.ts'

const bundleToCode = async (entry: string) => {
	const bundle = await Rolldown.rolldown({
		input: entry,
		plugins: [partsTransformPlugin()],
		treeshake: false,
	})
	const generated = await bundle.generate({ format: 'es' })
	return generated.output.find((o) => o.type === 'chunk')?.code ?? ''
}

const createFixture = async (files: Record<string, string>) => {
	const root = await mkdtemp(path.join(tmpdir(), 'parts-transform-'))
	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(root, rel)
		await mkdir(path.dirname(abs), { recursive: true })
		await writeFile(abs, content, 'utf8')
	}
	return {
		path: (...sub: string[]) => path.join(root, ...sub),
		rm: async () => rm(root, { recursive: true, force: true }),
	}
}

const bundleSource = async (source: string) => {
	const fx = await createFixture({ 'entry.ts': source })
	try {
		return await bundleToCode(fx.path('entry.ts'))
	} finally {
		await fx.rm()
	}
}

const partsShim = `
const parts = (quasis: TemplateStringsArray, ...exprs: any[]) => exprs
`

describe('partsTransformPlugin (rolldown)', () => {
	test('basic', async () => {
		const code = await bundleSource(
			partsShim +
				`
const user = { id: 42 }
const mentionUser = (id: number) => ({ type: 'mention', kind: 'user', id } as const)
export const msg = parts\`Hello \${mentionUser(user.id)}!!!\`
`,
		)
		expect(code).not.toMatch(/\b__parts\(/)
		expect(code).toMatch(/text:\s*"Hello "/)
		expect(code).toMatch(/text:\s*"!!!"/)
	})

	test('no-hit', async () => {
		const code = await bundleSource(`export const x = 1`)
		expect(code).not.toMatch(/\b__parts\(/)
	})

	test('multiple tags', async () => {
		const code = await bundleSource(
			partsShim +
				`
export const a = { type: 'text', text: 'A' } as const
export const b = { type: 'text', text: 'B' } as const
export const msgA = parts\`a\${a}\`
export const msgB = parts\`b\${b}\`
`,
		)
		expect(code).not.toMatch(/\b__parts\(/)
		expect(code).toMatch(/text:\s*"a"/)
		expect(code).toMatch(/text:\s*"b"/)
	})

	test('preserves shebang', async () => {
		const code = await bundleSource(
			`#!/usr/bin/env node\n` +
				partsShim +
				`\nexport const msg = parts\`hi\`\n`,
		)
		expect(code).toMatch(/^#!\/usr\/bin\/env node/m)
		expect(code).not.toMatch(/\b__parts\(/)
	})

	test('preserves expression slice', async () => {
		const code = await bundleSource(
			partsShim +
				`
const user: any = { profile: { id: 'u-1' } }
export const msg = parts\`id=\${user?. profile.id}\`
`,
		)
		expect(code).not.toMatch(/\b__parts\(/)
		expect(code).toMatch(/\[\s*\{[\s\S]*text:\s*"id="[\s\S]*\}\s*,\s*user\?\.\s*profile\.id\s*\]/)
	})

	test('rejects type arguments at compile time', async () => {
		await expect(
			bundleSource(partsShim + `\nexport const msg = parts<string>\`hi\`\n`),
		).rejects.toThrow(/parts must not have type arguments/)
	})

	test('rejects call-expression at compile time', async () => {
		await expect(bundleSource(partsShim + `\nparts('x')\n`)).rejects.toThrow(
			/parts must be used as a tagged template/,
		)
	})
})
