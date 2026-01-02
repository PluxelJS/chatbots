import type { TelegramSnapshot } from '../../../telegram'

export type Snapshot = TelegramSnapshot
export type BotStatus = Snapshot['bots'][number]
export type Overview = Snapshot['overview']
export type BotMode = BotStatus['mode']

