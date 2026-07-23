/**
 * The one iteration/shape kernel for walking UNTRUSTED plain objects —
 * JSON.parse output from the SD card, localStorage, the board, share files.
 *
 * Why this exists: JSON.parse creates "__proto__" as an OWN property
 * (CreateDataProperty semantics bypass the setter), so a naive
 * Object.entries walk that assigns `out[key]` or recurses into `base[key]`
 * reads and writes through the prototype chain instead of the object —
 * `base["__proto__"]` yields Object.prototype, and merging into THAT
 * pollutes every object in the app. safeEntries() removes the possibility
 * at any call site that uses it: the prototype-reaching keys are simply
 * not in the iteration.
 *
 * Every walk over parsed-but-unvalidated data must go through
 * safeEntries(); Object.entries is for trusted, locally-constructed
 * records only.
 */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** False for the keys that reach the prototype chain instead of the object. */
export function isSafeKey(key: string): boolean {
	return !FORBIDDEN_KEYS.has(key);
}

/** Object.entries minus the prototype-reaching keys — the only sanctioned
 *  way to iterate a parsed-but-unvalidated object. */
export function safeEntries(value: Record<string, unknown>): Array<[string, unknown]> {
	return Object.entries(value).filter(([key]) => isSafeKey(key));
}

/** A non-null, non-array object — the JSON "object" shape. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
