import type { ApiMethodName, HttpMethod, JsonLike } from './types'
import { coerceTelegramMultipartPayload } from './raw'
import { telegramApiDefinitions } from './definitions.source' with { type: 'macro' }

type TelegramApiDefinition = readonly [ApiMethodName, HttpMethod]

const DEFINITIONS = telegramApiDefinitions() as unknown as ReadonlyArray<TelegramApiDefinition>

export const TELEGRAM_API_PROTO: Record<string, unknown> = Object.create(Object.prototype)

for (const [methodName, method] of DEFINITIONS) {
	Object.defineProperty(TELEGRAM_API_PROTO, methodName, {
		enumerable: true,
		value(payload?: unknown) {
			return this.$raw.request(
				method,
				methodName as string,
				method === 'POST' ? coerceTelegramMultipartPayload(methodName, payload as JsonLike) : (payload as JsonLike),
			)
		},
	})
}
