/**
 * Pure helpers for rendering the object model as a tree. No Solid, no store —
 * just value classification and formatting, so the tricky bits (null-vs-object,
 * array indices, leaf formatting) are unit-testable on their own.
 */

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

/** Collapsed summary of a container, e.g. "{4}" / "[7]"; empty reads as "{}" / "[]". */
export function summarize(value: unknown): string {
	if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.length}]`;
	if (value !== null && value !== undefined && typeof value === "object") {
		const count = Object.keys(value as object).length;
		return count === 0 ? "{}" : `{${count}}`;
	}
	return formatLeaf(value);
}
