import * as dsl from './dsl'

export * from './model'
export * from './dsl'
export * from './inspect'
export * from './tag'
export * from './validate'
export * from './content'

/**
 * DSL helpers namespace.
 *
 * Usage:
 *   import { parts, p } from 'pluxel-plugin-bot-core/parts'
 *   const msg = parts`hi ${p.mentionUser(id)} ${p.link(url)}`
 */
export const p = dsl
