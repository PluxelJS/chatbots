import * as dsl from './dsl'

export * from './model'
export * from './dsl'
export * from './inspect'
export * from './tag'
export * from './validate'

/**
 * DSL helpers namespace.
 *
 * Usage:
 *   import { parts, p } from '@pluxel/bot-layer/parts'
 *   const msg = parts`hi ${p.mentionUser(id)} ${p.link(url)}`
 */
export const p = dsl
