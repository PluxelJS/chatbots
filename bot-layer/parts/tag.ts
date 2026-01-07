import type { Part } from './model'
import { __parts } from './runtime'

/**
 * DSL anchor:
 * - Types are enforced here (tag signature)
 * - Runtime call is removed by transform
 */
export const parts = (quasis: TemplateStringsArray, ...exprs: Part[]): Part[] =>
	(typeof quasis === 'object' && quasis !== null && Array.isArray(quasis) && 'raw' in quasis
		? __parts(quasis as unknown as readonly string[], exprs)
		: (() => {
				throw new TypeError('bot-layer: parts must be used as a tagged template')
			})())
