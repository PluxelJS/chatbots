import { v } from '@pluxel/hmr/config'

export const ChatbotsConfigSchema = v.object({
	cmdPrefix: v.pipe(v.optional(v.string(), '/'), v.minLength(1), v.maxLength(1)),
	debug: v.optional(v.boolean(), false),
	/** 默认 true：注册 help/info 等内置指令 */
	devCommands: v.optional(v.boolean(), true),
	/**
	 * 用户解析缓存（避免频繁查库）。
	 * 默认：10s / 2000 条
	 */
	userCacheTtlMs: v.optional(v.number(), 10_000),
	userCacheMax: v.optional(v.number(), 2000),
	/** 默认 10 分钟 */
	linkTokenTtlSeconds: v.optional(v.number(), 10 * 60),
	/** 默认 true：注册内置 user 指令 */
	registerUserCommands: v.optional(v.boolean(), true),
})

export type ChatbotsConfig = v.InferOutput<typeof ChatbotsConfigSchema>
