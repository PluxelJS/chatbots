import { MILKY_API_DEFINITIONS } from './definitions.generated'

/**
 * Build-time macro entry.
 * Import this module with `with { type: 'macro' }` and call the function to inline the data.
 */
export function milkyApiEndpoints(): string[] {
	return MILKY_API_DEFINITIONS.map((d) => d.endpoint)
}

/**
 * Build-time macro entry.
 * Import this module with `with { type: 'macro' }` and call the function to inline the record.
 */
export function milkyApiStructIndex(): Record<
	string,
	{ inputStruct: string | null; outputStruct: string | null }
> {
	const out: Record<string, { inputStruct: string | null; outputStruct: string | null }> =
		Object.create(null)
	for (const d of MILKY_API_DEFINITIONS) {
		out[d.endpoint] = { inputStruct: d.inputStruct ?? null, outputStruct: d.outputStruct ?? null }
	}
	return out
}

