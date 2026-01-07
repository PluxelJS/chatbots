import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { Rolldown } from 'tsdown'
import { partsTransformPlugin } from './parts-transform.ts'

const bundleToCode = async (entry: string) => {
	const bundle = await Rolldown.rolldown({
		input: entry,
		plugins: [partsTransformPlugin()],
		external: ['@pluxel/bot-layer/parts/runtime'],
		treeshake: false,
	})
	const generated = await bundle.generate({ format: 'es' })
	return generated.output.find((o: any) => o.type === 'chunk')?.code ?? ''
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name: string) => path.join(fixturesDir, name)
const runtimeImportCount = (code: string) => (code.match(/@pluxel\/bot-layer\/parts\/runtime/g) ?? []).length

describe('parts-transform fixtures', () => {
	test('basic', async () => {
		const code = await bundleToCode(fixture('basic.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toContain('["Hello ", "!!!"]')
		expect(code).toMatch(/\[\s*user\.id\s*\]/)
	})

	test('no-hit', async () => {
		const code = await bundleToCode(fixture('no-hit.ts'))
		expect(runtimeImportCount(code)).toBe(0)
	})

	test('multiple tags (single runtime import)', async () => {
		const code = await bundleToCode(fixture('multiple.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toContain('["a", ""]')
		expect(code).toContain('["b", ""]')
		expect(code).toMatch(/\[\s*a\s*\]/)
		expect(code).toMatch(/\[\s*b\s*\]/)
	})

	test('reuses existing namespace import', async () => {
		const code = await bundleToCode(fixture('existing-ns-import.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toMatch(/import \* as R from ["']@pluxel\/bot-layer\/parts\/runtime["']/)
		expect(code).toMatch(/\bR\.__parts\(/)
	})

	test('reuses existing named import', async () => {
		const code = await bundleToCode(fixture('existing-named-import.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toMatch(/import \{ __parts \} from ["']@pluxel\/bot-layer\/parts\/runtime["']/)
		expect(code).toMatch(/\b__parts\(\["hi ", ""\],\s*\[user\]\)/)
		expect(code).not.toMatch(/\.__parts\(/)
	})

	test('inserts import after shebang', async () => {
		const code = await bundleToCode(fixture('shebang.ts'))
		expect(code).toMatch(/^#!\/usr\/bin\/env node\nimport .*@pluxel\/bot-layer\/parts\/runtime/m)
	})

	test('preserves expression slice', async () => {
		const code = await bundleToCode(fixture('expression-slice.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toContain('["id=", ""]')
		expect(code).toMatch(/\[\s*user\?\.\s*profile\.id\s*\]/)
	})

	test('allows optional chain member expression', async () => {
		const code = await bundleToCode(fixture('allowed-optional-chain.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toContain('["id=", ""]')
		expect(code).toMatch(/\[\s*user\?\.\s*profile\?\.\s*id\s*\]/)
	})

	test('allows optional mention builder call', async () => {
		const code = await bundleToCode(fixture('allowed-optional-mention.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toMatch(/mentionUser\(/)
	})

	test('allows namespace builder call', async () => {
		const code = await bundleToCode(fixture('allowed-ns-call.ts'))
		expect(runtimeImportCount(code)).toBe(1)
		expect(code).toMatch(/p\.mentionUser\(/)
		expect(code).toMatch(/p\.link\(/)
	})

	test('rejects type arguments at compile time', async () => {
		await expect(bundleToCode(fixture('type-args.ts'))).rejects.toThrow(/parts must not have type arguments/)
	})

	test('rejects call-expression at compile time', async () => {
		await expect(bundleToCode(fixture('call-expression.ts'))).rejects.toThrow(/parts must be used as a tagged template/)
	})

	test('rejects binary expressions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-binary.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects logical expressions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-logical.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects TS "as" expressions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-ts-as.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects sequence expressions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-sequence.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects object expressions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-object.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects array expressions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-array.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects nested template literals in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-template.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects arrow functions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-arrow.ts'))).rejects.toThrow(/illegal expression/)
	})

	test('rejects conditional expressions in ${}', async () => {
		await expect(bundleToCode(fixture('illegal-conditional.ts'))).rejects.toThrow(/illegal expression/)
	})
})
