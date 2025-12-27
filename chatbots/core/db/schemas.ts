import { EntitySchema } from 'pluxel-plugin-mikro-orm/mikro-orm/core'

export interface UnifiedUserRow {
	id: number
	displayName: string | null
	createdAt: Date
}

export interface UnifiedIdentityRow {
	id: number
	userId: number
	platform: string
	platformUserId: string
	createdAt: Date
}

export interface LinkTokenRow {
	id: number
	userId: number
	code: string
	createdAt: Date
	expiresAt: Date
	consumedAt: Date | null
}

export const UnifiedUserSchema = new EntitySchema<UnifiedUserRow>({
	name: 'UnifiedUser',
	tableName: 'unified_users',
	properties: {
		id: { primary: true, type: 'number', autoincrement: true },
		displayName: { type: 'string', nullable: true, index: true },
		createdAt: { type: 'Date' },
	},
})

export const UnifiedIdentitySchema = new EntitySchema<UnifiedIdentityRow>({
	name: 'UnifiedIdentity',
	tableName: 'unified_identities',
	properties: {
		id: { primary: true, type: 'number', autoincrement: true },
		userId: { type: 'number', index: true },
		platform: { type: 'string', index: true },
		platformUserId: { type: 'string', index: true },
		createdAt: { type: 'Date' },
	},
	uniques: [{ properties: ['platform', 'platformUserId'] }, { properties: ['userId', 'platform'] }],
})

export const LinkTokenSchema = new EntitySchema<LinkTokenRow>({
	name: 'UnifiedLinkToken',
	tableName: 'unified_link_tokens',
	properties: {
		id: { primary: true, type: 'number', autoincrement: true },
		userId: { type: 'number', index: true },
		code: { type: 'string', unique: true },
		createdAt: { type: 'Date' },
		expiresAt: { type: 'Date', index: true },
		consumedAt: { type: 'Date', nullable: true, index: true },
	},
})
