import crypto from 'node:crypto'
import { Collection, createIndex } from '@pluxel/hmr/signaldb'
import type { Context } from '@pluxel/hmr'
import type { Bot } from '../bot'

export type BotState = ReturnType<Bot['getStatusSnapshot']>

type TokenFields = {
	tokenPreview: string
}

type IdentityFields = {
	mode: 'polling' | 'webhook' | 'api'
	username?: string
	displayName?: string
}

type WebhookFields = {
	webhookUrl?: string
	webhookSecretToken?: string
}

type PollingFields = {
	pollingOffset?: number
	pollingBackoff?: number
}

type LifecycleFields = {
	state: BotState['state']
	stateMessage?: string
	lastError?: string
	lastUpdateId?: number
	lastUpdateAt?: number
	connectedAt?: number
}

type AuditFields = {
	createdAt: number
	updatedAt: number
	secure: boolean
}

export type TelegramBotRecord = TokenFields &
	IdentityFields &
	WebhookFields &
	PollingFields &
	LifecycleFields &
	AuditFields & {
		id: string
	}

export type TelegramBotPublic = TelegramBotRecord

export type CreateBotInput = {
	token: string
	mode?: 'polling' | 'webhook' | 'api'
	webhookUrl?: string
	webhookSecretToken?: string
}

export type UpdateBotInput = Partial<Pick<CreateBotInput, 'mode' | 'webhookUrl' | 'webhookSecretToken'>>
const maskToken = (token: string) => {
	if (token.length <= 8) return `${token.slice(0, 2)}***${token.slice(-2)}`
	return `${token.slice(0, 4)}…${token.slice(-4)}`
}

/**
 * 管理 Telegram Bot 的持久化、Vault token 管理和游标观察。
 */
export class TelegramBotRegistry {
	private readonly vault: ReturnType<Context['vault']['open']>
	private collection!: Collection<TelegramBotRecord>
	private readyPromise: Promise<void> | null = null

	constructor(
		private readonly ctx: Context,
		private readonly collectionName = 'telegram:bots',
	) {
		this.vault = ctx.vault.open()
	}

	private tokenKey(id: string) {
		return `${this.collectionName}:${id}:token`
	}

	async init() {
		this.collection = new Collection<TelegramBotRecord>({
			name: this.collectionName,
			persistence: await this.ctx.pluginData.persistenceForCollection<TelegramBotRecord>(this.collectionName),
			indices: [createIndex('mode'), createIndex('state'), createIndex('updatedAt')],
		})
		this.readyPromise = this.collection.isReady()
	}

	whenReady() {
		return this.readyPromise ?? Promise.resolve()
	}

	async getToken(id: string) {
		const token = await this.vault.getToken(this.tokenKey(id))
		if (!token) throw new Error('Telegram bot token 缺失（vault 中未找到），请重新添加 bot')
		return token
	}

	async create(input: CreateBotInput): Promise<TelegramBotPublic> {
		const token = input.token.trim()
		if (!token) throw new Error('token 不能为空')
		const now = Date.now()
		const id = crypto.randomUUID()
		await this.vault.setToken(this.tokenKey(id), token)
		const doc: TelegramBotRecord = {
			id,
			mode: input.mode ?? 'polling',
			state: 'initializing',
			stateMessage: '等待连接',
			username: undefined,
			displayName: undefined,
			lastError: undefined,
			lastUpdateAt: undefined,
			lastUpdateId: undefined,
			pollingOffset: undefined,
			pollingBackoff: undefined,
			webhookUrl: input.webhookUrl,
			webhookSecretToken: input.webhookSecretToken,
			connectedAt: undefined,
			createdAt: now,
			updatedAt: now,
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

	async update(id: string, patch: Partial<TelegramBotRecord>) {
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

	async updateBot(id: string, patch: UpdateBotInput): Promise<TelegramBotPublic | null> {
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
