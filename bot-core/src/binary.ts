import { Buffer } from 'node:buffer'

export const toNodeBuffer = (data: ArrayBufferLike | ArrayBufferView | Buffer): Buffer => {
	if (Buffer.isBuffer(data)) return data
	if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
	if (data instanceof ArrayBuffer) return Buffer.from(data)
	// SharedArrayBuffer / other ArrayBufferLike
	if (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer) return Buffer.from(data as any)
	return Buffer.from(new Uint8Array(data))
}
