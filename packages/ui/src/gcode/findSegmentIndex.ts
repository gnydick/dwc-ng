/**
 * Binary search for the live playback position: the last segment whose
 * (monotonically non-decreasing) byte offset is <= filePosition. Everything
 * at or before this index is "already printed"; -1 means nothing has
 * printed yet (filePosition is before the first segment).
 */
export function findSegmentIndex(byteOffset: Float64Array, filePosition: number): number {
	let lo = 0;
	let hi = byteOffset.length - 1;
	let result = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (byteOffset[mid]! <= filePosition) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return result;
}
