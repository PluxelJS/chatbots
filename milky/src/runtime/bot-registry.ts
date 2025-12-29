import crypto from 'node:crypto'
import { Collection, createIndex } from '@pluxel/hmr/signaldb'
import type { Context } from '@pluxel/hmr'
import type { MilkyBotStatus } from '../shared/status'
import { maskSecret, normalizeBaseUrl as normalizeBaseUrlValue } from '../shared/utils'

export type BotState = MilkyBotStatus

type SecretFields = {
	accessTokenCiphertext: string
	accessTokenIv: string
	accessTokenTag: string
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

export type MilkyBotRecord = SecretFields &
	IdentityFields &
	RuntimeFields &
	AuditFields & {
		id: string
	}

export type MilkyBotPublic = Omit<
	MilkyBotRecord,
	'accessTokenCiphertext' | 'accessTokenIv' | 'accessTokenTag'
>

export type CreateBotInput = {
	baseUrl: string
	accessToken?: string
	name?: string
}

export type UpdateBotInput = Partial<Pick<CreateBotInput, 'baseUrl' | 'name'>> & {
	accessToken?: string
}

class TokenBox {
	private readonly key: Buffer

	constructor() {
		const seed =
			process.env.MILKY_BOT_SECRET_KEY ??
			process.env.BOT_ORCHESTRATOR_KEY ??
			'dev-milky-bot-secret'
		this.key = crypto.createHash('sha256').update(seed).digest()
	}

	encrypt(token?: string) {
		const raw = (token ?? '').trim()
		if (!raw) {
			return { accessTokenCiphertext: '', accessTokenIv: '', accessTokenTag: '', tokenPreview: '—' }
		}
		const iv = crypto.randomBytes(12)
		const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
		const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
		const tag = cipher.getAuthTag()
		return {
			accessTokenCiphertext: encrypted.toString('base64'),
			accessTokenIv: iv.toString('base64'),
			accessTokenTag: tag.toString('base64'),
			tokenPreview: maskSecret(raw),
		}
	}

	decrypt(record: Pick<MilkyBotRecord, 'accessTokenCiphertext' | 'accessTokenIv' | 'accessTokenTag'>) {
		if (!record.accessTokenCiphertext) return ''
		const iv = Buffer.from(record.accessTokenIv, 'base64')
		const tag = Buffer.from(record.accessTokenTag, 'base64')
		const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv)
		decipher.setAuthTag(tag)
		const decrypted = Buffer.concat([
			decipher.update(Buffer.from(record.accessTokenCiphertext, 'base64')),
			decipher.final(),
		])
		return decrypted.toString('utf8')
	}

}

const toPublic = (doc: MilkyBotRecord): MilkyBotPublic => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { accessTokenCiphertext, accessTokenIv, accessTokenTag, ...rest } = doc
	return rest
}

export class MilkyBotRegistry {
	private readonly tokenBox = new TokenBox()
	private collection!: Collection<MilkyBotRecord>
	private readyPromise: Promise<void> | null = null

	constructor(private readonly ctx: Context, private readonly collectionName = 'milky:bots') {}

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

	async create(input: CreateBotInput): Promise<MilkyBotPublic> {
		const now = Date.now()
		const baseUrl = normalizeBaseUrlValue(input.baseUrl)
		const enc = this.tokenBox.encrypt(input.accessToken)

		const doc: MilkyBotRecord = {
			id: crypto.randomUUID(),
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
			secure: Boolean(enc.accessTokenCiphertext),
			...enc,
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
			const enc = this.tokenBox.encrypt(patch.accessToken)
			Object.assign(nextPatch, enc)
			nextPatch.secure = Boolean(enc.accessTokenCiphertext)
		}

		await this.update(id, nextPatch)
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

	decryptAccessToken(record: Pick<MilkyBotRecord, 'accessTokenCiphertext' | 'accessTokenIv' | 'accessTokenTag'>) {
		return this.tokenBox.decrypt(record)
	}
}
