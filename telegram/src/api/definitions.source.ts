import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build-time macro entry.
 * Import this module with `with { type: 'macro' }` and call the function to inline the array.
 */
export function telegramApiDefinitions(): Array<readonly [string, string]> {
	return parseTelegramApiDefinitions(readDefinitionsTxt())
}

function readDefinitionsTxt(): string {
	const here = path.dirname(fileURLToPath(import.meta.url))
	return fs.readFileSync(path.join(here, 'definitions.txt'), 'utf8')
}

function parseTelegramApiDefinitions(raw: string): Array<readonly [string, string]> {
	const out: Array<readonly [string, string]> = []
	for (const originalLine of raw.split(/\r?\n/)) {
		const line = originalLine.replace(/#.*/, '').trim()
		if (!line) continue
		const parts = line.split(/\s+/g).filter(Boolean)
		if (parts.length !== 2) {
			throw new Error(`[telegram-api] invalid definitions.txt line: ${JSON.stringify(originalLine)}`)
		}
		out.push([parts[0], parts[1]])
	}
	return out
}
