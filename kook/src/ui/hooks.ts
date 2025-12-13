import { useEffect, useMemo, useState } from 'react'
import { hmrWebClient, rpcErrorMessage } from '@pluxel/hmr/web'
import type { Snapshot } from './types'

export const useKookSse = () => {
	const sse = useMemo(() => hmrWebClient.createSse({ namespaces: ['KOOK'] }), [])
	return sse
}

export function useKookSnapshot() {
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const sse = useKookSse()

	useEffect(() => {
		let mounted = true
		const bootstrap = async () => {
			setLoading(true)
			try {
				const snap = await (hmrWebClient.rpc as any).KOOK.snapshot()
				if (!mounted) return
				setSnapshot(snap)
				setError(null)
			} catch (err: any) {
				if (err?.name === 'AbortError') return
				if (!mounted) return
				setError(rpcErrorMessage(err, '无法获取 KOOK Bot 状态'))
			} finally {
				if (mounted) setLoading(false)
			}
		}
		void bootstrap()

		const off = sse.ns('KOOK').on((msg) => {
			const payload = msg.payload as Snapshot | undefined
			if (payload && typeof payload === 'object' && Array.isArray((payload as Snapshot).bots)) {
				setSnapshot(payload)
				setLoading(false)
			}
		}, ['cursor', 'ready'])

		return () => {
			mounted = false
			off()
			sse.close()
		}
	}, [sse])

	const refresh = async () => {
		setLoading(true)
		try {
			const snap = await (hmrWebClient.rpc as any).KOOK.snapshot()
			setSnapshot(snap)
			setError(null)
		} catch (err: any) {
			if (err?.name === 'AbortError') return
			setError(rpcErrorMessage(err, '无法获取 KOOK Bot 状态'))
		} finally {
			setLoading(false)
		}
	}

	return { snapshot, loading, error, setError, refresh }
}
