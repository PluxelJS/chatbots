import { mentionUser } from '../../dsl'

const ok = true
export const msg = parts`hi ${ok && mentionUser(1)}`
