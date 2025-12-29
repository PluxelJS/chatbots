import type { HttpClient } from 'pluxel-plugin-wretch'
import { z } from 'zod'
import type { MilkyRequest, Result, SchemaPair } from './types'

type RequestBuilder = {
	post(b?: unknown): { json(): Promise<unknown> }
}

const normalizeErrMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const MilkyEnvelope = z.object({
	status: z.string(),
	retcode: z.number(),
	data: z.unknown().optional(),
	message: z.string().optional(),
})

export function createMilkyRequest(http: HttpClient, baseUrl: string, accessToken?: string): MilkyRequest {
	const base = baseUrl.replace(/\/+$/, '')

	return async <T>(api: string, payload?: unknown, schemas?: SchemaPair): Promise<Result<T>> => {
		try {
			const url = `${base}/api/${api.replace(/^\/+/, '')}`
			let req: any = (http as any).url ? (http as any).url(url, true) : http
			if (accessToken) {
				if (typeof req?.auth === 'function') {
					req = req.auth(`Bearer ${accessToken}`)
				} else if (typeof req?.headers === 'function') {
					req = req.headers({ Authorization: `Bearer ${accessToken}` })
				}
			}
			req = req as RequestBuilder

			const parsedPayload =
				schemas?.input && payload !== undefined ? schemas.input.parse(payload) : (payload ?? {})

			const res = await req
				// Prefer per-request Authorization so we don't mutate shared clients.
				.post(parsedPayload)
				.json()

			const env = MilkyEnvelope.safeParse(res)
			if (!env.success) {
				return { ok: false, retcode: -1, message: 'invalid milky response envelope', raw: res }
			}

			if (env.data.status !== 'ok') {
				return {
					ok: false,
					status: env.data.status,
					retcode: env.data.retcode,
					message: env.data.message ?? 'milky api failed',
					raw: res,
				}
			}

			const rawData = (env.data.data ?? {}) as unknown
			const parsed =
				schemas?.output && rawData !== undefined ? (schemas.output.parse(rawData) as T) : (rawData as T)
			return { ok: true, data: parsed, raw: res }
		} catch (e) {
			return { ok: false, retcode: -1, message: normalizeErrMsg(e), raw: e }
		}
	}
}

