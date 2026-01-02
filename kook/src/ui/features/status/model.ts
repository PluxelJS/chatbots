import { useEffect, useState } from 'react'
import { rpcErrorMessage } from '@pluxel/hmr/web'
import type { Snapshot } from './types'
import { useKookRuntime } from '../../app/runtime'

export function useKookSnapshot() {
	const { rpc, sse } = useKookRuntime()
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let mounted = true
		const bootstrap = async () => {
			setLoading(true)
			try {
				const snap = await rpc.snapshot()
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

		const off = sse.KOOK.on(
			(msg) => {
				const payload = msg.payload as Snapshot | undefined
				if (payload && typeof payload === 'object' && Array.isArray((payload as Snapshot).bots)) {
					setSnapshot(payload)
					setLoading(false)
				}
			},
			['cursor', 'ready'],
		)

		return () => {
			mounted = false
			off()
		}
	}, [rpc, sse])

	const refresh = async () => {
		setLoading(true)
		try {
			const snap = await rpc.snapshot()
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
