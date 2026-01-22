import type { KvRateRule } from 'pluxel-plugin-kv'
import type { McpConfig } from '@pluxel/cmd'

import type { PermissionEffect, PermissionMeta } from '../../permissions/registry'

type RateScope = 'user' | 'identity' | 'channel' | 'global'

export type DecoratedPermSpec =
	| true
	| false
	| string
	| ({ local?: string; message?: string; default?: PermissionEffect } & PermissionMeta)

type DecoratedBaseSpec = {
	/** Whether this command/op should be installed. Useful for feature flags / optional deps. Default enabled. */
	enabled?: boolean | ((target: object) => boolean)
	/** Optional group label (used by sandbox UI). */
	group?: string
	/** Tags used by help filtering / grouping (implementation defined). */
	tags?: readonly string[]
	/** Convenience over title field. */
	title?: string
	/**
	 * Local permission node (namespace inferred from caller plugin id at install time).
	 * Example: `cmd.meme.list` (full node becomes `${nsKey}.cmd.meme.list`).
	 */
	perm?: DecoratedPermSpec
	/** Best-effort rate limiting via KV (counts attempts). */
	rates?: { rule: KvRateRule; scope?: RateScope; key?: string; message?: string }

	/**
	 * Optional MCP tool opt-in.
	 *
	 * When provided, the installed op/command is also registered as an MCP tool.
	 */
	mcp?: McpConfig
}

export type DecoratedTextCommandSpec = DecoratedBaseSpec & {
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

export type DecoratedOpSpec = DecoratedBaseSpec

export type DecoratedEntry =
	| { kind: 'command'; localId: string; key: string | symbol; spec: DecoratedTextCommandSpec }
	| { kind: 'op'; localId: string; key: string | symbol; spec: DecoratedOpSpec }

const DECORATED = Symbol.for('pluxel:chatbots:decorated-commands')

function pushDecorated(target: object, entry: DecoratedEntry) {
	const obj = target as any
	const list: DecoratedEntry[] = obj[DECORATED] ?? (obj[DECORATED] = [])
	list.push(entry)
}

export function getDecoratedChatbotsCommands(target: object): ReadonlyArray<DecoratedEntry> {
	const obj = target as any
	return (obj[DECORATED] ?? []) as DecoratedEntry[]
}

type DecoratedTextCommandInput =
	| string
	| ({ localId: string } & DecoratedTextCommandSpec)
	| DecoratedTextCommandSpec
	| undefined

type DecoratedOpInput = string | ({ localId: string } & DecoratedOpSpec) | DecoratedOpSpec | undefined

function normalizeCommandDecoratorInput(
	input: DecoratedTextCommandInput,
	fallbackKey: string | symbol,
): { localId: string; spec: DecoratedTextCommandSpec } {
	if (!input) return { localId: String(fallbackKey), spec: {} }
	if (typeof input === 'string') return { localId: input, spec: {} }
	const any = input as any
	const localId = typeof any.localId === 'string' && any.localId.trim() ? any.localId : String(fallbackKey)
	const { localId: _omit, ...rest } = any
	return { localId, spec: rest as DecoratedTextCommandSpec }
}

function normalizeOpDecoratorInput(
	input: DecoratedOpInput,
	fallbackKey: string | symbol,
): { localId: string; spec: DecoratedOpSpec } {
	if (!input) return { localId: String(fallbackKey), spec: {} }
	if (typeof input === 'string') return { localId: input, spec: {} }
	const any = input as any
	const localId = typeof any.localId === 'string' && any.localId.trim() ? any.localId : String(fallbackKey)
	const { localId: _omit, ...rest } = any
	return { localId, spec: rest as DecoratedOpSpec }
}

/**
 * Decorate a method or property as a chat text command spec.
 *
 * The decorated member is installed by `CommandKit.install(target)`.
 */
export function ChatCommand(spec: { localId: string } & DecoratedTextCommandSpec): MethodDecorator & PropertyDecorator
export function ChatCommand(localId: string, spec?: DecoratedTextCommandSpec): MethodDecorator & PropertyDecorator
export function ChatCommand(spec?: DecoratedTextCommandSpec): MethodDecorator & PropertyDecorator
export function ChatCommand(a?: any, b?: any): MethodDecorator & PropertyDecorator {
	return (target: object, key: string | symbol, desc?: PropertyDescriptor) => {
		if (desc && typeof (desc as any).value !== 'function') {
			throw new Error('@ChatCommand() must decorate a method or a property')
		}

		const normalized =
			typeof a === 'string'
				? normalizeCommandDecoratorInput({ localId: a, ...(b ?? {}) } as any, key)
				: normalizeCommandDecoratorInput(a, key)

		pushDecorated(target, { kind: 'command', localId: normalized.localId, key, spec: normalized.spec })
	}
}

/**
 * Decorate a method or property as a non-text op (object/MCP entrypoints).
 */
export function ChatOp(spec: { localId: string } & DecoratedOpSpec): MethodDecorator & PropertyDecorator
export function ChatOp(localId: string, spec?: DecoratedOpSpec): MethodDecorator & PropertyDecorator
export function ChatOp(spec?: DecoratedOpSpec): MethodDecorator & PropertyDecorator
export function ChatOp(a?: any, b?: any): MethodDecorator & PropertyDecorator {
	return (target: object, key: string | symbol, desc?: PropertyDescriptor) => {
		if (desc && typeof (desc as any).value !== 'function') {
			throw new Error('@ChatOp() must decorate a method or a property')
		}

		const normalized =
			typeof a === 'string'
				? normalizeOpDecoratorInput({ localId: a, ...(b ?? {}) } as any, key)
				: normalizeOpDecoratorInput(a, key)

		pushDecorated(target, { kind: 'op', localId: normalized.localId, key, spec: normalized.spec })
	}
}
