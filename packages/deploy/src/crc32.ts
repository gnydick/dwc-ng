// IEEE CRC-32, the checksum RRF's rr_upload verifies payloads against.
// Standard reflected algorithm, table built at module load.

const TABLE = (() => {
	const table = new Uint32Array(256)
	for (let i = 0; i < 256; i++) {
		let c = i
		for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[i] = c >>> 0
	}
	return table
})()

/** IEEE CRC-32 of `bytes`, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff
	for (const byte of bytes) crc = (TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
	return (crc ^ 0xffffffff) >>> 0
}

/** Lowercase hex, the form rr_upload's crc32 query parameter takes. */
export const crc32Hex = (bytes: Uint8Array): string => crc32(bytes).toString(16).padStart(8, "0")
