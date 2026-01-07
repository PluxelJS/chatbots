import type { Part } from './model'

const pushText = (acc: Part[], text: string) => {
	if (!text) return
	const prev = acc[acc.length - 1]
	if (prev?.type === 'text') {
		prev.text += text
		return
	}
	acc.push({ type: 'text', text })
}

/**
 * Runtime for `parts\`...\`` after transform.
 *
 * - `quasis` must be cooked strings (no `raw`)
 * - `exprs` are `Part` values and are passed through unchanged
 */
export const __parts = (quasis: readonly string[], exprs: readonly Part[]): Part[] => {
	const acc: Part[] = []

	const n = quasis.length
	for (let i = 0; i < n; i++) {
		pushText(acc, quasis[i] ?? '')
		if (i < exprs.length) {
			const expr = exprs[i] as Part
			if (expr?.type === 'text') pushText(acc, expr.text)
			else acc.push(expr)
		}
	}

	return acc
}
