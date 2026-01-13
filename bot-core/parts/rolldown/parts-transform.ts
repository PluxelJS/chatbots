const PARTS_TRANSFORM_ID_FILTER = {
	include: [/\.(m?js|[cm]?ts)x?(?:\?.*)?$/],
	exclude: [/node_modules/, /\\node_modules\\/, /\0/],
} as const

type Span = { start: number; end: number }

const getSpan = (node: any): Span => {
	if (!node || typeof node !== 'object') return { start: 0, end: 0 }
	const span = node.span ?? node
	const start =
		typeof span.start === 'number'
			? span.start
			: Array.isArray(span.range) && typeof span.range[0] === 'number'
				? span.range[0]
				: typeof node.start === 'number'
					? node.start
					: 0
	const end =
		typeof span.end === 'number'
			? span.end
			: Array.isArray(span.range) && typeof span.range[1] === 'number'
				? span.range[1]
				: typeof node.end === 'number'
					? node.end
					: start
	return { start, end }
}

const walk = (root: any, visit: (node: any) => void) => {
	const stack: any[] = [root]
	while (stack.length) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) stack.push(node[i])
			continue
		}
		if (typeof node !== 'object') continue

		if (typeof node.type === 'string') visit(node)

		for (const key of Object.keys(node)) {
			if (key === 'parent') continue
			const value = (node as any)[key]
			if (value && typeof value === 'object') stack.push(value)
		}
	}
}

const matchIdFilter = (id: string) => {
	for (const re of PARTS_TRANSFORM_ID_FILTER.exclude) {
		if (re.test(id)) return false
	}
	for (const re of PARTS_TRANSFORM_ID_FILTER.include) {
		if (re.test(id)) return true
	}
	return false
}

type Replacement = { start: number; end: number; replacement: string }

const computePartsReplacements = (opts: {
	code: string
	id: string
	ast: any
	tag?: string
	error: (msg: string) => never
}): Replacement[] | null => {
	const tag = opts.tag ?? 'parts'
	const { code, id, ast, error } = opts

	if (typeof id !== 'string') return null
	if (id.startsWith('\0')) return null
	if (!matchIdFilter(id)) return null
	if (!code.includes(tag)) return null
	if (!ast) return null

	walk(ast, (node) => {
		if (node.type !== 'TaggedTemplateExpression') return
		if (node.tag?.type === 'Identifier' && node.tag.name === tag && node.typeArguments) {
				error('bot-core: parts must not have type arguments')
		}
	})

	const hits: any[] = []
	walk(ast, (node) => {
		if (node.type !== 'TaggedTemplateExpression') return
		if (node.typeArguments) return
		if (node.tag?.type !== 'Identifier' || node.tag.name !== tag) return
		hits.push(node)
	})

	walk(ast, (node) => {
		if (node.type !== 'CallExpression') return
		if (node.callee?.type === 'Identifier' && node.callee.name === tag) {
				error('bot-core: parts must be used as a tagged template')
		}
	})

	if (!hits.length) return null

	const replacements: Replacement[] = []
	for (const node of hits) {
		const quasis: string[] = (node.quasi?.quasis ?? []).map((q: any) => q?.value?.cooked ?? '')
		const exprNodes: any[] = node.quasi?.expressions ?? []

		const span = getSpan(node)

		const elements: string[] = []
		let textBuf = ''

		const flushText = () => {
			if (!textBuf) return
			elements.push(`{type:"text",text:${JSON.stringify(textBuf)}}`)
			textBuf = ''
		}

		const n = quasis.length
		for (let i = 0; i < n; i++) {
			textBuf += quasis[i] ?? ''
			if (i < exprNodes.length) {
				const expr = exprNodes[i]
				const rawSpan = getSpan(expr)
				const rawExpr = code.slice(rawSpan.start, rawSpan.end)
				flushText()
				elements.push(rawExpr)
			}
		}

			flushText()
			const replacement = elements.length ? `[${elements.join(',')}]` : '[]'
		replacements.push({ start: span.start, end: span.end, replacement })
	}

	return replacements
}

export const partsTransformPlugin = () => {
	return {
		name: 'pluxel:parts-transform',
		transform: {
			filter: { id: PARTS_TRANSFORM_ID_FILTER },
			handler(this: any, code: string, id: string, meta?: any) {
				const ast = (meta?.ast ?? this.parse?.(code)) as any
				const raise = (msg: string): never => {
					this.error?.(msg)
					throw new Error(msg)
				}
				const replacements = computePartsReplacements({
					code,
					id,
					ast,
					error: raise,
				})
				if (!replacements?.length) return null

				const magicString = meta?.magicString
				if (magicString) {
					for (const r of replacements.slice().sort((a, b) => b.start - a.start)) {
						magicString.overwrite(r.start, r.end, r.replacement)
					}
					return { code: magicString }
				}

				let out = code
				for (const r of replacements.slice().sort((a, b) => b.start - a.start)) {
					out = out.slice(0, r.start) + r.replacement + out.slice(r.end)
				}
				return { code: out, map: null }
			},
		},
	}
}

export const partsTransformVitePlugin = () =>
	({
		name: 'pluxel:parts-transform',
		// Run after TS/TSX/JSX is lowered so Rollup's parser can handle the code.
		enforce: 'post',
		transform(code: string, id: string) {
			if (!this.parse) return null
			// IMPORTANT: Vite will call `transform()` for non-JS assets too (e.g. `*.css?direct`).
			// Never try to parse those with the JS parser.
			if (!matchIdFilter(id)) return null
			if (!code.includes('parts')) return null
			const ast = this.parse(code) as any
			const raise = (msg: string): never => {
				this.error?.(msg)
				throw new Error(msg)
			}
			const replacements = computePartsReplacements({
				code,
				id,
				ast,
				error: raise,
			})
			if (!replacements?.length) return null
			let out = code
			for (const r of replacements.slice().sort((a, b) => b.start - a.start)) {
				out = out.slice(0, r.start) + r.replacement + out.slice(r.end)
			}
			return { code: out, map: null }
		},
	}) as any
