import type { KookSnapshot } from '../runtime'

export type Snapshot = KookSnapshot
export type BotStatus = Snapshot['bots'][number]
export type Overview = Snapshot['overview']
export type BotMode = BotStatus['mode']
