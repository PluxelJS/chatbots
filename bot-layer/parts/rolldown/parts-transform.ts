import MagicString from 'magic-string'

export type PartsTransformPluginOptions = {
	tag?: string
	runtimeModule?: string
	runtimeExport?: string
}

const DEFAULT_ID_FILTER = {
	include: [/\.(m?js|[cm]?ts)x?(?:\?.*)?$/],
	exclude: [/node_modules/, /\\node_modules\\/, /\0/],
} as const

const findShebangEnd = (code: string): number => {
	if (!code.startsWith('#!')) return 0
	const newline = code.indexOf('\n')
	return newline === -1 ? code.length : newline + 1
}

const hasIdentifier = (code: string, ident: string): boolean => new RegExp(`\\b${ident.replaceAll('$', '\\\\$')}\\b`).test(code)

const pickLocalName = (code: string, base: string): string => {
	if (!hasIdentifier(code, base)) return base
	for (let i = 0; i < 1000; i++) {
		const candidate = `${base}$${i}`
		if (!hasIdentifier(code, candidate)) return candidate
	}
	return `${base}$${Date.now().toString(36)}`
}

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

const stripWrappers = (node: any): any => {
	let n = node
	while (n?.type === 'ParenthesizedExpression' || n?.type === 'ChainExpression') n = n.expression
	return n
}

const ALLOWED_VALUE_CALLS = new Set([
	'mentionUser',
	'mentionRole',
	'mentionChannel',
	'mentionEveryone',
	'image',
	'imageData',
	'file',
	'fileData',
	'link',
	'codeblock',
	'bold',
	'italic',
	'underline',
	'code',
	'strike',
])

const isAllowedValueCallee = (node: any): boolean => {
	const callee = stripWrappers(node)
	if (!callee) return false
	if (callee.type === 'Identifier') return ALLOWED_VALUE_CALLS.has(callee.name)

	// Allow namespace calls, e.g. `p.link(url)` / `dsl.mentionUser(id)`
	if (callee.type === 'MemberExpression') {
		if (callee.computed) return false
		if (callee.object?.type !== 'Identifier') return false
		return callee.property?.type === 'Identifier' && ALLOWED_VALUE_CALLS.has(callee.property.name)
	}

	return false
}

const isAllowedValueExpr = (node: any): boolean => {
	const n = stripWrappers(node)
	if (!n) return false

	switch (n.type) {
		case 'Identifier':
		case 'MemberExpression':
			return true
		case 'Literal':
			return n.value === null || typeof n.value === 'string' || typeof n.value === 'number'
		case 'StringLiteral':
		case 'NumericLiteral':
		case 'NullLiteral':
			return true

		case 'CallExpression': {
			return isAllowedValueCallee(n.callee)
		}

		default:
			return false
	}
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

export const partsTransformPlugin = (options: PartsTransformPluginOptions = {}) => {
	const tag = options.tag ?? 'parts'
	const runtimeModule = options.runtimeModule ?? '@pluxel/bot-layer/parts/runtime'
	const runtimeExport = options.runtimeExport ?? '__parts'

	return {
		name: 'pluxel:parts-transform',
		transform: {
			filter: { id: DEFAULT_ID_FILTER },
			handler(this: any, code: string, id: string, meta?: any) {
				if (typeof id !== 'string') return null
				if (id.startsWith('\0')) return null
				// Fast path: avoid parsing when clearly unrelated.
				if (!code.includes(tag)) return null

				const ast = (meta?.ast ?? this.parse?.(code)) as any
				if (!ast) return null
				const magicString = new MagicString(code)

				let runtimeLocal: string | null = null
				let runtimeNamespaceLocal: string | null = null
				let runtimeImportDecl: any | null = null

				for (const stmt of (ast as any).body ?? []) {
					if (stmt?.type !== 'ImportDeclaration') continue
					if (stmt?.source?.value !== runtimeModule) continue
					runtimeImportDecl = stmt
					for (const spec of stmt.specifiers ?? []) {
						if (spec?.type === 'ImportNamespaceSpecifier') {
							runtimeNamespaceLocal = spec.local?.name ?? null
							continue
						}
						if (spec?.type !== 'ImportSpecifier') continue
						if (spec?.imported?.type !== 'Identifier') continue
						if (spec.imported.name !== runtimeExport) continue
						runtimeLocal = spec.local?.name ?? runtimeExport
						break
					}
					if (runtimeLocal) break
				}

				walk(ast, (node) => {
					if (node.type !== 'TaggedTemplateExpression') return
					if (node.tag?.type === 'Identifier' && node.tag.name === tag && node.typeArguments) {
						this.error('bot-layer: parts must not have type arguments')
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
						this.error('bot-layer: parts must be used as a tagged template')
					}
				})

				if (!hits.length) return null

				for (const node of hits) {
					for (const expr of node.quasi?.expressions ?? []) {
						if (isAllowedValueExpr(expr)) continue
						const span = getSpan(expr)
						const snippet = code.slice(span.start, span.end)
						this.error(`bot-layer: illegal expression in parts template: ${snippet}`)
					}
				}

				const callExpr =
					runtimeLocal ? (args: string) => `${runtimeLocal}(${args})` : null
				const nsLocal =
					runtimeLocal || runtimeNamespaceLocal ? null : pickLocalName(code, '__parts$0')
				const nsName = runtimeNamespaceLocal ?? nsLocal
				const nsCallExpr = nsLocal ? (args: string) => `${nsLocal}.${runtimeExport}(${args})` : null
				const importNsCallExpr = runtimeNamespaceLocal
					? (args: string) => `${runtimeNamespaceLocal}.${runtimeExport}(${args})`
					: null

				for (const node of hits) {
					const quasis: string[] = (node.quasi?.quasis ?? []).map((q: any) => q?.value?.cooked ?? '')
					const exprs: string[] = (node.quasi?.expressions ?? []).map((e: any) => {
						const span = getSpan(e)
						return code.slice(span.start, span.end)
					})

					const cookedArray = `[${quasis.map((s) => JSON.stringify(s)).join(',')}]`
					const exprArray = `[${exprs.join(',')}]`

					const args = `${cookedArray},${exprArray}`
					const replacement = callExpr
						? callExpr(args)
						: importNsCallExpr
							? importNsCallExpr(args)
							: (nsCallExpr as (args: string) => string)(args)
					const span = getSpan(node)
					magicString.overwrite(span.start, span.end, replacement)
				}

				if (!runtimeLocal && !runtimeNamespaceLocal) {
					const importLine = `import * as ${nsName} from ${JSON.stringify(runtimeModule)};\n`
					if (runtimeImportDecl) {
						const insertAt = getSpan(runtimeImportDecl).end
						magicString.appendRight(insertAt, `\n${importLine}`)
					} else {
						const insertAt = findShebangEnd(code)
						magicString.prependLeft(insertAt, importLine)
					}
				}

				return {
					code: magicString.toString(),
					map: magicString.generateMap({ hires: true }),
				}
			},
		},
	}
}
