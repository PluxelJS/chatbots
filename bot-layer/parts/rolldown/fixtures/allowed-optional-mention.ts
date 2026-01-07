import { mentionUser } from '../../dsl'

declare const maybeId: number | undefined

export const msg = parts`hi ${mentionUser(maybeId)}`

