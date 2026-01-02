export const stateColors: Record<string, string> = {
	polling: 'teal',
	webhook: 'grape',
	api: 'gray',
	authenticating: 'yellow',
	initializing: 'yellow',
	error: 'red',
	stopped: 'gray',
}

export const stateLabels: Partial<Record<string, string>> = {
	polling: '轮询',
	webhook: 'Webhook',
	api: '仅 API',
	authenticating: '鉴权中',
	initializing: '初始化',
	error: '异常',
	stopped: '停止',
}

export const formatTime = (value?: number) => (value ? new Date(value).toLocaleTimeString() : '—')

