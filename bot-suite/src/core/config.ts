import { v } from '@pluxel/hmr/config'

export const ChatbotsConfigSchema = v.object({
	cmdPrefix: v.pipe(v.optional(v.string(), '/'), v.minLength(1), v.maxLength(1)),
	debug: v.optional(v.boolean(), false),
	/** 默认 true：注册 help/info 等内置指令 */
	devCommands: v.optional(v.boolean(), true),
	/**
	 * 指令权限默认效果（当插件未显式声明权限节点时，CommandKit 会自动 declareExact 并使用该默认值）。
	 * - `allow`: 开箱即用（可再通过 deny 精细收敛）
	 * - `deny`: 严格模式（需显式 grant）
	 */
	cmdPermDefaultEffect: v.optional(v.picklist(['allow', 'deny']), 'allow'),
	/** 默认 true：自动 declareExact（并对 text/op 默认挂载权限检查）。 */
	cmdPermAutoDeclare: v.optional(v.boolean(), true),
	/** 默认 true：自动 declareStar `cmd.*` 和 `cmd.<group>.*`（便于批量 grant）。 */
	cmdPermAutoDeclareStars: v.optional(v.boolean(), true),
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
