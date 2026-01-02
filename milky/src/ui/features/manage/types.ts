import type { MilkySnapshot } from '../../../runtime'

export type Snapshot = MilkySnapshot
export type BotStatus = Snapshot['bots'][number]
export type Overview = Snapshot['overview']

