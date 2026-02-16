import type { McpConfig } from '@pluxel/cmd'
import type { KvRateRule } from 'pluxel-plugin-kv'

import type { PermissionEffect, PermissionMeta } from '../../permissions/registry'

export type RateScope = 'user' | 'identity' | 'channel' | 'global'

export type PermSpecInput =
	| true
	| false
	| string
	| ({ local?: string; message?: string; default?: PermissionEffect } & PermissionMeta)

export type CommonCommandSpec = {
	/** Whether this command/op should be installed. Default enabled. */
	enabled?: boolean
	/** Optional group label (used by help/UI). */
	group?: string
	/** Tags used by help filtering / grouping (implementation defined). */
	tags?: readonly string[]
	/** Convenience over title field. */
	title?: string
	/**
	 * Local permission node (namespace inferred from caller plugin id at install time).
	 * Example: `cmd.meme.list` (full node becomes `${nsKey}.cmd.meme.list`).
	 */
	perm?: PermSpecInput
	/** Best-effort rate limiting via KV (counts attempts). */
	rates?: { rule: KvRateRule; scope?: RateScope; key?: string; message?: string }

	/**
	 * Optional MCP tool opt-in.
	 *
	 * When provided, the installed op/command is also registered as an MCP tool.
	 */
	mcp?: McpConfig
}

export type TextCommandSpec = CommonCommandSpec & {
	/** Text triggers (default: `localId.replaceAll('.', ' ')`). */
	triggers?: readonly string[]
	/** Extra triggers (aliases). */
	aliases?: readonly string[]
	/** Help/command browser only (not parsed). */
	usage?: string
	/** Help/command browser only. */
	description?: string
	/** Optional examples (shown in help). */
	examples?: string[]
}

export type OpSpec = CommonCommandSpec
