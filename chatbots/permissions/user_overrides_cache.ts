import { Decision } from './decision'
import type { PermissionRegistry } from './registry'
import type { GrantRow } from './db/schemas'
import { TrieBuilder } from './trie_builder'
import { PermissionProgram } from './program'
import type { GrantsStoreApi } from './store'

type Entry = {
	expiresAt: number
	/** null => negative cached (no overrides) */
	programs: Array<PermissionProgram | null> | null
}

type LruNode = {
	key: number
	value: Entry
	prev: LruNode | null
	next: LruNode | null
}

export class UserOverridesCache {
	private readonly cache = new Map<number, LruNode>()
	private head: LruNode | null = null
	private tail: LruNode | null = null

	constructor(
		private readonly registry: PermissionRegistry,
		private readonly store: GrantsStoreApi,
		private readonly options: { ttlMs: number; max: number },
	) {}

	static create(registry: PermissionRegistry, store: GrantsStoreApi, options: { ttlMs?: number; max?: number } = {}) {
		return new UserOverridesCache(registry, store, {
			ttlMs: Math.max(1, Math.floor(options.ttlMs ?? 10_000)),
			max: Math.max(1, Math.floor(options.max ?? 2000)),
		})
	}

	invalidate(userId: number): void {
		const node = this.cache.get(userId)
		if (!node) return
		this.unlink(node)
		this.cache.delete(userId)
	}

	clear(): void {
		this.cache.clear()
		this.head = null
		this.tail = null
	}

	private touch(node: LruNode) {
		if (this.head === node) return
		this.unlink(node)
		this.unshift(node)
	}

	private unlink(node: LruNode) {
		if (node.prev) node.prev.next = node.next
		if (node.next) node.next.prev = node.prev
		if (this.head === node) this.head = node.next
		if (this.tail === node) this.tail = node.prev
		node.prev = null
		node.next = null
	}

	private unshift(node: LruNode) {
		node.prev = null
		node.next = this.head
		if (this.head) this.head.prev = node
		this.head = node
		if (!this.tail) this.tail = node
	}

	private popTail() {
		const node = this.tail
		if (!node) return
		this.unlink(node)
		this.cache.delete(node.key)
	}

	private getFreshNode(userId: number, now: number): LruNode | undefined {
		const node = this.cache.get(userId)
		if (!node) return undefined
		if (node.value.expiresAt <= now) {
			this.unlink(node)
			this.cache.delete(userId)
			return undefined
		}
		this.touch(node)
		return node
	}

	private setNode(userId: number, entry: Entry) {
		const existing = this.cache.get(userId)
		if (existing) {
			existing.value = entry
			this.touch(existing)
		} else {
			const node: LruNode = { key: userId, value: entry, prev: null, next: null }
			this.cache.set(userId, node)
			this.unshift(node)
		}
		while (this.cache.size > this.options.max) this.popTail()
	}

	async getProgram(userId: number, nsIndex: number): Promise<PermissionProgram | null> {
		const entry = await this.getEntry(userId)
		if (!entry.programs) return null
		return entry.programs[nsIndex] ?? null
	}

	/**
	 * Sync fast path:
	 * - returns undefined if cache-miss/expired (caller must fall back to async getProgram())
	 * - returns null if negative cached (no overrides) OR no program for nsIndex
	 */
	getProgramSync(userId: number, nsIndex: number): PermissionProgram | null | undefined {
		const entry = this.peekEntry(userId)
		if (!entry) return undefined
		if (!entry.programs) return null
		return entry.programs[nsIndex] ?? null
	}

	private peekEntry(userId: number): Entry | undefined {
		const now = Date.now()
		const node = this.getFreshNode(userId, now)
		return node?.value
	}

	private async getEntry(userId: number): Promise<Entry> {
		const now = Date.now()
		const cached = this.getFreshNode(userId, now)
		if (cached) return cached.value

		const grants = await this.store.listGrants('user', userId)
		const programs = this.compile(grants)
		const entry: Entry = { expiresAt: now + this.options.ttlMs, programs }
		this.setNode(userId, entry)
		return entry
	}

	private compile(grants: GrantRow[]): Array<PermissionProgram | null> | null {
		if (!grants.length) return null
		const builders = new Map<number, TrieBuilder>()
		const pathCache = new Map<string, Uint32Array>()
		for (const g of grants) {
			const nsIndex = this.registry.getNamespaceIndex(g.nsKey)
			if (nsIndex === null) continue
			const ns = this.registry.getNamespaceByIndex(nsIndex)
			if (!ns) continue

			let b = builders.get(nsIndex)
			if (!b) {
				b = new TrieBuilder()
				builders.set(nsIndex, b)
			}

			const cacheKey = `${nsIndex}:${g.local}`
			let path = pathCache.get(cacheKey)
			if (!path) {
				path = ns.interner.compileLocal(g.local)
				pathCache.set(cacheKey, path)
			}
			const effect = g.effect === 'allow' ? Decision.Allow : Decision.Deny
			if (g.kind === 'star') b.setStar(effect, path)
			else b.setExact(effect, path)
		}

		const out: Array<PermissionProgram | null> = []
		for (const [nsIndex, b] of builders) out[nsIndex] = b.freeze()
		return out
	}

	// eviction is handled by LRU popTail() in setNode()
}
