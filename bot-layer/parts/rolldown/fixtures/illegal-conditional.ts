import { mentionUser } from '../../dsl'

declare const ok: boolean

export const msg = parts`hi ${ok ? mentionUser(1) : null}`

