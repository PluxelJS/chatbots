import crypto from 'node:crypto'
import { Collection, createIndex } from '@pluxel/hmr/signaldb'
import type { Context } from '@pluxel/hmr'
import type { MilkyBotStatus } from '../shared/status'
import { maskSecret, normalizeBaseUrl as normalizeBaseUrlValue } from '../shared/utils'

export type BotState = MilkyBotStatus

type TokenFields = {
	tokenPreview: string
}

type IdentityFields = {
	name?: string
	baseUrl: string
}

type RuntimeFields = {
	state: BotState['state']
	stateMessage?: string
	lastError?: string
	selfId?: number
	nickname?: string
	implName?: string
	implVersion?: string
	milkyVersion?: string
	qqProtocolType?: string
	qqProtocolVersion?: string
	lastEventAt?: number
	lastEventType?: string
	connectedAt?: number
}

type AuditFields = {
	createdAt: number
	updatedAt: number
	secure: boolean
}

export type MilkyBotRecord = TokenFields &
	IdentityFields &
	RuntimeFields &
	AuditFields & {
		id: string
	}

export type MilkyBotPublic = MilkyBotRecord

export type CreateBotInput = {
	baseUrl: string
	accessToken?: string
	name?: string
}

export type UpdateBotInput = Partial<Pick<CreateBotInput, 'baseUrl' | 'name'>> & {
	accessToken?: string
}
const normalizeAccessToken = (accessToken?: string) => {
	const token = (accessToken ?? '').trim()
	return token ? token : undefined
}

export class MilkyBotRegistry {
	private readonly vault: ReturnType<Context['vault']['open']>
	private collection!: Collection<MilkyBotRecord>
	private readyPromise: Promise<void> | null = null

	constructor(
		private readonly ctx: Context,
		private readonly collectionName = 'milky:bots',
	) {
		this.vault = ctx.vault.open()
	}

	private accessTokenKey(id: string) {
		return `${this.collectionName}:${id}:accessToken`
	}

	async init() {
		this.collection = new Collection<MilkyBotRecord>({
			name: this.collectionName,
			persistence: await this.ctx.pluginData.persistenceForCollection<MilkyBotRecord>(this.collectionName),
			indices: [createIndex('state'), createIndex('updatedAt')],
		})
		this.readyPromise = this.collection.isReady()
	}

	whenReady() {
		return this.readyPromise ?? Promise.resolve()
	}

	async getAccessToken(id: string) {
		return (await this.vault.getToken(this.accessTokenKey(id))) ?? undefined
	}

	async create(input: CreateBotInput): Promise<MilkyBotPublic> {
		const now = Date.now()
		const baseUrl = normalizeBaseUrlValue(input.baseUrl)
		const accessToken = normalizeAccessToken(input.accessToken)
		const id = crypto.randomUUID()
		if (accessToken) await this.vault.setToken(this.accessTokenKey(id), accessToken)

		const doc: MilkyBotRecord = {
			id,
			name: input.name?.trim() || undefined,
			baseUrl,
			state: 'initializing',
			stateMessage: '等待连接',
			lastError: undefined,
			selfId: undefined,
			nickname: undefined,
			implName: undefined,
			implVersion: undefined,
			milkyVersion: undefined,
			qqProtocolType: undefined,
			qqProtocolVersion: undefined,
			lastEventAt: undefined,
			lastEventType: undefined,
			connectedAt: undefined,
			createdAt: now,
			updatedAt: now,
			secure: Boolean(accessToken),
			tokenPreview: accessToken ? maskSecret(accessToken) : '—',
		}
		try {
			await this.collection.insert(doc)
		} catch (e) {
			if (accessToken) await this.vault.deleteToken(this.accessTokenKey(id)).catch(() => {})
			throw e
		}
		return doc
	}

	async delete(id: string) {
		const ok = Boolean(await this.collection.removeOne({ id }))
		if (ok) await this.vault.deleteToken(this.accessTokenKey(id)).catch(() => {})
		return ok
	}

	findOne(id: string) {
		return this.collection.findOne({ id })
	}

	list(limit = 64) {
		return this.collection.find({}, { sort: { updatedAt: -1 }, limit }).fetch()
	}

	async update(id: string, patch: Partial<MilkyBotRecord>) {
		await this.collection.updateOne(
			{ id },
			{
				$set: {
					...patch,
					updatedAt: Date.now(),
				},
			},
		)
	}

	async updateBot(id: string, patch: UpdateBotInput): Promise<MilkyBotPublic | null> {
		const doc = this.findOne(id)
		if (!doc) return null

		const nextPatch: Partial<MilkyBotRecord> = {}
		if (typeof patch.baseUrl === 'string') nextPatch.baseUrl = normalizeBaseUrlValue(patch.baseUrl)
		if (typeof patch.name === 'string') nextPatch.name = patch.name.trim() || undefined
		if ('accessToken' in patch) {
			const key = this.accessTokenKey(id)
			const before = await this.vault.getToken(key)
			const accessToken = normalizeAccessToken(patch.accessToken)
			try {
				if (accessToken) await this.vault.setToken(key, accessToken)
				else await this.vault.deleteToken(key)
			} catch (e) {
				// Best-effort rollback (no compatibility required, but keep state sane).
				if (before) await this.vault.setToken(key, before).catch(() => {})
				else await this.vault.deleteToken(key).catch(() => {})
				throw e
			}

			nextPatch.secure = Boolean(accessToken)
			nextPatch.tokenPreview = accessToken ? maskSecret(accessToken) : '—'
		}

		await this.update(id, nextPatch)
		const next = this.findOne(id)
		return next ?? null
	}

	observe(limit: number, listener: () => void) {
		const cursor = this.collection.find({}, { sort: { updatedAt: -1 }, limit })
		const stop = cursor.observeChanges(
			{
				added: listener,
				changed: listener,
				removed: listener,
			},
			true,
		)
		return () => {
			stop?.()
			cursor.cleanup()
		}
	}
}
