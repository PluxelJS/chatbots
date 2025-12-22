import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build-time macro entry.
 * Import this module with `with { type: 'macro' }` and call the function to inline the array.
 */
export function kookAutoEndpoints(): Array<readonly [string, string, string]> {
	return parseKookAutoEndpoints(readEndpointsTxt())
}

function readEndpointsTxt(): string {
	const here = path.dirname(fileURLToPath(import.meta.url))
	return fs.readFileSync(path.join(here, 'endpoints.txt'), 'utf8')
}

function parseKookAutoEndpoints(raw: string): Array<readonly [string, string, string]> {
	const out: Array<readonly [string, string, string]> = []
	for (const originalLine of raw.split(/\r?\n/)) {
		const line = originalLine.replace(/#.*/, '').trim()
		if (!line) continue
		const parts = line.split(/\s+/g).filter(Boolean)
		if (parts.length !== 3) {
			throw new Error(`[kook-api] invalid endpoints.txt line: ${JSON.stringify(originalLine)}`)
		}
		out.push([parts[0], parts[1], parts[2]])
	}
	return out
}
