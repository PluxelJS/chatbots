export function maskSecret(value: string) {
	const token = value.trim()
	if (!token) return '—'
	if (token.length <= 8) return `${token.slice(0, 2)}***${token.slice(-2)}`
	return `${token.slice(0, 4)}…${token.slice(-4)}`
}

export function normalizeBaseUrl(value: string) {
	const trimmed = value.trim().replace(/\/+$/, '')
	let url: URL
	try {
		url = new URL(trimmed)
	} catch {
		throw new Error('baseUrl 不是一个合法 URL')
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('baseUrl 必须以 http:// 或 https:// 开头')
	}
	return url.toString().replace(/\/+$/, '')
}

