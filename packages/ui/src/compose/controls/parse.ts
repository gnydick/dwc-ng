/**
 * The untrusted boundary for control specs (phase B2): JSON text from the
 * config overlay — or, later, an import file — in; a compiled spec or a
 * human-readable error out. Nothing else. The same closed vocabulary and the
 * same template/selector boundaries as the built-ins (spec.ts), so an
 * imported card can express exactly what a built-in can and nothing more
 * (I6/I13/I14): there is no field in which code could travel.
 *
 * Structure is validated FIELD BY FIELD before compileControlSpec runs —
 * unknown node types, wrong-typed fields, and unknown keys are named errors,
 * not silently dropped: an author should see precisely what's wrong, and a
 * reviewer of a shared card should know the file contains nothing the
 * vocabulary can't say.
 */
import { compileControlSpec, ENRICHMENT_IDS, type CompiledControlSpec, type ControlNode, type ControlSpec, type InputDef, type RowItem } from "./spec.ts";
import { isSafeKey } from "../../util/safeObject.ts";

export type ParsedSpec =
	| { ok: true; spec: CompiledControlSpec; data: ControlSpec }
	| { ok: false; error: string };

const VARIANTS = new Set(["go", "danger", "quiet"]);

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

function validateInput(raw: unknown, where: string): InputDef {
	const o = asRecord(raw, where);
	const kind = asString(o.kind, `${where}.kind`);
	if (kind !== "number" && kind !== "chips") fail(`${where}.kind: "number" or "chips"`);
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
		case "row": {
			if (!Array.isArray(o.items)) fail(`${where}.items: expected an array`);
			return {
				type,
				label: asOptString(o.label, `${where}.label`),
				sub: asOptString(o.sub, `${where}.sub`),
				class: asOptString(o.class, `${where}.class`),
				items: o.items.map((item, i) => validateRowItem(item, `${where}.items[${i}]`)),
			};
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
