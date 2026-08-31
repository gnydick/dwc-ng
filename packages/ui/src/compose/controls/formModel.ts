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
import { isInputRef, type ButtonVariant, type ControlNode, type ControlSpec, type InputDef, type RowItem } from "./spec.ts";

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
	| { kind: "button"; label: string; template: string; variant: ButtonVariant | ""; stamp: boolean }
	// Optional spec fields ride as ""/null in the form ("" lowers to absent).
	| { kind: "readout"; om: string; label: string; unit: string; decimals: number | null }
	| { kind: "slider"; input: string; min: number; max: number; step: number | null; template: string; stamp: boolean };

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

export function emptyReadout(): FormItem {
	return { kind: "readout", om: "", label: "", unit: "", decimals: null };
}

/** Seeded with an input name (the first declared one, or "" — the compile
 *  boundary's path-named error then names what's missing in the preview). */
export function emptySlider(input: string): FormItem {
	return { kind: "slider", input, min: 0, max: 100, step: null, template: "", stamp: true };
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
		items: row.items.map((item): RowItem => {
			switch (item.kind) {
				case "input":
					return { input: item.name };
				case "button":
					return {
						type: "gcode-button",
						label: item.label,
						template: item.template,
						...(item.variant !== "" ? { variant: item.variant } : {}),
						...(item.stamp ? {} : { stamp: false }),
					};
				case "readout":
					return {
						type: "readout",
						om: item.om,
						...(item.label !== "" ? { label: item.label } : {}),
						...(item.unit !== "" ? { unit: item.unit } : {}),
						...(item.decimals !== null ? { decimals: item.decimals } : {}),
					};
				case "slider":
					return {
						type: "slider",
						input: item.input,
						min: item.min,
						max: item.max,
						...(item.step !== null ? { step: item.step } : {}),
						template: item.template,
						...(item.stamp ? {} : { stamp: false }),
					};
			}
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
			if (isInputRef(item)) {
				items.push({ kind: "input", name: item.input });
			} else if (item.type === "gcode-button") {
				if (item.class !== undefined) return null;
				items.push({ kind: "button", label: item.label, template: item.template, variant: item.variant ?? "", stamp: item.stamp !== false });
			} else if (item.type === "readout") {
				// Every readout field is form-representable — a readout always lifts.
				items.push({ kind: "readout", om: item.om, label: item.label ?? "", unit: item.unit ?? "", decimals: item.decimals ?? null });
			} else if (item.type === "slider") {
				// Likewise: min/max/step/template/stamp all have form fields.
				items.push({ kind: "slider", input: item.input, min: item.min, max: item.max, step: item.step ?? null, template: item.template, stamp: item.stamp !== false });
			} else {
				return null; // jog primitives / nested structure — JSON territory
			}
		}
		rows.push({ label: node.label ?? "", items });
	}
	return { inputs, rows };
}
