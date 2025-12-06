import { rpc } from '@pluxel/hmr/web'

type RpcClient = ReturnType<typeof rpc>['KOOK']

export type Snapshot = Awaited<ReturnType<RpcClient['snapshot']>>
export type BotStatus = Snapshot['bots'][number]
export type Overview = Snapshot['overview']
export type BotMode = BotStatus['mode']
