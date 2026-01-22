import { describe, expect, it } from 'bun:test'

import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { BasePlugin, Plugin, withTestHost, type TestHost } from '@pluxel/core/test'
import { MikroOrmLibsql } from 'pluxel-plugin-mikro-orm'
import { KvMemory, Rates } from 'pluxel-plugin-kv'
import { BotCore, type AnyMessage } from 'pluxel-plugin-bot-core'
import { CmdError } from '@pluxel/cmd'

import { Chatbots } from '../plugin'
import type { ChatbotsCommandContext } from '../types'
import { ChatCommand } from './decorators'
import { InstallChatCommands } from './install'
import { cmd } from './draft'

type HostCtx = { host: TestHost; chatbots: Chatbots }

async function withChatbotsHost(
	plugins: any[],
	fn: (ctx: HostCtx) => Promise<void>,
	opts?: { cmdPermDefaultEffect?: 'allow' | 'deny' },
): Promise<void> {
	const dataDir = path.join(process.cwd(), 'data')
	await mkdir(dataDir, { recursive: true })
	const dbName = path.join(dataDir, `chatbots-${randomUUID()}.sqlite`)
	try {
		await withTestHost(async (host) => {
			const cfg = host.ctx.configService as unknown as { ready?: Promise<void> }
			if (cfg.ready) await cfg.ready

			host.registerAll(MikroOrmLibsql, KvMemory, Rates, BotCore, Chatbots, ...plugins)

			host.setConfig('MikroOrm', { config: { dbName, ensureSchemaOnInit: true } })
			host.setConfig('bot-core', {
				config: {
					bridges: {
						kook: { enabled: false },
						milky: { enabled: false },
						telegram: { enabled: false },
					},
					debug: false,
				},
			})
			host.setConfig('bot-suite', {
				config: {
					cmdPrefix: '/',
					debug: false,
					devCommands: false,
					registerUserCommands: false,
					cmdPermDefaultEffect: opts?.cmdPermDefaultEffect ?? 'allow',
					cmdPermAutoDeclare: true,
					cmdPermAutoDeclareStars: true,
				},
			})
			host.setConfig('Rates', { config: {} })

			await host.commitStrict()

			await fn({ host, chatbots: host.getOrThrow(Chatbots) })
		})
	} finally {
		await rm(dbName, { force: true })
	}
}

function getRuntimeRegistry(chatbots: Chatbots) {
	return (chatbots.runtime as any).registry as {
		router: { dispatch: (body: string, ctx: unknown) => Promise<unknown> }
		list: () => Array<{ id: string; info: unknown }>
	}
}

function makeCtx(): ChatbotsCommandContext {
	const msg = {
		platform: 'telegram',
		channel: { id: 10 },
		user: { isBot: false },
		parts: [],
		reply: async () => {},
	} as unknown as AnyMessage

	return {
		msg,
		user: { id: 1, identities: [], displayName: null, createdAt: new Date() },
		identity: { platform: 'telegram', platformUserId: 'u1' },
	} satisfies ChatbotsCommandContext
}

describe('chatbots cmdkit (plugin lifecycle integration)', () => {
	it('registers text command, dispatches, and cleans up on plugin unload', async () => {
		@Plugin({ name: 'cmd-test-a', type: 'service' })
		class CmdTestA extends BasePlugin {
			constructor(private readonly chatbots: Chatbots) {
				super()
			}

			@InstallChatCommands()
			async init(_abort: AbortSignal): Promise<void> {}

			@ChatCommand({ localId: 'ping', triggers: ['ping'], perm: false })
			ping = cmd<ChatbotsCommandContext>().argv().handle(() => 'pong')
		}

		await withChatbotsHost([CmdTestA], async ({ host, chatbots }) => {
			const registry = getRuntimeRegistry(chatbots)
			const ctx = makeCtx()

			expect(registry.list().some((x) => x.id === 'cmd-test-a.cmd.ping')).toBe(true)
			{
				const r = await registry.router.dispatch('ping', ctx)
				expect((r as any).ok).toBe(true)
				expect((r as any).val).toBe('pong')
			}

			host.unregister(CmdTestA)
			await host.commitStrict()

			expect(registry.list().some((x) => x.id === 'cmd-test-a.cmd.ping')).toBe(false)
			{
				const r = await registry.router.dispatch('ping', ctx)
				expect((r as any).ok).toBe(false)
				expect((r as any).err).toMatchObject({ name: 'CmdError', code: 'E_CMD_NOT_FOUND' })
			}
		})
	})

	it('supports plugin replace without leaking duplicate commands', async () => {
		@Plugin({ name: 'cmd-test-a', type: 'service' })
		class CmdTestA_v1 extends BasePlugin {
			constructor(private readonly chatbots: Chatbots) {
				super()
			}

			@InstallChatCommands()
			async init(_abort: AbortSignal): Promise<void> {}

			@ChatCommand({ localId: 'ping', triggers: ['ping'], perm: false })
			ping = cmd<ChatbotsCommandContext>().argv().handle(() => 'v1')
		}

		@Plugin({ name: 'cmd-test-a', type: 'service' })
		class CmdTestA_v2 extends BasePlugin {
			constructor(private readonly chatbots: Chatbots) {
				super()
			}

			@InstallChatCommands()
			async init(_abort: AbortSignal): Promise<void> {}

			@ChatCommand({ localId: 'ping', triggers: ['ping'], perm: false })
			ping = cmd<ChatbotsCommandContext>().argv().handle(() => 'v2')
		}

		await withChatbotsHost([CmdTestA_v1], async ({ host, chatbots }) => {
			const registry = getRuntimeRegistry(chatbots)
			const ctx = makeCtx()

			{
				const r = await registry.router.dispatch('ping', ctx)
				expect((r as any).ok).toBe(true)
				expect((r as any).val).toBe('v1')
			}

			host.replace(CmdTestA_v1, CmdTestA_v2)
			await host.commitStrict()

			const entries = registry.list().filter((x) => x.id === 'cmd-test-a.cmd.ping')
			expect(entries.length).toBe(1)
			{
				const r = await registry.router.dispatch('ping', ctx)
				expect((r as any).ok).toBe(true)
				expect((r as any).val).toBe('v2')
			}
		})
	})

	it('respects cmdPermDefaultEffect for undeclared commands', async () => {
		@Plugin({ name: 'cmd-test-perm', type: 'service' })
		class CmdPermTest extends BasePlugin {
			constructor(private readonly chatbots: Chatbots) {
				super()
			}

			@InstallChatCommands()
			async init(_abort: AbortSignal): Promise<void> {}

			@ChatCommand({ localId: 'secure', triggers: ['secure'] })
			secure = cmd<ChatbotsCommandContext>().argv().handle(() => 'ok')
		}

		// allow => should pass without grants
		await withChatbotsHost([CmdPermTest], async ({ chatbots }) => {
			const registry = getRuntimeRegistry(chatbots)
			const ctx = makeCtx()
			const r = await registry.router.dispatch('secure', ctx)
			expect((r as any).ok).toBe(true)
			expect((r as any).val).toBe('ok')
		}, { cmdPermDefaultEffect: 'allow' })

		// deny => should block (no explicit grant)
		await withChatbotsHost([CmdPermTest], async ({ chatbots }) => {
			const registry = getRuntimeRegistry(chatbots)
			const ctx = makeCtx()
			const r = await registry.router.dispatch('secure', ctx)
			expect((r as any).ok).toBe(false)
			expect((r as any).err).toBeInstanceOf(CmdError)
			expect((r as any).err).toMatchObject({ name: 'CmdError', code: 'E_FORBIDDEN' })
		}, { cmdPermDefaultEffect: 'deny' })
	})

	it('infers permission namespace from caller plugin id', async () => {
		@Plugin({ name: 'cmd-test-ns-a', type: 'service' })
		class CmdNsA extends BasePlugin {
			constructor(private readonly chatbots: Chatbots) {
				super()
			}

			@InstallChatCommands()
			async init(_abort: AbortSignal): Promise<void> {}

			@ChatCommand({ localId: 'secure', triggers: ['secure'], perm: true })
			secure = cmd<ChatbotsCommandContext>().argv().handle(() => 'ok')
		}

		@Plugin({ name: 'cmd-test-ns-b', type: 'service' })
		class CmdNsB extends BasePlugin {
			constructor(private readonly chatbots: Chatbots) {
				super()
			}

			@InstallChatCommands()
			async init(_abort: AbortSignal): Promise<void> {}

			@ChatCommand({ localId: 'secure', triggers: ['secure2'], perm: true })
			secure = cmd<ChatbotsCommandContext>().argv().handle(() => 'ok')
		}

		await withChatbotsHost([CmdNsA, CmdNsB], async ({ chatbots }) => {
			const perms = chatbots.runtime.permissions
			expect(perms.listNamespaces().includes('cmd-test-ns-a')).toBe(true)
			expect(perms.listNamespaces().includes('cmd-test-ns-b')).toBe(true)
			expect(perms.resolver.resolve('cmd-test-ns-a.cmd.secure')).not.toBeNull()
			expect(perms.resolver.resolve('cmd-test-ns-b.cmd.secure')).not.toBeNull()
		})
	})
})
