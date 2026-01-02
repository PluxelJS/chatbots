import type { BotMode, BotStatus } from './types'

export const statusColors: Record<string, string> = {
	online: 'teal',
	weak: 'grape',
	handshaking: 'violet',
	connecting: 'yellow',
	resuming: 'indigo',
	backoff: 'orange',
	fetching_profile: 'gray',
	registering_gateway: 'gray',
	stopped: 'gray',
	error: 'red',
}

export const statusLabels: Partial<Record<string, string>> = {
	online: '已连接',
	weak: '弱连接',
	handshaking: '握手中',
	connecting: '连接中',
	resuming: '恢复会话',
	backoff: '退避重试',
	fetching_profile: '准备中',
	registering_gateway: '等待网关',
	stopped: '已停止',
	error: '异常',
}

export const modeColors: Record<BotMode, string> = { gateway: 'indigo', webhook: 'grape', api: 'gray' }

export const humanState = (state: BotStatus['state']) => statusLabels[state] ?? state
export const formatTime = (value?: number) => (value ? new Date(value).toLocaleTimeString() : '—')

