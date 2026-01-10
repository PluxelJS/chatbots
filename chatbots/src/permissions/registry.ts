import { Decision } from './decision'
import { SegmentInterner } from './interner'
import { PermissionProgram } from './program'
import { TrieBuilder } from './trie_builder'

export type PermissionKind = 'exact' | 'star'
export type PermissionEffect = 'allow' | 'deny'

export interface PermissionMeta {
	description?: string
	tags?: string[]
	hidden?: boolean
	deprecated?: boolean
}

export interface DeclaredPermission {
	kind: PermissionKind
	/** local for exact; localPrefix for star (root-star is empty string) */
	local: string
	default: PermissionEffect
	meta?: PermissionMeta
}

type NamespaceState = {
	key: string
	index: number
	epoch: number
	active: boolean
	interner: SegmentInterner
	builder: TrieBuilder
	program: PermissionProgram
	metaByKind: { exact: Map<string, PermissionMeta | undefined>; star: Map<string, PermissionMeta | undefined> }
	defaultByKind: { exact: Map<string, PermissionEffect>; star: Map<string, PermissionEffect> }
}

export class PermissionRegistry {
	private readonly byKey = new Map<string, NamespaceState>()
	private readonly byIndex: Array<NamespaceState | undefined> = []
	private nextIndex = 0

	getNamespaceIndex(nsKey: string): number | null {
		const ns = this.byKey.get(nsKey)
		if (!ns || !ns.active) return null
		return ns.index
	}

	getNamespaceByIndex(nsIndex: number): NamespaceState | null {
		const ns = this.byIndex[nsIndex]
		if (!ns || !ns.active) return null
		return ns
	}

	getNamespaceEpoch(nsIndex: number): number {
		return this.byIndex[nsIndex]?.epoch ?? 0
	}

	listNamespaces(): string[] {
		const out: string[] = []
		for (const ns of this.byIndex) if (ns?.active) out.push(ns.key)
		return out
	}

	listPermissions(nsKey: string): Array<DeclaredPermission & { node: string }> {
		const ns = this.byKey.get(nsKey)
		if (!ns || !ns.active) return []
		const out: Array<DeclaredPermission & { node: string }> = []
		for (const [local, def] of ns.defaultByKind.exact) {
			out.push({
				kind: 'exact',
				local,
				default: def,
				meta: ns.metaByKind.exact.get(local),
				node: `${nsKey}.${local}`,
			})
		}
		for (const [local, def] of ns.defaultByKind.star) {
			out.push({
				kind: 'star',
				local,
				default: def,
				meta: ns.metaByKind.star.get(local),
				node: `${nsKey}.${local ? `${local}.*` : '*'}`
			})
		}
		out.sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0))
		return out
	}

	/**
	 * Host manages namespace lifecycle. On unload/remove, epoch bumps and cached NodeRefs are invalidated.
	 */
	removeNamespace(nsKey: string): void {
		const ns = this.byKey.get(nsKey)
		if (!ns) return
		ns.active = false
		ns.epoch++
		// release memory; epoch bump ensures all cached NodeRefs are rejected
		ns.interner = new SegmentInterner()
		ns.builder = new TrieBuilder()
		ns.program = PermissionProgram.empty()
		ns.metaByKind.exact.clear()
		ns.metaByKind.star.clear()
		ns.defaultByKind.exact.clear()
		ns.defaultByKind.star.clear()
	}

	ensureNamespace(nsKey: string): NamespaceState {
		let ns = this.byKey.get(nsKey)
		if (!ns) {
			const index = this.nextIndex++
			ns = {
				key: nsKey,
				index,
				epoch: 1,
				active: true,
				interner: new SegmentInterner(),
				builder: new TrieBuilder(),
				program: PermissionProgram.empty(),
				metaByKind: { exact: new Map(), star: new Map() },
				defaultByKind: { exact: new Map(), star: new Map() },
			}
			this.byKey.set(nsKey, ns)
			this.byIndex[index] = ns
			return ns
		}

		if (!ns.active) {
			ns.active = true
			ns.epoch++
			ns.interner = new SegmentInterner()
			ns.builder = new TrieBuilder()
			ns.program = PermissionProgram.empty()
			ns.metaByKind.exact.clear()
			ns.metaByKind.star.clear()
			ns.defaultByKind.exact.clear()
			ns.defaultByKind.star.clear()
		}
		return ns
	}

	declareExact(nsKey: string, local: string, def: { default: PermissionEffect } & PermissionMeta = { default: 'deny' }): void {
		validateLocalExact(local)
		const ns = this.ensureNamespace(nsKey)
		const path = ns.interner.compileLocal(local)
		ns.builder.setExact(def.default === 'allow' ? Decision.Allow : Decision.Deny, path)
		ns.program = ns.builder.freeze()
		ns.metaByKind.exact.set(local, stripDefault(def))
		ns.defaultByKind.exact.set(local, def.default)
	}

	declareStar(
		nsKey: string,
		localPrefix: string,
		def: { default: PermissionEffect } & PermissionMeta = { default: 'deny' },
	): void {
		validateLocalStarPrefix(localPrefix)
		const ns = this.ensureNamespace(nsKey)
		const path = ns.interner.compileLocal(localPrefix)
		ns.builder.setStar(def.default === 'allow' ? Decision.Allow : Decision.Deny, path)
		ns.program = ns.builder.freeze()
		ns.metaByKind.star.set(localPrefix, stripDefault(def))
		ns.defaultByKind.star.set(localPrefix, def.default)
	}
}

function stripDefault(def: { default: PermissionEffect } & PermissionMeta): PermissionMeta | undefined {
	const { default: _d, ...meta } = def
	return Object.keys(meta).length ? meta : undefined
}

function validateLocalExact(local: string) {
	const s = local.trim()
	if (!s) throw new Error('Invalid local permission: empty')
	if (s.includes('*')) throw new Error('Invalid exact permission: "*" not allowed')
	if (s.startsWith('.') || s.endsWith('.')) throw new Error('Invalid local permission: leading/trailing "."')
}

function validateLocalStarPrefix(prefix: string) {
	const s = prefix.trim()
	if (s.includes('*')) throw new Error('Invalid star permission: "*" not allowed in prefix')
	if (s && (s.startsWith('.') || s.endsWith('.'))) throw new Error('Invalid local permission prefix')
}
