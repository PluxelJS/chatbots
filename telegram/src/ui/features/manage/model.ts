import { useEffect, useState } from 'react'
import { rpcErrorMessage } from '@pluxel/hmr/web'
import { useTelegramRuntime } from '../../app/runtime'
import type { Overview, Snapshot } from './types'

export function useTelegramSnapshot() {
	const { rpc, sse } = useTelegramRuntime()
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
	const [overview, setOverview] = useState<Overview | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		let mounted = true
		const bootstrap = async () => {
			setLoading(true)
			try {
				const snap = await rpc.snapshot()
				if (!mounted) return
				setSnapshot(snap)
				setOverview(snap.overview)
				setError(null)
			} catch (err: any) {
				if (err?.name === 'AbortError') return
				if (!mounted) return
				setError(rpcErrorMessage(err, '无法获取 Telegram 状态'))
			} finally {
				if (mounted) setLoading(false)
			}
		}
		void bootstrap()

		const off = sse.Telegram.on(
			(msg) => {
				const payload = msg.payload as Snapshot | undefined
				if (payload?.overview) {
					setSnapshot(payload)
					setOverview(payload.overview)
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
			setOverview(snap.overview)
			setError(null)
		} catch (err: any) {
			if (err?.name === 'AbortError') return
			setError(rpcErrorMessage(err, '无法获取 Telegram 状态'))
		} finally {
			setLoading(false)
		}
	}

	return { snapshot, overview, error, loading, setError, refresh }
}

