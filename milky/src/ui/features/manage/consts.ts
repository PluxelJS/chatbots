export const stateColors: Record<string, string> = {
	initializing: 'yellow',
	connecting: 'yellow',
	online: 'teal',
	error: 'red',
	stopped: 'gray',
}

export const stateLabels: Partial<Record<string, string>> = {
	initializing: '初始化',
	connecting: '连接中',
	online: '在线',
	error: '异常',
	stopped: '停止',
}

export const formatTime = (value?: number) => (value ? new Date(value).toLocaleTimeString() : '—')

