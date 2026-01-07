import type { Part } from './model'

type NonTextPart = Exclude<Part, { type: 'text' }>

export type PartsValue = string | number | NonTextPart | null | undefined

const pushText = (acc: Part[], text: string) => {
	if (!text) return
	const prev = acc[acc.length - 1]
	if (prev?.type === 'text') {
		prev.text += text
		return
	}
	acc.push({ type: 'text', text })
}

const pushValue = (acc: Part[], value: PartsValue) => {
	if (value === null || value === undefined) return

	if (typeof value === 'string' || typeof value === 'number') {
		pushText(acc, String(value))
		return
	}

	acc.push(value)
}

/**
 * Runtime for `parts\`...\`` after transform.
 *
 * - `quasis` must be cooked strings (no `raw`)
 * - `exprs` are passed through unchanged
 */
export const __parts = (quasis: readonly string[], exprs: readonly PartsValue[]): Part[] => {
	const acc: Part[] = []

	const n = quasis.length
	for (let i = 0; i < n; i++) {
		pushText(acc, quasis[i] ?? '')
		if (i < exprs.length) pushValue(acc, exprs[i] as PartsValue)
	}

	return acc
}
