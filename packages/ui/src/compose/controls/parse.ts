/**
 * The untrusted boundary for control specs (phase B2): JSON text from the
 * config overlay — or, later, an import file — in; a compiled spec or a
 * human-readable error out. Nothing else. The same closed vocabulary and the
 * same template/selector boundaries as the built-ins (spec.ts), so an
 * imported card can express exactly what a built-in can and nothing more
 * (I6/I13/I14): there is no field in which code could travel.
 *
 * Structure is validated FIELD BY FIELD before compileControlSpec runs —
 * unknown node types and wrong-typed fields are named errors, not silently
 * dropped, so an author sees precisely what's wrong. Unknown keys on a KNOWN
 * node are ignored rather than rejected: each validator rebuilds the node
 * from its declared fields only, so an unrecognised key cannot survive into
 * the compiled spec (and a reviewer of a shared card still sees everything
 * the card can do, because the review walks the rebuilt spec).
 */
import { compileControlSpec, ENRICHMENT_IDS, type ColumnDef, type CompiledControlSpec, type ControlNode, type ControlSpec, type InputDef, type Justify, type RowItem } from "./spec.ts";
import { isSafeKey } from "@dwc-ng/connector";

export type ParsedSpec =
	| { ok: true; spec: CompiledControlSpec; data: ControlSpec }
	| { ok: false; error: string };

const VARIANTS = new Set(["go", "danger", "quiet"]);
const JUSTIFY = new Set(["start", "center", "end", "between"]);

function fail(msg: string): never {
	throw new Error(msg);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${where}: expected an object`);
	return value as Record<string, unknown>;
}

function asString(value: unknown, where: string): string {
	if (typeof value !== "string") fail(`${where}: expected a string`);
	return value;
}

function asOptString(value: unknown, where: string): string | undefined {
	return value === undefined ? undefined : asString(value, where);
}

/** The closed justify vocabulary (the VARIANTS precedent for variant). */
function asOptJustify(value: unknown, where: string): Justify | undefined {
	if (value === undefined) return undefined;
	const v = asString(value, where);
	if (!JUSTIFY.has(v)) fail(`${where}: start | center | end | between`);
	return v as Justify;
}

function validateInput(raw: unknown, where: string): InputDef {
	const o = asRecord(raw, where);
	const kind = asString(o.kind, `${where}.kind`);
	if (kind === "select") {
		// Structure only — the semantic rules (non-empty, default among the
		// values, no control characters) live in compileControlSpec, the one
		// boundary built-ins share.
		const label = asString(o.label, `${where}.label`);
		if (typeof o.default !== "number" && typeof o.default !== "string") fail(`${where}.default: expected a number or a string`);
		if (!Array.isArray(o.options)) fail(`${where}.options: expected an array of { label, value }`);
		const options = o.options.map((opt, i) => {
			const rec = asRecord(opt, `${where}.options[${i}]`);
			if (typeof rec.value !== "number" && typeof rec.value !== "string") fail(`${where}.options[${i}].value: expected a number or a string`);
			return { label: asString(rec.label, `${where}.options[${i}].label`), value: rec.value };
		});
		const def: InputDef = { kind, label, default: o.default, options };
		if (o.unit !== undefined) def.unit = asString(o.unit, `${where}.unit`);
		return def;
	}
	if (kind !== "number" && kind !== "chips") fail(`${where}.kind: "number", "chips" or "select"`);
	if (typeof o.default !== "number") fail(`${where}.default: expected a number`);
	const def: InputDef = { kind, label: asString(o.label, `${where}.label`), default: o.default };
	if (o.options !== undefined) {
		if (!Array.isArray(o.options) || o.options.some(v => typeof v !== "number")) fail(`${where}.options: expected numbers`);
		def.options = o.options as number[];
	}
	if (o.unit !== undefined) def.unit = asString(o.unit, `${where}.unit`);
	return def;
}

function validateRowItem(raw: unknown, where: string): RowItem {
	const o = asRecord(raw, where);
	// Same rule as spec.ts isInputRef, applied to the raw record: "type"
	// absence decides, because a slider NODE also carries an `input` key.
	if ("input" in o && !("type" in o)) return { input: asString(o.input, `${where}.input`) };
	return validateNode(raw, where);
}

function validateNode(raw: unknown, where: string): ControlNode {
	const o = asRecord(raw, where);
	const type = asString(o.type, `${where}.type`);
	switch (type) {
		case "gcode-button": {
			const node: ControlNode = {
				type,
				label: asString(o.label, `${where}.label`),
				template: asString(o.template, `${where}.template`),
			};
			if (o.variant !== undefined) {
				const v = asString(o.variant, `${where}.variant`);
				if (!VARIANTS.has(v)) fail(`${where}.variant: go | danger | quiet`);
				node.variant = v as "go";
			}
			if (o.stamp !== undefined) {
				if (typeof o.stamp !== "boolean") fail(`${where}.stamp: expected a boolean`);
				node.stamp = o.stamp;
			}
			node.class = asOptString(o.class, `${where}.class`);
			node.aria = asOptString(o.aria, `${where}.aria`);
			return node;
		}
		case "jog-pad":
			return { type, step: asString(o.step, `${where}.step`), feed: asString(o.feed, `${where}.feed`) };
		case "axis-jog":
			return {
				type,
				axisVar: asString(o.axisVar, `${where}.axisVar`),
				step: asString(o.step, `${where}.step`),
				feed: asString(o.feed, `${where}.feed`),
			};
		case "readout": {
			const node: ControlNode = { type, om: asString(o.om, `${where}.om`) };
			node.label = asOptString(o.label, `${where}.label`);
			node.unit = asOptString(o.unit, `${where}.unit`);
			if (o.decimals !== undefined) {
				if (typeof o.decimals !== "number") fail(`${where}.decimals: expected a number`);
				node.decimals = o.decimals;
			}
			return node;
		}
		case "slider": {
			if (typeof o.min !== "number") fail(`${where}.min: expected a number`);
			if (typeof o.max !== "number") fail(`${where}.max: expected a number`);
			const node: ControlNode = {
				type,
				input: asString(o.input, `${where}.input`),
				min: o.min,
				max: o.max,
				template: asString(o.template, `${where}.template`),
			};
			if (o.step !== undefined) {
				if (typeof o.step !== "number") fail(`${where}.step: expected a number`);
				node.step = o.step;
			}
			if (o.stamp !== undefined) {
				if (typeof o.stamp !== "boolean") fail(`${where}.stamp: expected a boolean`);
				node.stamp = o.stamp;
			}
			return node;
		}
		case "toggle": {
			const node: ControlNode = {
				type,
				om: asString(o.om, `${where}.om`),
				whenOn: asString(o.whenOn, `${where}.whenOn`),
				whenOff: asString(o.whenOff, `${where}.whenOff`),
			};
			node.label = asOptString(o.label, `${where}.label`);
			if (o.stamp !== undefined) {
				if (typeof o.stamp !== "boolean") fail(`${where}.stamp: expected a boolean`);
				node.stamp = o.stamp;
			}
			return node;
		}
		case "row": {
			if (!Array.isArray(o.items)) fail(`${where}.items: expected an array`);
			const node: ControlNode = {
				type,
				label: asOptString(o.label, `${where}.label`),
				sub: asOptString(o.sub, `${where}.sub`),
				class: asOptString(o.class, `${where}.class`),
				items: o.items.map((item, i) => validateRowItem(item, `${where}.items[${i}]`)),
			};
			const justify = asOptJustify(o.justify, `${where}.justify`);
			if (justify !== undefined) node.justify = justify;
			return node;
		}
		case "grid": {
			if (!Array.isArray(o.items)) fail(`${where}.items: expected an array`);
			return { type, items: o.items.map((item, i) => validateNode(item, `${where}.items[${i}]`)) };
		}
		case "forEach": {
			const node: ControlNode = {
				type,
				from: asString(o.from, `${where}.from`),
				as: asString(o.as, `${where}.as`),
				node: validateNode(o.node, `${where}.node`),
			};
			if (o.except !== undefined) {
				const ex = asRecord(o.except, `${where}.except`);
				if (!Array.isArray(ex.values) || ex.values.some(v => typeof v !== "string")) fail(`${where}.except.values: expected strings`);
				node.except = { prop: asString(ex.prop, `${where}.except.prop`), values: ex.values as string[] };
			}
			if (o.enrich !== undefined) {
				const e = asString(o.enrich, `${where}.enrich`);
				if (!(ENRICHMENT_IDS as readonly string[]).includes(e)) fail(`${where}.enrich: unknown enrichment "${e}"`);
				node.enrich = e as (typeof ENRICHMENT_IDS)[number];
			}
			return node;
		}
		case "columns": {
			if (!Array.isArray(o.columns)) fail(`${where}.columns: expected an array`);
			const node: ControlNode = {
				type,
				columns: o.columns.map((col, i) => {
					const cw = `${where}.columns[${i}]`;
					const c = asRecord(col, cw);
					if (!Array.isArray(c.nodes)) fail(`${cw}.nodes: expected an array`);
					const entry: ColumnDef = {
						nodes: c.nodes.map((n, j) => validateNode(n, `${cw}.nodes[${j}]`)),
					};
					if (c.weight !== undefined) {
						if (typeof c.weight !== "number") fail(`${cw}.weight: expected a number`);
						entry.weight = c.weight;
					}
					const justify = asOptJustify(c.justify, `${cw}.justify`);
					if (justify !== undefined) entry.justify = justify;
					return entry;
				}),
			};
			if (o.rulers !== undefined) {
				if (typeof o.rulers !== "boolean") fail(`${where}.rulers: expected a boolean`);
				node.rulers = o.rulers;
			}
			return node;
		}
		case "group": {
			if (!Array.isArray(o.nodes)) fail(`${where}.nodes: expected an array`);
			const node: ControlNode = {
				type,
				label: asOptString(o.label, `${where}.label`),
				class: asOptString(o.class, `${where}.class`),
				nodes: o.nodes.map((n, i) => validateNode(n, `${where}.nodes[${i}]`)),
			};
			const justify = asOptJustify(o.justify, `${where}.justify`);
			if (justify !== undefined) node.justify = justify;
			return node;
		}
		case "spacer": {
			const node: ControlNode = { type };
			if (o.size !== undefined) {
				if (typeof o.size !== "number") fail(`${where}.size: expected a number`);
				node.size = o.size;
			}
			return node;
		}
		default:
			return fail(`${where}.type: unknown control type "${type}"`);
	}
}

/** JSON text → compiled spec, or a named error. Never throws. */
export function parseControlSpecText(text: string): ParsedSpec {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (err) {
		return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
	}
	try {
		const root = asRecord(json, "spec");
		const inputsRaw = root.inputs === undefined ? {} : asRecord(root.inputs, "inputs");
		const inputs: Record<string, InputDef> = {};
		for (const [name, def] of Object.entries(inputsRaw)) {
			// Untrusted side rejects, never skips: a prototype-reaching input
			// name is a named error, not a silently vanishing input.
			if (!isSafeKey(name)) fail(`inputs: "${name}" is not a usable input name`);
			inputs[name] = validateInput(def, `inputs.${name}`);
		}
		if (!Array.isArray(root.nodes)) fail("nodes: expected an array");
		const nodes = root.nodes.map((n, i) => validateNode(n, `nodes[${i}]`));
		const data: ControlSpec = { inputs, nodes };
		return { ok: true, spec: compileControlSpec(data), data };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
