/**
 * The OM selector language — how data-defined controls read the object model.
 *
 * Design invariant I14: bindings are SELECTORS, never executable. The grammar
 * below has no call, eval, or computed form — a selector is dot-separated
 * identifiers, each optionally qualified by ONE bracket:
 *
 *   move.axes            plain path
 *   move.axes[3]         index
 *   move.axes[visible]   filter: keep items whose named property is truthy
 *   move.axes[letter=C]  filter: keep items whose property equals the literal
 *   heat.heaters[2].active
 *
 * parseOmSelector is the sole constructor of the branded OmSelector (parse,
 * don't validate): anything outside the grammar yields null and cannot exist
 * past the boundary. Evaluation is total and read-only — a missing field
 * reads as undefined (the OM's "tolerate missing fields" rule), never a
 * throw. Injection is unrepresentable, not filtered.
 */

interface Segment {
	key: string;
	/** At most one qualifier per segment. */
	qualifier?:
		| { kind: "index"; index: number }
		| { kind: "truthy"; prop: string }
		| { kind: "equals"; prop: string; value: string };
}

declare const brand: unique symbol;
/** Only parseOmSelector can make one. */
export type OmSelector = { readonly segments: readonly Segment[]; readonly text: string } & { readonly [brand]: true };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The boundary: a runtime string becomes a selector here or nowhere. */
export function parseOmSelector(raw: string): OmSelector | null {
	if (typeof raw !== "string" || raw.trim() === "") return null;
	const segments: Segment[] = [];
	for (const part of raw.trim().split(".")) {
		const m = /^([^[\]]+)(?:\[([^[\]]+)\])?$/.exec(part);
		if (m === null) return null;
		const key = m[1]!;
		if (!IDENT.test(key)) return null;
		const seg: Segment = { key };
		const bracket = m[2];
		if (bracket !== undefined) {
			if (/^\d+$/.test(bracket)) {
				seg.qualifier = { kind: "index", index: Number(bracket) };
			} else {
				const eq = bracket.indexOf("=");
				if (eq >= 0) {
					const prop = bracket.slice(0, eq);
					const value = bracket.slice(eq + 1);
					if (!IDENT.test(prop) || value === "") return null;
					seg.qualifier = { kind: "equals", prop, value };
				} else {
					if (!IDENT.test(bracket)) return null;
					seg.qualifier = { kind: "truthy", prop: bracket };
				}
			}
		}
		segments.push(seg);
	}
	if (segments.length === 0) return null;
	return { segments, text: raw.trim() } as unknown as OmSelector;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function applyQualifier(value: unknown, q: NonNullable<Segment["qualifier"]>): unknown {
	if (!Array.isArray(value)) return undefined;
	switch (q.kind) {
		case "index":
			return value[q.index];
		case "truthy":
			return value.filter(item => isRecord(item) && Boolean(item[q.prop]));
		case "equals":
			return value.filter(item => isRecord(item) && String(item[q.prop]) === q.value);
	}
}

/**
 * Total, read-only evaluation: walk the path, apply qualifiers; anything
 * missing or mis-shaped reads as undefined.
 */
export function readOm(root: unknown, selector: OmSelector): unknown {
	let current: unknown = root;
	for (const seg of selector.segments) {
		if (!isRecord(current)) return undefined;
		current = (current as Record<string, unknown>)[seg.key];
		if (seg.qualifier !== undefined) {
			current = applyQualifier(current, seg.qualifier);
		}
	}
	return current;
}

/** readOm coerced to a collection — what forEach enumerates. */
export function readOmList(root: unknown, selector: OmSelector): unknown[] {
	const value = readOm(root, selector);
	return Array.isArray(value) ? value : [];
}
