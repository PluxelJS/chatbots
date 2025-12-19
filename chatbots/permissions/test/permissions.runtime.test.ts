import { describe, expect, it } from 'bun:test'

import { rm } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { BasePlugin, Plugin, withTestHost } from '@pluxel/core/test'
import { MikroOrmLibsql } from 'pluxel-plugin-mikro-orm'

import { Decision } from '../decision'
import { PermissionsHost } from './host'

@Plugin({ name: 'PermCallerA', type: 'service' })
class PermCallerA extends BasePlugin {
	constructor(private readonly perms: PermissionsHost) {
		super()
	}

	declareStarOnly() {
		this.perms.permission.declareStar('cmd', { default: 'deny', description: 'commands' })
	}

	declareStarsOnly() {
		this.perms.permission.declareStar('', { default: 'deny', description: 'all' })
		this.perms.permission.declareStar('cmd', { default: 'deny', description: 'commands' })
	}

	declareCommands() {
		this.perms.permission.declareStar('', { default: 'deny', description: 'all' })
		this.perms.permission.declareStar('cmd', { default: 'deny', description: 'commands' })
		const reload = this.perms.permission.declareExact('cmd.reload', { default: 'deny' })
		const shutdown = this.perms.permission.declareExact('cmd.shutdown', { default: 'deny' })
		return { reload, shutdown }
	}

	declareCmdAdmin() {
		this.perms.permission.declareStar('', { default: 'deny', description: 'all' })
		this.perms.permission.declareStar('cmd', { default: 'deny', description: 'commands' })
		this.perms.permission.declareStar('cmd.admin', { default: 'deny', description: 'admin commands' })
		const reload = this.perms.permission.declareExact('cmd.reload', { default: 'deny' })
		const adminReload = this.perms.permission.declareExact('cmd.admin.reload', { default: 'deny' })
		return { reload, adminReload }
	}

	declareXy() {
		this.perms.permission.declareStar('', { default: 'deny', description: 'all' })
		const xy = this.perms.permission.declareExact('x.y', { default: 'deny' })
		return { xy }
	}
}

@Plugin({ name: 'PermCallerB', type: 'service' })
class PermCallerB extends BasePlugin {
	constructor(private readonly perms: PermissionsHost) {
		super()
	}

	declareReload() {
		this.perms.permission.declareStar('cmd', { default: 'deny', description: 'commands' })
		const reload = this.perms.permission.declareExact('cmd.reload', { default: 'deny' })
		return { reload }
	}
}

describe('permissions: runtime (plugin context + mikro-orm)', () => {
	it('resolver requires exact declaration (star-only does not make leaf resolvable)', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			host.getOrThrow(PermCallerA).declareStarOnly()
			expect(perms.permissions.resolver.resolve('PermCallerA.cmd.reload')).toBeNull()

			host.getOrThrow(PermCallerA).declareCommands()
			expect(perms.permissions.resolver.resolve('PermCallerA.cmd.reload')).not.toBeNull()

			// invalid segments should not throw (treated as resolve failure => deny)
			expect(await perms.permission.canUser(1, 'PermCallerA.cmd..reload')).toBe(false)
		})
	})

	it('supports role inheritance + exact>star + user overrides (layering)', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			host.getOrThrow(PermCallerA).declareCommands()

			// apply catalog activation (new namespaces require a refresh for role effective caches)
			await perms.permission.canUser(0, 'PermCallerA.cmd.reload')

			const roleUser = await perms.permission.createRole(null, 0)
			const roleAdmin = await perms.permission.createRole(roleUser, 100)

			await perms.permission.assignRoleToUser(1, roleUser)
			await perms.permission.assignRoleToUser(2, roleAdmin)

			await perms.permission.grant('role', roleUser, 'allow', 'PermCallerA.cmd.*')
			await perms.permission.grant('role', roleAdmin, 'deny', 'PermCallerA.cmd.shutdown')

			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.reload')).toBe(true)
			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.shutdown')).toBe(true)

			expect(await perms.permission.canUser(2, 'PermCallerA.cmd.reload')).toBe(true)
			expect(await perms.permission.canUser(2, 'PermCallerA.cmd.shutdown')).toBe(false)

			await perms.permission.grant('user', 2, 'allow', 'PermCallerA.cmd.shutdown')
			expect(await perms.permission.canUser(2, 'PermCallerA.cmd.shutdown')).toBe(true)
		})
	})

	it('applies stable role ordering (rank desc, roleId asc), independent of DB order', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			host.getOrThrow(PermCallerA).declareXy()
			await perms.permission.canUser(0, 'PermCallerA.x.y')

			const roleA = await perms.permission.createRole(null, 10)
			const roleB = await perms.permission.createRole(null, 5)

			await perms.permission.grant('role', roleA, 'deny', 'PermCallerA.x.y')
			await perms.permission.grant('role', roleB, 'allow', 'PermCallerA.x.y')

			await perms.permission.assignRoleToUser(1, roleA)
			await perms.permission.assignRoleToUser(1, roleB)
			expect(await perms.permission.canUser(1, 'PermCallerA.x.y')).toBe(false)

			await perms.permission.updateRole(roleB, { rank: 20 })
			expect(await perms.permission.canUser(1, 'PermCallerA.x.y')).toBe(true)

			const roleC = await perms.permission.createRole(null, 7)
			const roleD = await perms.permission.createRole(null, 7)
			await perms.permission.grant('role', roleC, 'allow', 'PermCallerA.x.y')
			await perms.permission.grant('role', roleD, 'deny', 'PermCallerA.x.y')

			await perms.permission.assignRoleToUser(2, roleD)
			await perms.permission.assignRoleToUser(2, roleC)
			expect(await perms.permission.canUser(2, 'PermCallerA.x.y')).toBe(roleC < roleD)
		})
	})

	it('validates grant nodes strictly and normalizes star locals', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			host.getOrThrow(PermCallerA).declareStarsOnly()
			await perms.permission.canUser(0, 'PermCallerA.cmd.reload')

			const roleId = await perms.permission.createRole(null, 0)
			await expect(perms.permission.grant('role', roleId, 'allow', 'PermCallerA.cmd.reload')).rejects.toThrow(/undeclared|invalid/i)

			await perms.permission.grant('role', roleId, 'allow', 'PermCallerA.cmd.*')
			await perms.permission.grant('role', roleId, 'deny', 'PermCallerA.*')

			const store = (perms.permissions as any).store as {
				listGrants: (
					subjectType: 'user' | 'role',
					subjectId: number,
				) => Promise<Array<{ kind: string; local: string; effect: string }>>
			}
			const grants = await store.listGrants('role', roleId)
			expect(grants.map((g) => ({ kind: g.kind, local: g.local, effect: g.effect }))).toEqual([
				{ kind: 'star', local: 'cmd', effect: 'allow' },
				{ kind: 'star', local: '', effect: 'deny' },
			])
		})
	})

	it('supports root-star grants (<ns>.*) in roles', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			host.getOrThrow(PermCallerA).declareCommands()
			await perms.permission.canUser(0, 'PermCallerA.cmd.reload')

			const roleId = await perms.permission.createRole(null, 0)
			await perms.permission.assignRoleToUser(1, roleId)

			await perms.permission.grant('role', roleId, 'allow', 'PermCallerA.*')
			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.reload')).toBe(true)
			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.shutdown')).toBe(true)
		})
	})

	it('applies longest matching prefix.* (deny wins when deeper prefix denies)', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			host.getOrThrow(PermCallerA).declareCmdAdmin()
			await perms.permission.canUser(0, 'PermCallerA.cmd.reload')

			const roleId = await perms.permission.createRole(null, 0)
			await perms.permission.assignRoleToUser(1, roleId)

			await perms.permission.grant('role', roleId, 'allow', 'PermCallerA.cmd.*')
			await perms.permission.grant('role', roleId, 'deny', 'PermCallerA.cmd.admin.*')

			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.reload')).toBe(true)
			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.admin.reload')).toBe(false)
		})
	})

	it('grant upsert overwrites (same node toggles allow/deny)', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			host.getOrThrow(PermCallerA).declareXy()
			await perms.permission.canUser(0, 'PermCallerA.x.y')

			const roleId = await perms.permission.createRole(null, 0)
			await perms.permission.assignRoleToUser(1, roleId)

			await perms.permission.grant('role', roleId, 'allow', 'PermCallerA.x.y')
			expect(await perms.permission.canUser(1, 'PermCallerA.x.y')).toBe(true)

			await perms.permission.grant('role', roleId, 'deny', 'PermCallerA.x.y')
			expect(await perms.permission.canUser(1, 'PermCallerA.x.y')).toBe(false)
		})
	})

	it('revoke works after plugin unload (offline cleanup; revoke does not depend on catalog)', async () => {
		await withPermissionsHost([PermCallerA], async ({ host, perms }) => {
			const declared = host.getOrThrow(PermCallerA).declareCommands()
			await perms.permission.canUser(0, 'PermCallerA.cmd.reload')
			expect(perms.permission.listNamespaces()).toEqual(['PermCallerA'])

			const roleId = await perms.permission.createRole(null, 0)
			await perms.permission.assignRoleToUser(1, roleId)
			await perms.permission.grant('role', roleId, 'allow', 'PermCallerA.cmd.*')
			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.reload')).toBe(true)

			const store = (perms.permissions as any).store as {
				listGrants: (subjectType: 'user' | 'role', subjectId: number) => Promise<Array<{ kind: string; local: string }>>
			}
			expect((await store.listGrants('role', roleId)).length).toBe(1)

			const cachedRef = declared.reload._ref
			expect(cachedRef).toBeTruthy()

			host.unregister(PermCallerA)
			await host.commitStrict()
			await waitForRunning(host, PermissionsHost, 10_000)

			expect(perms.permission.listNamespaces()).toEqual([])
			expect(await perms.permissions.authorizeUser(1, cachedRef!)).toBe(Decision.Deny)

			await perms.permission.revoke('role', roleId, 'PermCallerA.cmd.*')
			expect((await store.listGrants('role', roleId)).length).toBe(0)
		})
	})

	it('infers namespace from caller and isolates namespaces', async () => {
		await withPermissionsHost([PermCallerA, PermCallerB], async ({ host, perms }) => {
			const a = host.getOrThrow(PermCallerA).declareCommands()
			const b = host.getOrThrow(PermCallerB).declareReload()

			expect(a.reload.node).toBe('PermCallerA.cmd.reload')
			expect(b.reload.node).toBe('PermCallerB.cmd.reload')

			await perms.permission.canUser(0, 'PermCallerA.cmd.reload')
			await perms.permission.canUser(0, 'PermCallerB.cmd.reload')

			const roleId = await perms.permission.createRole(null, 0)
			await perms.permission.assignRoleToUser(1, roleId)

			await perms.permission.grant('role', roleId, 'allow', 'PermCallerA.cmd.reload')
			expect(await perms.permission.canUser(1, 'PermCallerA.cmd.reload')).toBe(true)
			expect(await perms.permission.canUser(1, 'PermCallerB.cmd.reload')).toBe(false)

			const cachedRef = a.reload._ref
			expect(cachedRef).toBeTruthy()
			expect(await perms.permissions.authorizeUser(1, cachedRef!)).toBe(Decision.Allow)
		})
	})
})

async function withPermissionsHost(
	plugins: any[],
	fn: (ctx: { host: any; perms: PermissionsHost }) => Promise<void>,
): Promise<void> {
	const dbName = path.join(process.cwd(), 'data', `permissions-${randomUUID()}.sqlite`)
	try {
		await withTestHost(async (host) => {
			host.registerAll(MikroOrmLibsql, PermissionsHost, ...plugins)

			host.setConfig('MikroOrm', { config: { dbName, ensureSchemaOnInit: true } })

			await host.commitStrict()
			await waitForRunning(host, PermissionsHost, 10_000)

			const perms = host.getOrThrow(PermissionsHost)
			await fn({ host, perms })
		})
	} finally {
		await rm(dbName, { force: true })
	}
}

async function waitForRunning(host: { isRunning: (id: any) => boolean }, id: any, timeoutMs: number) {
	const deadline = Date.now() + Math.max(1, timeoutMs)
	while (!host.isRunning(id)) {
		if (Date.now() > deadline) throw new Error(`Timeout waiting for plugin to be running: ${String(id)}`)
		await new Promise((r) => setTimeout(r, 5))
	}
}
