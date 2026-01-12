import crypto from 'node:crypto'
import { Collection, createIndex } from '@pluxel/hmr/signaldb'
import type { Context } from '@pluxel/hmr'
import type { Bot } from '../bot'
import { BotMode } from '../config'

export type BotState = ReturnType<Bot['getStatusSnapshot']>

type TokenFields = {
	tokenPreview: string
}

type IdentityFields = {
	username?: string
	displayName?: string
	botId?: string
	instanceId?: string
	verifyToken?: string
	mode: (typeof BotMode)[number]
}

type GatewayFields = {
	gatewayState?: BotState['gateway'] extends { state: infer S } ? S : BotState['state']
	gateway?: BotState['gateway']
	lastEventAt?: number
	lastSequence?: number
}

type LifecycleFields = {
	state: BotState['state']
	stateMessage?: string
	lastError?: string
	connectedAt?: number
}

type AuditFields = {
	createdAt: number
	updatedAt: number
	secure: boolean
}

export type KookBotRecord = TokenFields &
	IdentityFields &
	GatewayFields &
	LifecycleFields &
	AuditFields & {
		id: string
	}

export type KookBotPublic = KookBotRecord

export type CreateBotInput = {
	token: string
	mode?: (typeof BotMode)[number]
	verifyToken?: string
}

export type UpdateBotInput = Partial<Pick<CreateBotInput, 'mode' | 'verifyToken'>>

const maskToken = (token: string) => {
	if (token.length <= 8) return `${token.slice(0, 2)}***${token.slice(-2)}`
	return `${token.slice(0, 4)}…${token.slice(-4)}`
}

/**
 * 集中管理 Bot 持久化、Vault token 管理与游标监听。
 */
export class KookBotRegistry {
	private readonly vault: ReturnType<Context['vault']['open']>
	private collection!: Collection<KookBotRecord>
	private readyPromise: Promise<void> | null = null

	constructor(
		private readonly ctx: Context,
		private readonly collectionName = 'kook:bots',
	) {
		this.vault = ctx.vault.open()
	}

	private tokenKey(id: string) {
		return `${this.collectionName}:${id}:token`
	}

	async init() {
		this.collection = new Collection<KookBotRecord>({
			name: this.collectionName,
			persistence: await this.ctx.pluginData.persistenceForCollection<KookBotRecord>(this.collectionName),
			indices: [createIndex('mode'), createIndex('state'), createIndex('updatedAt')],
		})
		this.readyPromise = this.collection.isReady()
	}

	whenReady() {
		return this.readyPromise ?? Promise.resolve()
	}

	async getToken(id: string) {
		const token = await this.vault.getToken(this.tokenKey(id))
		if (!token) throw new Error('KOOK bot token 缺失（vault 中未找到），请重新添加 bot')
		return token
	}

	async create(input: CreateBotInput): Promise<KookBotPublic> {
		const token = input.token.trim()
		if (!token) throw new Error('token 不能为空')
		const now = Date.now()
		const id = crypto.randomUUID()
		await this.vault.setToken(this.tokenKey(id), token)
		const doc: KookBotRecord = {
			id,
			mode: input.mode ?? 'gateway',
			verifyToken: input.verifyToken,
			createdAt: now,
			updatedAt: now,
			state: 'initializing',
			stateMessage: '等待连接',
			secure: true,
			tokenPreview: maskToken(token),
		}
		try {
			await this.collection.insert(doc)
		} catch (e) {
			await this.vault.deleteToken(this.tokenKey(id)).catch(() => {})
			throw e
		}
		return doc
	}

	async delete(id: string) {
		const ok = Boolean(await this.collection.removeOne({ id }))
		if (ok) await this.vault.deleteToken(this.tokenKey(id)).catch(() => {})
		return ok
	}

	findOne(id: string) {
		return this.collection.findOne({ id })
	}

	list(limit = 64) {
		return this.collection.find({}, { sort: { updatedAt: -1 }, limit }).fetch()
	}

	async update(id: string, patch: Partial<KookBotRecord>) {
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

	async updateBot(id: string, patch: UpdateBotInput): Promise<KookBotPublic | null> {
		const doc = this.findOne(id)
		if (!doc) return null
		await this.update(id, patch)
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
