/**
 * The mock's ONE model-diff implementation (design D11: "diff computation
 * is mock-side truth"). DSF's sparse-diff semantics, mirrored exactly:
 *  - keys absent when unchanged
 *  - changed arrays are sent FULL-LENGTH (element-wise sparse arrays and
 *    shrinks are the CLIENT's merge problem, never the wire's)
 *  - null / primitive / type-changed values replace wholesale
 *  - a key that disappears is announced as null (DSF's "no value" form)
 *
 * A second structural differ anywhere in mock-duet is the tripwire that
 * the design has gone wrong — extend this one instead.
 */

/** Distinguishes "no change" from every representable JSON value. */
const UNCHANGED: unique symbol = Symbol("unchanged");

/**
 * Sparse diff from `prev` to `next`, or null when they are identical.
 * Both must be JSON-shaped (objects/arrays/primitives/null — what the
 * serializer in dsf.ts produces; `undefined` never occurs inside them).
 */
export function computeDsfDiff(
	prev: Record<string, unknown>,
	next: Record<string, unknown>,
): Record<string, unknown> | null {
	return diffObjects(prev, next);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diffObjects(
	prev: Record<string, unknown>,
	next: Record<string, unknown>,
): Record<string, unknown> | null {
	let out: Record<string, unknown> | null = null;
	for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
		const value = diffValue(prev[key], next[key]);
		if (value !== UNCHANGED) {
			(out ??= {})[key] = value;
		}
	}
	return out;
}

function diffValue(prev: unknown, next: unknown): unknown {
	// Key removed: DSF has no "delete" — absence is announced as null
	if (next === undefined) return prev === undefined ? UNCHANGED : null;
	if (Array.isArray(prev) && Array.isArray(next)) {
		// Arrays travel whole or not at all — including shrinks and grows
		return deepEqual(prev, next) ? UNCHANGED : next;
	}
	if (isPlainObject(prev) && isPlainObject(next)) {
		const child = diffObjects(prev, next);
		return child === null ? UNCHANGED : child;
	}
	// Primitives, nulls, and type changes (object→array etc.): replace
	return deepEqual(prev, next) ? UNCHANGED : next;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const keysA = Object.keys(a);
		if (keysA.length !== Object.keys(b).length) return false;
		for (const key of keysA) {
			if (!deepEqual(a[key], b[key])) return false;
		}
		return true;
	}
	return false;
}
