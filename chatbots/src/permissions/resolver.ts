import { SegmentInterner } from './interner'
import type { PermissionKind } from './registry'
import type { PermissionRegistry } from './registry'

export type NodeRef = {
	nsIndex: number
	path: Uint32Array
	ver: number
}

export type ResolvedGrant = NodeRef & {
	nsKey: string
	kind: PermissionKind
	/** normalized local: exact => full local; star => prefixLocal (root-star => "") */
	local: string
}

class LruNode<V> {
	constructor(
		readonly key: string,
		readonly value: V,
		public prev: LruNode<V> | null,
		public next: LruNode<V> | null,
	) {}
}

class LruMap<V> {
	private head: LruNode<V> | null = null
	private tail: LruNode<V> | null = null
	private readonly map = new Map<string, LruNode<V>>()

	constructor(private readonly max: number) {}

	get(key: string): V | undefined {
		const node = this.map.get(key)
		if (!node) return undefined
		this.touch(node)
		return node.value
	}

	set(key: string, value: V): void {
		const existing = this.map.get(key)
		if (existing) {
			this.deleteNode(existing)
		}
		const node = new LruNode(key, value, null, null)
		this.map.set(key, node)
		this.unshift(node)
		while (this.map.size > this.max) this.pop()
	}

	private touch(node: LruNode<V>) {
		if (this.head === node) return
		this.deleteNode(node)
		this.unshift(node)
	}

	private unshift(node: LruNode<V>) {
		node.prev = null
		node.next = this.head
		if (this.head) this.head.prev = node
		this.head = node
		if (!this.tail) this.tail = node
	}

	private pop() {
		const node = this.tail
		if (!node) return
		this.deleteNode(node)
		this.map.delete(node.key)
	}

	private deleteNode(node: LruNode<V>) {
		if (node.prev) node.prev.next = node.next
		if (node.next) node.next.prev = node.prev
		if (this.head === node) this.head = node.next
		if (this.tail === node) this.tail = node.prev
		node.prev = null
		node.next = null
	}
}

export class Resolver {
	private readonly cache: LruMap<NodeRef>

	constructor(
		private readonly registry: PermissionRegistry,
		options: { cacheMax?: number } = {},
	) {
		this.cache = new LruMap<NodeRef>(Math.max(1, Math.floor(options.cacheMax ?? 5000)))
	}

	/** Resolve an EXACT node for authorization. Undeclared nodes resolve to null (caller treats as Deny). */
	resolve(node: string): NodeRef | null {
		const cached = this.cache.get(node)
		if (cached) {
			const nowVer = this.registry.getNamespaceEpoch(cached.nsIndex)
			if (cached.ver === nowVer) return cached
		}

		const parsed = parseNode(node)
		if (!parsed) return null
		const { nsKey, local } = parsed
		if (local.includes('*')) return null

		const nsIndex = this.registry.getNamespaceIndex(nsKey)
		if (nsIndex === null) return null
		const ns = this.registry.getNamespaceByIndex(nsIndex)
		if (!ns) return null

		let path: Uint32Array
		try {
			path = ns.interner.compileLocal(local)
		} catch {
			return null
		}
		if (!ns.program.hasExact(path)) return null

		const ref: NodeRef = { nsIndex, path, ver: ns.epoch }
		this.cache.set(node, ref)
		return ref
	}

	/**
	 * Resolve for grant/revoke:
	 * - validates wildcard rules
	 * - normalizes (kind, local)
	 * - validates existence in current in-memory catalog (exact or star)
	 */
	resolveGrant(node: string): ResolvedGrant | null {
		const parsed = parseNode(node)
		if (!parsed) return null
		const { nsKey, local } = parsed

		const nsIndex = this.registry.getNamespaceIndex(nsKey)
		if (nsIndex === null) return null
		const ns = this.registry.getNamespaceByIndex(nsIndex)
		if (!ns) return null

		const r = parseLocalWithWildcard(local)
		if (!r) return null

		const interner: SegmentInterner = ns.interner
		let path: Uint32Array
		try {
			path = interner.compileLocal(r.local)
		} catch {
			return null
		}
		if (r.kind === 'exact') {
			if (!ns.program.hasExact(path)) return null
		} else {
			if (!ns.program.hasStar(path)) return null
		}

		return { nsKey, nsIndex, path, ver: ns.epoch, kind: r.kind, local: r.local }
	}
}

function parseNode(node: string): { nsKey: string; local: string } | null {
	const s = node.trim()
	const dot = s.indexOf('.')
	if (dot <= 0 || dot === s.length - 1) return null
	const nsKey = s.slice(0, dot).trim()
	const local = s.slice(dot + 1).trim()
	if (!nsKey || !local) return null
	return { nsKey, local }
}

function parseLocalWithWildcard(local: string): { kind: PermissionKind; local: string } | null {
	if (local === '*') return { kind: 'star', local: '' }
	if (local.endsWith('.*')) {
		const prefix = local.slice(0, -2)
		if (!prefix) return null
		if (prefix.includes('*')) return null
		return { kind: 'star', local: prefix }
	}
	if (local.includes('*')) return null
	return { kind: 'exact', local }
}
