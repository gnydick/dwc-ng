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
 *
 * @invariant untrusted-walks-cannot-reach-the-prototype
 * @rung 3  tests over the KNOWN boundaries — test/proto-pollution.test.ts feeds
 *          a "__proto__" payload through the six named ingress points (config
 *          store, OM merge, share import, control spec, orientation state) and
 *          asserts Object.prototype is untouched. The helper itself is rung 5,
 *          but which walks use it is not enforced: 24 raw Object.entries remain
 *          in src, correct only because each happens to be over trusted data
 * @why JSON.parse creates "__proto__" as an OWN property — CreateDataProperty
 *      bypasses the setter — so a naive walk that reads base[key] gets
 *      Object.prototype and merging into THAT poisons every object in the app.
 *      The inputs are the SD card, localStorage, the board and other people's
 *      share files, none of which this app authored
 * @debt this sentence says "must", which is the caller-precondition
 *       anti-pattern: the rule lives in prose and the tests cover only the
 *       boundaries that existed when they were written. Cheap promotion to 4 is
 *       the shape files/raw-transport-fence already uses — walk src and reject
 *       Object.entries inside the parse/ingress modules by path, so a NEW
 *       boundary is caught by construction rather than by someone remembering
 *       to extend the fixture. Rung 7 is having the parse boundaries return an
 *       Untrusted<T> whose only iterator is safeEntries.
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
