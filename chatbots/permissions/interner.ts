export class SegmentInterner {
	private readonly ids = new Map<string, number>()
	private nextId = 1

	intern(segment: string): number {
		const s = segment
		const existing = this.ids.get(s)
		if (existing !== undefined) return existing
		const id = this.nextId++
		this.ids.set(s, id)
		return id
	}

	/**
	 * Compile `a.b.c` -> Uint32Array([id(a), id(b), id(c)])
	 * Constraints:
	 * - no `split()`
	 * - single-pass scan by `.` (we do two scans: count + fill, but no split/regex/arrays of segments)
	 */
	compileLocal(local: string): Uint32Array {
		const text = local.trim()
		if (!text) return new Uint32Array(0)

		let count = 1
		for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 46) count++

		const out = new Uint32Array(count)
		let start = 0
		let k = 0
		for (let i = 0; i <= text.length; i++) {
			if (i === text.length || text.charCodeAt(i) === 46) {
				const seg = text.slice(start, i)
				if (!seg) throw new Error('Invalid local permission: empty segment')
				out[k++] = this.intern(seg)
				start = i + 1
			}
		}
		return out
	}
}

