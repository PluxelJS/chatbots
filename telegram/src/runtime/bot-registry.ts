import crypto from 'node:crypto'
import { Collection, createIndex } from '@pluxel/hmr/signaldb'
import type { PluginContext } from '@pluxel/hmr'
import type { Bot } from '../bot'

export type BotState = ReturnType<Bot['getStatusSnapshot']>

type SecretFields = {
	tokenCiphertext: string
	tokenIv: string
	tokenTag: string
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

export type TelegramBotRecord = SecretFields &
	IdentityFields &
	WebhookFields &
	PollingFields &
	LifecycleFields &
	AuditFields & {
		id: string
	}

export type TelegramBotPublic = Omit<TelegramBotRecord, 'tokenCiphertext' | 'tokenIv' | 'tokenTag'>

export type CreateBotInput = {
	token: string
	mode?: 'polling' | 'webhook' | 'api'
	webhookUrl?: string
	webhookSecretToken?: string
}

export type UpdateBotInput = Partial<Pick<CreateBotInput, 'mode' | 'webhookUrl' | 'webhookSecretToken'>>

class TokenBox {
	private readonly key: Buffer

	constructor() {
		const seed =
			process.env.TELEGRAM_BOT_SECRET_KEY ??
			process.env.BOT_ORCHESTRATOR_KEY ??
			'dev-telegram-bot-secret'
		this.key = crypto.createHash('sha256').update(seed).digest()
	}

	encrypt(token: string) {
		const iv = crypto.randomBytes(12)
		const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
		const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
		const tag = cipher.getAuthTag()
		return {
			tokenCiphertext: encrypted.toString('base64'),
			tokenIv: iv.toString('base64'),
			tokenTag: tag.toString('base64'),
			tokenPreview: this.mask(token),
		}
	}

	decrypt(record: Pick<TelegramBotRecord, 'tokenCiphertext' | 'tokenIv' | 'tokenTag'>) {
		const iv = Buffer.from(record.tokenIv, 'base64')
		const tag = Buffer.from(record.tokenTag, 'base64')
		const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv)
		decipher.setAuthTag(tag)
		const decrypted = Buffer.concat([
			decipher.update(Buffer.from(record.tokenCiphertext, 'base64')),
			decipher.final(),
		])
		return decrypted.toString('utf8')
	}

	private mask(token: string) {
		if (token.length <= 8) return `${token.slice(0, 2)}***${token.slice(-2)}`
		return `${token.slice(0, 4)}…${token.slice(-4)}`
	}
}

const toPublic = (doc: TelegramBotRecord): TelegramBotPublic => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { tokenCiphertext, tokenIv, tokenTag, ...rest } = doc
	return rest
}

/**
 * 管理 Telegram Bot 的持久化、加密和游标观察。
 */
export class TelegramBotRegistry {
	private readonly tokenBox = new TokenBox()
	private collection!: Collection<TelegramBotRecord>
	private readyPromise: Promise<void> | null = null

	constructor(private readonly ctx: PluginContext, private readonly collectionName = 'telegram:bots') {}

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

	async create(input: CreateBotInput): Promise<TelegramBotPublic> {
		const token = input.token.trim()
		if (!token) throw new Error('token 不能为空')
		const now = Date.now()
		const encrypted = this.tokenBox.encrypt(token)
		const doc: TelegramBotRecord = {
			id: crypto.randomUUID(),
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
			...encrypted,
		}
		await this.collection.insert(doc)
		return toPublic(doc)
	}

	async delete(id: string) {
		return Boolean(await this.collection.removeOne({ id }))
	}

	findOne(id: string) {
		return this.collection.findOne({ id })
	}

	list(limit = 64) {
		return this.collection.find({}, { sort: { updatedAt: -1 }, limit }).fetch().map(toPublic)
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
		return next ? toPublic(next) : null
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

	decryptToken(record: Pick<TelegramBotRecord, 'tokenCiphertext' | 'tokenIv' | 'tokenTag'>) {
		return this.tokenBox.decrypt(record)
	}
}
