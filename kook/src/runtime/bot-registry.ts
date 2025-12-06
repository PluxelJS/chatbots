import crypto from 'node:crypto'
import { Collection, createIndex } from '@pluxel/hmr/signaldb'
import type { Context } from '@pluxel/hmr'
import type { Bot } from '../bot'
import { BotMode } from '../config'

export type BotState = ReturnType<Bot['getStatusSnapshot']>

type SecretFields = {
	tokenCiphertext: string
	tokenIv: string
	tokenTag: string
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

export type KookBotRecord = SecretFields &
	IdentityFields &
	GatewayFields &
	LifecycleFields &
	AuditFields & {
		id: string
	}

export type KookBotPublic = Omit<KookBotRecord, keyof SecretFields>

export type CreateBotInput = {
	token: string
	mode?: (typeof BotMode)[number]
	verifyToken?: string
}

export type UpdateBotInput = Partial<Pick<CreateBotInput, 'mode' | 'verifyToken'>>

class TokenBox {
	private readonly key: Buffer

	constructor() {
		const seed =
			process.env.KOOK_BOT_SECRET_KEY ??
			process.env.BOT_ORCHESTRATOR_KEY ??
			'dev-kook-bot-secret-key'
		this.key = crypto.createHash('sha256').update(seed).digest()
	}

	encrypt(token: string) {
		const iv = crypto.randomBytes(12)
		const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
		const enc = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
		const tag = cipher.getAuthTag()
		return {
			tokenCiphertext: enc.toString('base64'),
			tokenIv: iv.toString('base64'),
			tokenTag: tag.toString('base64'),
			tokenPreview: this.mask(token),
		}
	}

	decrypt(record: Pick<KookBotRecord, 'tokenCiphertext' | 'tokenIv' | 'tokenTag'>) {
		const iv = Buffer.from(record.tokenIv, 'base64')
		const tag = Buffer.from(record.tokenTag, 'base64')
		const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv)
		decipher.setAuthTag(tag)
		const dec = Buffer.concat([
			decipher.update(Buffer.from(record.tokenCiphertext, 'base64')),
			decipher.final(),
		])
		return dec.toString('utf8')
	}

	private mask(token: string) {
		if (token.length <= 8) return `${token.slice(0, 2)}***${token.slice(-2)}`
		return `${token.slice(0, 4)}…${token.slice(-4)}`
	}
}

const toPublic = (doc: KookBotRecord): KookBotPublic => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { tokenCiphertext, tokenIv, tokenTag, ...rest } = doc
	return rest
}

/**
 * 集中管理 Bot 持久化、加密与游标监听。
 */
export class KookBotRegistry {
	private readonly tokenBox = new TokenBox()
	private collection!: Collection<KookBotRecord>

	constructor(private readonly ctx: Context, private readonly collectionName = 'kook:bots') {}

	async init() {
		this.collection = new Collection<KookBotRecord>({
			name: this.collectionName,
			persistence: await this.ctx.pluginData.persistenceForCollection<KookBotRecord>(this.collectionName),
			indices: [createIndex('mode'), createIndex('state'), createIndex('updatedAt')],
		})
	}

	async create(input: CreateBotInput): Promise<KookBotPublic> {
		const token = input.token.trim()
		if (!token) throw new Error('token 不能为空')
		const now = Date.now()
		const encrypted = this.tokenBox.encrypt(token)
		const doc: KookBotRecord = {
			id: crypto.randomUUID(),
			mode: input.mode ?? 'gateway',
			verifyToken: input.verifyToken,
			createdAt: now,
			updatedAt: now,
			state: 'initializing',
			stateMessage: '等待连接',
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

	decryptToken(record: KookBotRecord) {
		return this.tokenBox.decrypt(record)
	}
}
