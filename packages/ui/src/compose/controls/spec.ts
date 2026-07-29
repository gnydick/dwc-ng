/**
 * Control-card specs — the data vocabulary a control surface is written in,
 * and its compile boundary.
 *
 * A ControlSpec is pure data: inputs (shared live values — step sizes, feeds)
 * and a tree of control nodes. compileControlSpec walks it ONCE, compiling
 * every template and selector through their own boundaries; the renderer
 * (ControlList.tsx) accepts ONLY the compiled artifact, so a control with an
 * unparsable template or selector cannot reach the screen (I13/I14 at the
 * spec level). Built-in specs compile at module load — a bad literal fails
 * tests, not operators.
 *
 * The vocabulary is deliberately closed (rung 8): `type` is a discriminated
 * union, forEach enrichments come from a compiled registry, and motion types
 * (jog-pad, axis-jog) emit through control/commands.ts — data can select
 * behavior, never define it.
 */
import { compileTemplate, type CompiledTemplate } from "./template.ts";
import { parseOmSelector, type OmSelector } from "./omSelector.ts";

export interface InputDef {
	kind: "number" | "chips";
	label: string;
	default: number;
	/** chips only: the selectable values. */
	options?: number[];
	unit?: string;
}

export type ButtonVariant = "go" | "danger" | "quiet";

export type ControlNode =
	| { type: "gcode-button"; label: string; template: string; variant?: ButtonVariant; stamp?: boolean; class?: string }
	| { type: "jog-pad"; step: string; feed: string }
	| { type: "axis-jog"; axisVar: string; step: string; feed: string }
	| { type: "row"; label?: string; sub?: string; class?: string; items: RowItem[] }
	| { type: "grid"; items: ControlNode[] }
	| {
		type: "forEach";
		from: string;
		as: string;
		/** Skip items whose property is one of these values (e.g. the cardinal
		 *  axes a jog pad already covers). */
		except?: { prop: string; values: string[] };
		/** Named, compiled item enrichment (see ENRICHMENT_IDS). */
		enrich?: EnrichmentId;
		node: ControlNode;
	};

export type RowItem = ControlNode | { input: string };

export interface ControlSpec {
	inputs: Record<string, InputDef>;
	nodes: ControlNode[];
}

/** Closed enrichment vocabulary — data names one, code defines it. */
export const ENRICHMENT_IDS = ["axisLabel"] as const;
export type EnrichmentId = (typeof ENRICHMENT_IDS)[number];

// ---- compiled forms (what the renderer accepts) ----

export type CompiledNode =
	| { type: "gcode-button"; label: CompiledTemplate; template: CompiledTemplate; variant?: ButtonVariant; stamp?: boolean; class?: string }
	| { type: "jog-pad"; step: string; feed: string }
	| { type: "axis-jog"; axisVar: string; step: string; feed: string }
	// label/sub are TEMPLATES here, not plain strings: a row emitted inside a
	// forEach needs to name its own item ("{axis.letter}"), which a literal
	// cannot do. Authored form stays a string; the compiler converts.
	| { type: "row"; label?: CompiledTemplate; sub?: CompiledTemplate; class?: string; items: CompiledRowItem[] }
	| { type: "grid"; items: CompiledNode[] }
	| { type: "forEach"; from: OmSelector; as: string; except?: { prop: string; values: string[] }; enrich?: EnrichmentId; node: CompiledNode };

export type CompiledRowItem = CompiledNode | { input: string };

declare const brand: unique symbol;
export type CompiledControlSpec = {
	readonly inputs: Record<string, InputDef>;
	readonly nodes: readonly CompiledNode[];
} & { readonly [brand]: true };

/**
 * The compile boundary. Throws with a path-named error on the first invalid
 * template/selector/input reference — built-in specs run this at module load
 * (fail fast, pinned by tests); imported specs (phase B2) will route the same
 * call through a catching parse.
 */
export function compileControlSpec(spec: ControlSpec): CompiledControlSpec {
	const inputNames = new Set(Object.keys(spec.inputs));

	const needInput = (name: string, where: string): void => {
		if (!inputNames.has(name)) throw new Error(`${where}: unknown input "${name}"`);
	};

	const tpl = (raw: string, where: string): CompiledTemplate => {
		const compiled = compileTemplate(raw);
		if (compiled === null) throw new Error(`${where}: invalid template "${raw}"`);
		return compiled;
	};

	const compileNode = (node: ControlNode, where: string): CompiledNode => {
		switch (node.type) {
			case "gcode-button":
				return {
					...node,
					label: tpl(node.label, `${where}.label`),
					template: tpl(node.template, `${where}.template`),
				};
			case "jog-pad":
				needInput(node.step, `${where}.step`);
				needInput(node.feed, `${where}.feed`);
				return node;
			case "axis-jog":
				needInput(node.step, `${where}.step`);
				needInput(node.feed, `${where}.feed`);
				return node;
			case "row": {
				const items = node.items.map((item, i) => {
					if ("input" in item) {
						needInput(item.input, `${where}.items[${i}]`);
						return item;
					}
					return compileNode(item, `${where}.items[${i}]`);
				});
				// Built explicitly rather than spread: `...node` would carry the
				// RAW string label through and the compiled node would hold two
				// incompatible shapes for the same field.
				const compiled: CompiledNode = { type: "row", items, class: node.class };
				if (node.label !== undefined) compiled.label = tpl(node.label, `${where}.label`);
				if (node.sub !== undefined) compiled.sub = tpl(node.sub, `${where}.sub`);
				return compiled;
			}
			case "grid":
				return { ...node, items: node.items.map((n, i) => compileNode(n, `${where}.items[${i}]`)) };
			case "forEach": {
				const from = parseOmSelector(node.from);
				if (from === null) throw new Error(`${where}.from: invalid selector "${node.from}"`);
				return { ...node, from, node: compileNode(node.node, `${where}.node`) };
			}
		}
	};

	return {
		inputs: spec.inputs,
		nodes: spec.nodes.map((n, i) => compileNode(n, `nodes[${i}]`)),
	} as unknown as CompiledControlSpec;
}
