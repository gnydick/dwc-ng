/**
 * The card studio's form model — a GUI projection over ControlSpec.
 *
 * The form does not have its own semantics: it LOWERS to the same ControlSpec
 * the JSON mode edits and every card compiles from (toSpec), and LIFTS from a
 * spec when the spec fits the form's shape (tryFromSpec — flat rows of
 * buttons and input placements). A spec using the power vocabulary (forEach,
 * grid, jog primitives, placed classes) lifts to null and is edited as JSON —
 * the form never approximates what it can't show, so saving from the form
 * can never silently drop structure.
 *
 * Validation is NOT re-implemented here: the studio serializes and runs the
 * one untrusted boundary (parseControlSpecText), so the form, the JSON mode,
 * and a future import file are accepted or refused by identical rules.
 */
import type { ButtonVariant, ControlNode, ControlSpec, InputDef, RowItem } from "./spec.ts";

export interface FormInput {
	name: string;
	kind: "number" | "chips";
	label: string;
	default: number;
	/** chips: comma-separated in the UI, numbers here. */
	options: number[];
	unit: string;
}

export type FormItem =
	| { kind: "input"; name: string }
	| { kind: "button"; label: string; template: string; variant: ButtonVariant | ""; stamp: boolean };

export interface FormRow {
	label: string;
	items: FormItem[];
}

export interface FormState {
	inputs: FormInput[];
	rows: FormRow[];
}

export function emptyForm(): FormState {
	return { inputs: [], rows: [{ label: "", items: [] }] };
}

export function emptyButton(): FormItem {
	return { kind: "button", label: "", template: "", variant: "", stamp: true };
}

/** Form → spec. Total: any form state lowers (validity is the boundary's job). */
export function toSpec(form: FormState): ControlSpec {
	const inputs: Record<string, InputDef> = {};
	for (const input of form.inputs) {
		const def: InputDef = { kind: input.kind, label: input.label, default: input.default };
		if (input.kind === "chips") def.options = input.options;
		if (input.unit !== "") def.unit = input.unit;
		inputs[input.name] = def;
	}
	const nodes: ControlNode[] = form.rows.map(row => ({
		type: "row",
		...(row.label !== "" ? { label: row.label } : {}),
		items: row.items.map((item): RowItem =>
			item.kind === "input"
				? { input: item.name }
				: {
					type: "gcode-button",
					label: item.label,
					template: item.template,
					...(item.variant !== "" ? { variant: item.variant } : {}),
					...(item.stamp ? {} : { stamp: false }),
				}),
	}));
	return { inputs, nodes };
}

/**
 * Spec → form, when the spec is within the form's shape: rows containing only
 * gcode-buttons (without custom classes) and input placements. Anything else
 * returns null — edit as JSON.
 */
export function tryFromSpec(spec: ControlSpec): FormState | null {
	const inputs: FormInput[] = [];
	for (const [name, def] of Object.entries(spec.inputs)) {
		inputs.push({
			name,
			kind: def.kind,
			label: def.label,
			default: def.default,
			options: def.options ?? [],
			unit: def.unit ?? "",
		});
	}
	const rows: FormRow[] = [];
	for (const node of spec.nodes) {
		if (node.type !== "row" || node.sub !== undefined || node.class !== undefined) return null;
		const items: FormItem[] = [];
		for (const item of node.items) {
			if ("input" in item && !("type" in item)) {
				items.push({ kind: "input", name: item.input });
			} else if ((item as ControlNode).type === "gcode-button") {
				const b = item as ControlNode & { type: "gcode-button" };
				if (b.class !== undefined) return null;
				items.push({ kind: "button", label: b.label, template: b.template, variant: b.variant ?? "", stamp: b.stamp !== false });
			} else {
				return null; // jog primitives / nested structure — JSON territory
			}
		}
		rows.push({ label: node.label ?? "", items });
	}
	return { inputs, rows };
}
