import { Decision } from './decision'

export const FLAG_EXACT_ALLOW = 1 << 0
export const FLAG_EXACT_DENY = 1 << 1
export const FLAG_STAR_ALLOW = 1 << 2
export const FLAG_STAR_DENY = 1 << 3

export type ProgramMatch =
	| { kind: 'none' }
	| { kind: 'star'; depth: number; effect: Decision.Allow | Decision.Deny }
	| { kind: 'exact'; effect: Decision.Allow | Decision.Deny }

export type ProgramExplanation = {
	decision: Decision
	match: ProgramMatch
}

export class PermissionProgram {
	constructor(
		readonly flags: Uint8Array,
		readonly first: Int32Array,
		readonly count: Int32Array,
		readonly edgeSeg: Uint32Array,
		readonly edgeTo: Int32Array,
	) {}

	static empty(): PermissionProgram {
		return new PermissionProgram(new Uint8Array([0]), new Int32Array([0]), new Int32Array([0]), new Uint32Array(0), new Int32Array(0))
	}

	private findChild(node: number, seg: number): number {
		const start = this.first[node]!
		const cnt = this.count[node]!
		if (cnt <= 0) return -1
		let lo = start
		let hi = start + cnt - 1
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1
			const m = this.edgeSeg[mid]!
			if (m === seg) return this.edgeTo[mid]!
			if (m < seg) lo = mid + 1
			else hi = mid - 1
		}
		return -1
	}

	decide(path: Uint32Array): Decision {
		let node = 0
		let best: Decision = Decision.Unset
		let matchedDepth = 0

		// root-star
		const rootFlags = this.flags[0]!
		if (rootFlags & FLAG_STAR_DENY) best = Decision.Deny
		else if (rootFlags & FLAG_STAR_ALLOW) best = Decision.Allow

		for (let depth = 0; depth < path.length; depth++) {
			const next = this.findChild(node, path[depth]!)
			if (next < 0) break
			node = next
			matchedDepth = depth + 1
			const f = this.flags[node]!
			if (f & FLAG_STAR_DENY) best = Decision.Deny
			else if (f & FLAG_STAR_ALLOW) best = Decision.Allow
		}

		if (matchedDepth === path.length) {
			const f = this.flags[node]!
			if (f & FLAG_EXACT_DENY) return Decision.Deny
			if (f & FLAG_EXACT_ALLOW) return Decision.Allow
		}
		return best
	}

	/**
	 * Explain which rule wins for a given path within this program.
	 *
	 * Not used in hot-path checks; intended for debugging/UI traces.
	 */
	explain(path: Uint32Array): ProgramExplanation {
		let node = 0
		let bestStar: { depth: number; effect: Decision.Allow | Decision.Deny } | null = null
		let matchedDepth = 0

		// root-star
		const rootFlags = this.flags[0]!
		if (rootFlags & FLAG_STAR_DENY) bestStar = { depth: 0, effect: Decision.Deny }
		else if (rootFlags & FLAG_STAR_ALLOW) bestStar = { depth: 0, effect: Decision.Allow }

		for (let depth = 0; depth < path.length; depth++) {
			const next = this.findChild(node, path[depth]!)
			if (next < 0) break
			node = next
			matchedDepth = depth + 1
			const f = this.flags[node]!
			if (f & FLAG_STAR_DENY) bestStar = { depth: matchedDepth, effect: Decision.Deny }
			else if (f & FLAG_STAR_ALLOW) bestStar = { depth: matchedDepth, effect: Decision.Allow }
		}

		if (matchedDepth === path.length) {
			const f = this.flags[node]!
			if (f & FLAG_EXACT_DENY) return { decision: Decision.Deny, match: { kind: 'exact', effect: Decision.Deny } }
			if (f & FLAG_EXACT_ALLOW) return { decision: Decision.Allow, match: { kind: 'exact', effect: Decision.Allow } }
		}

		if (bestStar) return { decision: bestStar.effect, match: { kind: 'star', depth: bestStar.depth, effect: bestStar.effect } }
		return { decision: Decision.Unset, match: { kind: 'none' } }
	}

	hasExact(path: Uint32Array): boolean {
		const node = this.walk(path)
		if (node < 0) return false
		const f = this.flags[node]!
		return (f & (FLAG_EXACT_ALLOW | FLAG_EXACT_DENY)) !== 0
	}

	hasStar(prefixPath: Uint32Array): boolean {
		const node = this.walk(prefixPath)
		if (node < 0) return false
		const f = this.flags[node]!
		return (f & (FLAG_STAR_ALLOW | FLAG_STAR_DENY)) !== 0
	}

	private walk(path: Uint32Array): number {
		let node = 0
		for (let i = 0; i < path.length; i++) {
			const next = this.findChild(node, path[i]!)
			if (next < 0) return -1
			node = next
		}
		return node
	}

	// keep class minimal; flags are exported constants
}
