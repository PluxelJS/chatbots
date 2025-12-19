import type { EntityManager } from 'pluxel-plugin-mikro-orm/mikro-orm/core'
import type { MikroOrm, MikroOrmEntityBatch } from 'pluxel-plugin-mikro-orm'

import { GrantSchema, RoleSchema, UserRoleSchema, type GrantEffect, type GrantKind, type GrantRow, type GrantSubjectType, type RoleRow } from './db/schemas'
import type { GrantsStoreApi } from './store'

export class GrantsStore implements GrantsStoreApi {
	private constructor(
		private readonly mikro: MikroOrm,
		private readonly entities: { role: string; userRole: string; grant: string },
	) {}

	static async create(mikro: MikroOrm): Promise<{ store: GrantsStore; batch: MikroOrmEntityBatch }> {
		const batch = await mikro.registerEntities([RoleSchema, UserRoleSchema, GrantSchema])
		const [role, userRole, grant] = batch.entities
		return {
			store: new GrantsStore(mikro, {
				role: role!.entityName,
				userRole: userRole!.entityName,
				grant: grant!.entityName,
			}),
			batch,
		}
	}

	private async em(): Promise<EntityManager> {
		return await this.mikro.em()
	}

	async listRoles(): Promise<RoleRow[]> {
		const em = await this.em()
		return (await em.find(this.entities.role as any, {}, { orderBy: { roleId: 'asc' } as any })) as RoleRow[]
	}

	async createRole(parentRoleId: number | null, rank: number): Promise<number> {
		const em = await this.em()
		const row = { parentRoleId, rank, updatedAt: new Date() } satisfies Omit<RoleRow, 'roleId'>
		const inserted = await em.insert(this.entities.role as any, row)
		const id = normalizeInsertId(inserted)
		if (id && id > 0) return id

		// Fallback for some drivers/modes: insert() may return 0 for non-`id` PK schemas.
		// For sqlite/libsql, last_insert_rowid() tracks the last AUTOINCREMENT integer PK.
		const rows = (await (em as any).getConnection?.().execute?.('select last_insert_rowid() as id')) as
			| Array<{ id: number | string | bigint }>
			| undefined
		const last = rows?.[0]?.id
		const lastId = typeof last === 'bigint' ? Number(last) : typeof last === 'string' ? Number(last) : last
		if (typeof lastId === 'number' && Number.isFinite(lastId) && lastId > 0) return lastId

		throw new Error('[Permissions] createRole(): failed to read inserted roleId')
	}

	async updateRole(roleId: number, patch: { parentRoleId?: number | null; rank?: number }): Promise<void> {
		const em = await this.em()
		await em.nativeUpdate(
			this.entities.role as any,
			{ roleId },
			{ ...patch, updatedAt: new Date() },
		)
	}

	async listUserRoleIds(userId: number): Promise<number[]> {
		const em = await this.em()
		const rows = (await em.find(this.entities.userRole as any, { userId }, { fields: ['roleId'] as any })) as Array<{ roleId: number }>
		return rows.map((r) => r.roleId)
	}

	async assignRoleToUser(userId: number, roleId: number): Promise<void> {
		const em = await this.em()
		try {
			await em.insert(this.entities.userRole as any, { userId, roleId })
		} catch {
			// ignore duplicate
		}
	}

	async unassignRoleFromUser(userId: number, roleId: number): Promise<void> {
		const em = await this.em()
		await em.nativeDelete(this.entities.userRole as any, { userId, roleId })
	}

	async listGrants(subjectType: GrantSubjectType, subjectId: number): Promise<GrantRow[]> {
		const em = await this.em()
		return (await em.find(
			this.entities.grant as any,
			{ subjectType, subjectId },
			{ orderBy: { id: 'asc' } as any },
		)) as GrantRow[]
	}

	async listRoleGrants(roleIds: number[]): Promise<GrantRow[]> {
		if (roleIds.length === 0) return []
		const em = await this.em()
		return (await em.find(
			this.entities.grant as any,
			{ subjectType: 'role', subjectId: { $in: roleIds } as any },
			{ orderBy: { id: 'asc' } as any },
		)) as GrantRow[]
	}

	async upsertGrant(row: {
		subjectType: GrantSubjectType
		subjectId: number
		nsKey: string
		kind: GrantKind
		local: string
		effect: GrantEffect
	}): Promise<void> {
		const em = await this.em()
		const updatedAt = new Date()
		const where = {
			subjectType: row.subjectType,
			subjectId: row.subjectId,
			nsKey: row.nsKey,
			kind: row.kind,
			local: row.local,
		}

		const existing = (await em.findOne(this.entities.grant as any, where)) as GrantRow | null
		if (existing) {
			await em.nativeUpdate(this.entities.grant as any, { id: existing.id }, { effect: row.effect, updatedAt })
			return
		}
		await em.insert(this.entities.grant as any, { ...row, updatedAt })
	}

	async revokeGrant(row: {
		subjectType: GrantSubjectType
		subjectId: number
		nsKey: string
		kind: GrantKind
		local: string
	}): Promise<void> {
		const em = await this.em()
		await em.nativeDelete(this.entities.grant as any, row)
	}
}

function normalizeInsertId(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'bigint') return Number(value)
	if (value && typeof value === 'object') {
		const any = value as any
		if (typeof any.insertId === 'number') return any.insertId
		if (typeof any.insertId === 'bigint') return Number(any.insertId)
		if (typeof any.id === 'number') return any.id
		if (typeof any.id === 'bigint') return Number(any.id)
	}
	return null
}
