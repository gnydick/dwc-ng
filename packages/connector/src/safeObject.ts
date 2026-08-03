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
 * @rung 4  static analysis — test/safe-walks.test.ts fails any file that
 *          imports safeEntries and ALSO uses raw Object.entries. The rule is
 *          self-selecting rather than an allowlist: importing this IS the
 *          declaration "I walk data I did not author", and the same import that
 *          makes a new boundary safe is the one that arms the check. Complying
 *          is free — safeEntries is generic and drops three keys that cannot
 *          occur in a locally-built record, so a trusted walk converts as a
 *          no-op, which is why the ban can be total instead of negotiated
 * @why JSON.parse creates "__proto__" as an OWN property — CreateDataProperty
 *      bypasses the setter — so a walk that assigns out[key] runs the prototype
 *      SETTER instead of adding an entry. The inputs are the SD card,
 *      localStorage, the board and other people's share files, none of which
 *      this app authored. Promoted from rung 3 on 2026-08-01, and the audit
 *      that did it found a live one: sanitizeCanvas returned an object wearing
 *      an attacker-chosen prototype while Object.keys showed nothing wrong
 * @debt the fence is per-FILE, so a module that walks untrusted data and never
 *       imports safeEntries is outside it — 17 raw walks elsewhere in src are
 *       correct today because each is over a locally-built record or an
 *       id-gated key, verified one at a time rather than by construction.
 *       Rung 7 is having every parse boundary return an Untrusted<T> whose
 *       only iterator is safeEntries, which makes the walk unwritable rather
 *       than merely detected.
 */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** False for the keys that reach the prototype chain instead of the object. */
export function isSafeKey(key: string): boolean {
	return !FORBIDDEN_KEYS.has(key);
}

/**
 * Object.entries minus the prototype-reaching keys — the only sanctioned way to
 * iterate a parsed-but-unvalidated object.
 *
 * Generic so it is a drop-in for Object.entries on a TYPED record too: a walk
 * over trusted data loses nothing by using it (the three dropped keys cannot
 * occur), which is what lets the fence below ban the raw form outright rather
 * than maintain a list of which walks are allowed to be unsafe.
 */
export function safeEntries<T>(value: Record<string, T>): Array<[string, T]> {
	return Object.entries(value).filter(([key]) => isSafeKey(key));
}

/** A non-null, non-array object — the JSON "object" shape. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
