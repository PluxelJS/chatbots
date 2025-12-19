import { Decision } from './decision'
import { FLAG_EXACT_ALLOW, FLAG_EXACT_DENY, FLAG_STAR_ALLOW, FLAG_STAR_DENY, PermissionProgram } from './program'

class Node {
	flags = 0
	children = new Map<number, Node>()
}

export class TrieBuilder {
	private readonly root = new Node()

	setExact(effect: Decision.Allow | Decision.Deny, path: Uint32Array): void {
		const node = this.ensure(path)
		if (effect === Decision.Allow) {
			node.flags = (node.flags & ~FLAG_EXACT_DENY) | FLAG_EXACT_ALLOW
		} else {
			node.flags = (node.flags & ~FLAG_EXACT_ALLOW) | FLAG_EXACT_DENY
		}
	}

	setStar(effect: Decision.Allow | Decision.Deny, prefixPath: Uint32Array): void {
		const node = this.ensure(prefixPath)
		if (effect === Decision.Allow) {
			node.flags = (node.flags & ~FLAG_STAR_DENY) | FLAG_STAR_ALLOW
		} else {
			node.flags = (node.flags & ~FLAG_STAR_ALLOW) | FLAG_STAR_DENY
		}
	}

	freeze(): PermissionProgram {
		const nodes: Node[] = []
		const stack: Node[] = [this.root]
		while (stack.length) {
			const n = stack.pop()!
			const idx = nodes.length
			nodes.push(n)
			;(n as any).__idx = idx
			for (const child of n.children.values()) stack.push(child)
		}

		let totalEdges = 0
		for (const n of nodes) totalEdges += n.children.size

		const flags = new Uint8Array(nodes.length)
		const first = new Int32Array(nodes.length)
		const count = new Int32Array(nodes.length)
		const edgeSeg = new Uint32Array(totalEdges)
		const edgeTo = new Int32Array(totalEdges)

		let edgeCursor = 0
		for (let i = 0; i < nodes.length; i++) {
			const n = nodes[i]!
			flags[i] = n.flags
			first[i] = edgeCursor
			count[i] = n.children.size

			if (n.children.size === 0) continue
			const entries = Array.from(n.children.entries())
			entries.sort((a, b) => a[0] - b[0])
			for (const [seg, toNode] of entries) {
				edgeSeg[edgeCursor] = seg >>> 0
				edgeTo[edgeCursor] = (toNode as any).__idx
				edgeCursor++
			}
		}

		return new PermissionProgram(flags, first, count, edgeSeg, edgeTo)
	}

	private ensure(path: Uint32Array): Node {
		let cur = this.root
		for (let i = 0; i < path.length; i++) {
			const seg = path[i]!
			let next = cur.children.get(seg)
			if (!next) {
				next = new Node()
				cur.children.set(seg, next)
			}
			cur = next
		}
		return cur
	}
}
