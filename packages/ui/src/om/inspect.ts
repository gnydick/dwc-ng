/**
 * Pure helpers for rendering the object model as a tree. No Solid, no store —
 * just value classification and formatting, so the tricky bits (null-vs-object,
 * array indices, leaf formatting) are unit-testable on their own.
 */

import { parseOmSelector, type OmSelector } from "../compose/controls/omSelector.ts";

export type OmValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export function valueKind(value: unknown): OmValueKind {
	if (value === null || value === undefined) return "null";
	if (Array.isArray(value)) return "array";
	switch (typeof value) {
		case "number": return "number";
		case "string": return "string";
		case "boolean": return "boolean";
		default: return "object";
	}
}

/** True when the node has children worth expanding. */
export function isExpandable(value: unknown): boolean {
	return childKeys(value).length > 0;
}

/** Child keys: object keys sorted for a stable tree, array indices in order. */
export function childKeys(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) return value.map((_, i) => String(i));
	if (typeof value === "object") return Object.keys(value as object).sort();
	return [];
}

/** Scalar rendering; strings are quoted so "" is visible as a value. */
export function formatLeaf(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "string") return `"${value}"`;
	return String(value);
}

/**
 * One hop of a traversal through the tree: an object child (by key) or an
 * array element (by position). The PARENT mints the step, because only the
 * parent knows whether its children are keyed or indexed.
 */
export type PathStep =
	| { readonly kind: "key"; readonly key: string }
	| { readonly kind: "index"; readonly index: number };

/**
 * The picker's sole route from a traversal path to a copyable selector.
 *
 * @invariant pickable-implies-parseable
 * @rung 7  the return type is the branded OmSelector, whose sole constructor
 *          is parseOmSelector — this function cannot hand out a string the
 *          parser did not accept, because it has no way to mint the brand
 *          itself. Null means "this node has no selector" and the affordance
 *          is absent, not disabled-with-garbage
 * @why the inspector offers selectors for pasting into binding fields.
 *      Parsing the composed text is necessary but NOT sufficient: a key like
 *      "a.b" composes into text that parses fine and denotes a DIFFERENT
 *      path. So the parse result is also compared segment-by-segment against
 *      the path it was built from — "parses but means something else" fails
 *      to null exactly like "does not parse"
 *
 * Construction: key steps become dot-separated segments; an index step
 * becomes a `[n]` qualifier on the preceding key segment. Unbuildable shapes
 * (empty path, index at root, index straight after an index — one bracket per
 * segment in the grammar) return null before composing. Filter qualifiers
 * ([visible], [letter=C]) are never synthesized — the path cannot know which
 * filter the user means; indices are the only qualifier a traversal implies.
 */
export function selectorForPath(path: readonly PathStep[]): OmSelector | null {
	if (path.length === 0) return null;
	let text = "";
	let previous: PathStep["kind"] | null = null;
	for (const step of path) {
		if (step.kind === "key") {
			text += previous === null ? step.key : `.${step.key}`;
		} else {
			// A bracket needs a key segment to hang off, and the grammar allows
			// only one per segment.
			if (previous !== "key") return null;
			if (!Number.isInteger(step.index) || step.index < 0) return null;
			text += `[${step.index}]`;
		}
		previous = step.kind;
	}
	const selector = parseOmSelector(text);
	if (selector === null) return null;
	// Round-trip identity: re-express the path as the segment list it SHOULD
	// parse to, and require the parse to match exactly. Any divergence — extra
	// segments from a dotted key, a qualifier we did not put there — refuses
	// the selector.
	const expected: { key: string; qualifier?: { kind: "index"; index: number } }[] = [];
	for (const step of path) {
		if (step.kind === "key") expected.push({ key: step.key });
		else expected[expected.length - 1]!.qualifier = { kind: "index", index: step.index };
	}
	if (selector.segments.length !== expected.length) return null;
	for (let i = 0; i < expected.length; i++) {
		const want = expected[i]!;
		const got = selector.segments[i]!;
		if (got.key !== want.key) return null;
		if (want.qualifier === undefined) {
			if (got.qualifier !== undefined) return null;
		} else if (
			got.qualifier === undefined ||
			got.qualifier.kind !== "index" ||
			got.qualifier.index !== want.qualifier.index
		) {
			return null;
		}
	}
	return selector;
}

/** Collapsed summary of a container, e.g. "{4}" / "[7]"; empty reads as "{}" / "[]". */
export function summarize(value: unknown): string {
	if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.length}]`;
	if (value !== null && value !== undefined && typeof value === "object") {
		const count = Object.keys(value as object).length;
		return count === 0 ? "{}" : `{${count}}`;
	}
	return formatLeaf(value);
}
