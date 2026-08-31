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
import { unreachable } from "../../util/unreachable.ts";

/** A select's labeled option — the value may be a string, see the invariant. */
export interface SelectOption {
	label: string;
	value: number | string;
}

/**
 * @invariant operator-input-cannot-add-a-line
 * @rung 7  parse, don't validate at the sole constructor — every value an
 *          OPERATOR can stage is either a NUMBER (number/chips, and selects
 *          whose options are all numeric) or one of the AUTHOR'S OWN
 *          enumerated select strings, admitted only after compileControlSpec —
 *          the only producer of the branded CompiledControlSpec — has refused
 *          control characters (a newline has no escape in RRF — rejected, not
 *          encoded) AND double quotes (RRF starts a new command at a G/M
 *          letter outside a quoted string, so `"` in a value spliced into a
 *          quoted context like M98 P"…" is a quote-breakout) in it. There is
 *          still no free-text kind, and the select renderer stages by option
 *          INDEX, so nothing an operator TYPES can reach a template. What
 *          this deliberately does NOT do: quote or escape the value at
 *          resolution — resolveTemplate splices the enumerated string RAW,
 *          because rewriting it would emit a command the author never wrote
 *          (1:1 rule). The author-side power is unchanged by design: the
 *          author who enumerates option values is the same principal who
 *          writes the raw templates they land in, so enumeration + the
 *          import review's verbatim per-option inventory is the mechanism,
 *          not encoding. (Was rung 8 by "everything is a number" before
 *          selects existed.)
 * @why a control's template is arbitrary G-code by design, reviewed at import
 *      — including, now, every select option value (SpecReview.selects). The
 *      line COUNT of what it sends must still be the author's, not the
 *      operator's: a stageable value able to carry a newline — or to break
 *      out of the author's quoted string — would let a picked option append
 *      a second command to a control whose stamp shows one. That is not an
 *      escalation for the author, who writes the template anyway — it is a
 *      trap for the operator using the card, on a machine with heaters
 */
export type InputDef =
	| {
		kind: "number" | "chips";
		label: string;
		default: number;
		/** chips only: the selectable values. */
		options?: number[];
		unit?: string;
	}
	| {
		/** An enumerated choice with LABELED values (a dropdown): what chips
		 *  cannot say — named options, and string values for templates like
		 *  `M98 P"/macros/{input.macro}"`. Validated by compileControlSpec:
		 *  at least one option, default among the values, no control
		 *  characters in string values. */
		kind: "select";
		label: string;
		default: number | string;
		options: SelectOption[];
		unit?: string;
	};

/**
 * Whether every value this input can stage is a number. jog-pad/axis-jog
 * (cmd.jog) and slider (an HTML range) bind numeric value SPACES only —
 * compileControlSpec enforces it via needNumericInput, so the renderer's
 * numeric reads are total without a second check.
 */
export function isNumericInput(def: InputDef): boolean {
	// Exhaustive over the kinds, NOT `kind !== "select"`: a negative check
	// would silently classify a future string-capable kind as numeric — the
	// exact bindings (cmd.jog, HTML range) that must never see a string.
	// A new kind fails to compile here until it declares its value space.
	switch (def.kind) {
		case "number":
		case "chips":
			return true;
		case "select":
			return typeof def.default === "number" && def.options.every(opt => typeof opt.value === "number");
	}
	return unreachable(def);
}

export type ButtonVariant = "go" | "danger" | "quiet";

/**
 * Distribution of a container's children along its main axis — a PROPERTY of
 * the container nodes (row: horizontal; group and each columns entry:
 * vertical), never a node of its own. Rendered as one of four static classes;
 * untrusted strings are refused in parse.ts (the gcode-button variant
 * precedent). Positional stability holds because justify redistributes FREE
 * space only: every leaf control reserves its geometry against live updates
 * (tabular-nums + min-width value slots, reserved error/stamp slots), so a
 * polled value change cannot change any box and therefore cannot move a
 * justified sibling.
 */
export type Justify = "start" | "center" | "end" | "between";

/** One track of a columns split. The weight rides ON the column — a parallel
 *  weights array would make a length mismatch representable; this cannot. */
export interface ColumnDef {
	/** Track weight (fr ratio). Finite integer ≥ 1; absent = 1. */
	weight?: number;
	/** Vertical distribution of this column's stack. */
	justify?: Justify;
	nodes: ControlNode[];
}

/**
 * @invariant layout-nesting-refused-at-compile
 * @rung 7  sole-constructor boundary — compileControlSpec, the only producer
 *          of the branded CompiledControlSpec, refuses a columns node anywhere
 *          inside another columns node's subtree and any node tree deeper than
 *          MAX_NODE_DEPTH levels, so a compiled spec that violates either
 *          cannot exist and the renderer/review walks are bounded by type,
 *          not by care
 * @why a nested column split produces sub-quantum tracks that defeat the --u
 *      scale discipline (the GIT_170 quantum ruling), and an unbounded tree
 *      lets a hostile import trade a named error for a stack overflow deep in
 *      render. Refusal at the one compile boundary means built-ins fail the
 *      build and imported JSON gets the same path-named error
 */
export const MAX_NODE_DEPTH = 8;

export type ControlNode =
	| { type: "gcode-button"; label: string; template: string; variant?: ButtonVariant; stamp?: boolean; class?: string; aria?: string }
	| { type: "jog-pad"; step: string; feed: string }
	| { type: "axis-jog"; axisVar: string; step: string; feed: string }
	// Display-only OM value: selector + optional label/unit/format. The label
	// is a template (row-label precedent) so a readout stamped by a forEach
	// can name its item; the VALUE binding stays a plain selector — a read,
	// nothing more.
	| { type: "readout"; om: string; label?: string; unit?: string; decimals?: number }
	// A range control over a declared input. Label and unit come from the
	// input's own def (derive, don't duplicate); min/max/step are the HTML
	// range attributes and nothing more — no GUI clamping, the firmware is
	// the authority. The template is emitted once per completed value-change
	// gesture (RRF tolerates very few requests), held by the shared machine
	// in control/rangeGesture.ts — keyboard events are not wired at all, only
	// value changes open a gesture — and falsified by range-gesture.test.ts
	// (a held arrow key's change burst must settle into ONE send).
	| { type: "slider"; input: string; min: number; max: number; step?: number; template: string; stamp?: boolean }
	// A two-state control that READS its state from the polled OM (never an
	// internal latch — the board is the authority, so it converges when a
	// command fails or the state moves from elsewhere) and, on activation,
	// emits the alternative for the CURRENT state: whenOn while on (i.e. the
	// turn-off command), whenOff while off. Truthiness lives in ONE pipeline
	// (toggle.ts toggleStateOf); unknown state renders reserved-indeterminate
	// and is inert — representation honesty, not a GUI safety.
	| { type: "toggle"; om: string; label?: string; whenOn: string; whenOff: string; stamp?: boolean }
	| { type: "row"; label?: string; sub?: string; class?: string; justify?: Justify; items: RowItem[] }
	| { type: "grid"; items: ControlNode[] }
	// Structural nodes (GIT_194 inc 3, spec: 2026-08-30-layout-nodes-design.md).
	// They emit nothing and read nothing beyond a group label's template — the
	// share review walks their CONTENTS, forced by its totality weld.
	| { type: "columns"; rulers?: boolean; columns: ColumnDef[] }
	| { type: "group"; label?: string; class?: string; justify?: Justify; nodes: ControlNode[] }
	// Explicit authored gap: size in u (finite > 0) = fixed flex-basis; absent
	// = flexible (flex-grow) — the mechanism by which alignment is authored.
	| { type: "spacer"; size?: number }
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

/**
 * An input PLACEMENT inside a row. `type?: undefined` is load-bearing: a
 * slider NODE also carries an `input` field, so without it an InputRef and
 * a slider are structurally overlapping and TypeScript's negative narrowing
 * silently drops the slider from the union after an isInputRef check.
 */
export type InputRef = { input: string; type?: undefined };

export type RowItem = ControlNode | InputRef;

/**
 * THE row-item discriminator — "type" absence, not "input" presence: a
 * slider NODE also carries an `input` field, and matching on the key alone
 * passed a slider through the row compiler raw (found red on GIT_194, when
 * two of six hand-rolled copies of this check had drifted to the key-only
 * form). One helper, every typed site calls it; parse.ts applies the same
 * rule to its raw records at the untrusted boundary.
 */
export function isInputRef(item: RowItem | CompiledRowItem): item is InputRef {
	return "input" in item && !("type" in item);
}

export interface ControlSpec {
	inputs: Record<string, InputDef>;
	nodes: ControlNode[];
}

/** Closed enrichment vocabulary — data names one, code defines it. */
export const ENRICHMENT_IDS = ["axisLabel"] as const;
export type EnrichmentId = (typeof ENRICHMENT_IDS)[number];

// ---- compiled forms (what the renderer accepts) ----

export type CompiledNode =
	| { type: "gcode-button"; label: CompiledTemplate; template: CompiledTemplate; variant?: ButtonVariant; stamp?: boolean; class?: string; aria?: CompiledTemplate }
	| { type: "jog-pad"; step: string; feed: string }
	| { type: "axis-jog"; axisVar: string; step: string; feed: string }
	| { type: "readout"; om: OmSelector; label?: CompiledTemplate; unit?: string; decimals?: number }
	// step is CONCRETE here (authored default 1 applied once, at compile).
	| { type: "slider"; input: string; min: number; max: number; step: number; template: CompiledTemplate; stamp?: boolean }
	| { type: "toggle"; om: OmSelector; label?: CompiledTemplate; whenOn: CompiledTemplate; whenOff: CompiledTemplate; stamp?: boolean }
	// label/sub are TEMPLATES here, not plain strings: a row emitted inside a
	// forEach needs to name its own item ("{axis.letter}"), which a literal
	// cannot do. Authored form stays a string; the compiler converts.
	| { type: "row"; label?: CompiledTemplate; sub?: CompiledTemplate; class?: string; justify?: Justify; items: CompiledRowItem[] }
	| { type: "grid"; items: CompiledNode[] }
	// weight is CONCRETE here (authored default 1 applied once, at compile —
	// the slider-step precedent).
	| { type: "columns"; rulers?: boolean; columns: Array<{ weight: number; justify?: Justify; nodes: CompiledNode[] }> }
	| { type: "group"; label?: CompiledTemplate; class?: string; justify?: Justify; nodes: CompiledNode[] }
	| { type: "spacer"; size?: number }
	| { type: "forEach"; from: OmSelector; as: string; except?: { prop: string; values: string[] }; enrich?: EnrichmentId; node: CompiledNode };

export type CompiledRowItem = CompiledNode | InputRef;

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
 *
 * @invariant spec-compiles-whole
 * @rung 7  sole-constructor type — this is the only producer of the branded
 *          CompiledControlSpec, and it throws on the first bad reference rather
 *          than returning a partial spec, so nothing downstream can render a
 *          control whose bindings were never resolved
 * @why a half-compiled spec renders controls that look operable and send
 *      nothing, or send the wrong thing. Built-in specs run this at module
 *      load, so a broken one fails the build rather than the machine
 */
export function compileControlSpec(spec: ControlSpec): CompiledControlSpec {
	const inputNames = new Set(Object.keys(spec.inputs));

	// Input defs are validated HERE, the one boundary, so built-in literals
	// and untrusted JSON meet identical rules. Select is where the rules
	// have teeth: the operator-input-cannot-add-a-line invariant now admits
	// author-enumerated strings, and this walk is the mechanism that keeps
	// a newline (any control character) out of every stageable value.
	const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
	for (const [name, def] of Object.entries(spec.inputs)) {
		if (def.kind !== "select") continue;
		const where = `inputs.${name}`;
		if (!Array.isArray(def.options) || def.options.length === 0) {
			throw new Error(`${where}.options: a select needs at least one option`);
		}
		def.options.forEach((opt, i) => {
			if (typeof opt.value === "string") {
				if (CONTROL_CHARS.test(opt.value)) throw new Error(`${where}.options[${i}].value: control characters are not allowed in an option value`);
				// A `"` in a value spliced into a quoted context (M98 P"…")
				// closes the author's string — a quote-breakout, the in-line
				// sibling of the newline above. Refused, never escaped: see
				// the invariant.
				if (opt.value.includes('"')) throw new Error(`${where}.options[${i}].value: a double quote is not allowed in an option value`);
			} else if (!Number.isFinite(opt.value)) {
				throw new Error(`${where}.options[${i}].value: expected a finite number or a string`);
			}
		});
		if (!def.options.some(opt => opt.value === def.default)) {
			throw new Error(`${where}.default: must be one of the option values`);
		}
	}

	const needInput = (name: string, where: string): void => {
		if (!inputNames.has(name)) throw new Error(`${where}: unknown input "${name}"`);
	};

	/** For bindings whose value space must be numeric (cmd.jog, HTML range). */
	const needNumericInput = (name: string, where: string): void => {
		needInput(name, where);
		if (!isNumericInput(spec.inputs[name]!)) {
			throw new Error(`${where}: input "${name}" can stage a string — this binding needs a numeric input`);
		}
	};

	const tpl = (raw: string, where: string): CompiledTemplate => {
		const compiled = compileTemplate(raw);
		if (compiled === null) throw new Error(`${where}: invalid template "${raw}"`);
		return compiled;
	};

	/**
	 * depth counts every nesting edge (row items, grid items, forEach's node,
	 * group nodes, columns entries' nodes); inColumns is true anywhere inside a
	 * columns subtree — both refusals of layout-nesting-refused-at-compile
	 * live at this one entry, so no case below can be reached in violation.
	 */
	const compileNode = (node: ControlNode, where: string, depth: number, inColumns: boolean): CompiledNode => {
		if (depth > MAX_NODE_DEPTH) {
			throw new Error(`${where}: the node tree nests deeper than ${MAX_NODE_DEPTH} levels`);
		}
		switch (node.type) {
			case "gcode-button": {
				const compiled: CompiledNode = {
					...node,
					label: tpl(node.label, `${where}.label`),
					template: tpl(node.template, `${where}.template`),
					// Overwritten below or deleted: `...node` carried the RAW
					// string through, so without this the compiled node would
					// hold a string where a CompiledTemplate is declared.
					aria: undefined,
				};
				if (node.aria !== undefined) compiled.aria = tpl(node.aria, `${where}.aria`);
				else delete compiled.aria;
				return compiled;
			}
			case "jog-pad":
				needNumericInput(node.step, `${where}.step`);
				needNumericInput(node.feed, `${where}.feed`);
				return node;
			case "axis-jog":
				needNumericInput(node.step, `${where}.step`);
				needNumericInput(node.feed, `${where}.feed`);
				return node;
			case "readout": {
				const om = parseOmSelector(node.om);
				if (om === null) throw new Error(`${where}.om: invalid selector "${node.om}"`);
				// 0–8 covers any machine value; outside it (or fractional) is a
				// mistake, and rejecting HERE — the one compile boundary — is what
				// lets the renderer's toFixed be total without a second check.
				if (node.decimals !== undefined && (!Number.isInteger(node.decimals) || node.decimals < 0 || node.decimals > 8)) {
					throw new Error(`${where}.decimals: expected an integer 0–8`);
				}
				const compiled: CompiledNode = { type: "readout", om, unit: node.unit, decimals: node.decimals };
				if (node.label !== undefined) compiled.label = tpl(node.label, `${where}.label`);
				return compiled;
			}
			case "slider": {
				needNumericInput(node.input, `${where}.input`);
				if (!Number.isFinite(node.min) || !Number.isFinite(node.max) || !(node.min < node.max)) {
					throw new Error(`${where}: min must be less than max (finite numbers)`);
				}
				const step = node.step ?? 1;
				if (!Number.isFinite(step) || !(step > 0)) throw new Error(`${where}.step: expected a positive number`);
				return {
					type: "slider",
					input: node.input,
					min: node.min,
					max: node.max,
					step,
					template: tpl(node.template, `${where}.template`),
					stamp: node.stamp,
				};
			}
			case "toggle": {
				const om = parseOmSelector(node.om);
				if (om === null) throw new Error(`${where}.om: invalid selector "${node.om}"`);
				const compiled: CompiledNode = {
					type: "toggle",
					om,
					whenOn: tpl(node.whenOn, `${where}.whenOn`),
					whenOff: tpl(node.whenOff, `${where}.whenOff`),
					stamp: node.stamp,
				};
				if (node.label !== undefined) compiled.label = tpl(node.label, `${where}.label`);
				return compiled;
			}
			case "row": {
				const items = node.items.map((item, i) => {
					if (isInputRef(item)) {
						needInput(item.input, `${where}.items[${i}]`);
						return item;
					}
					return compileNode(item, `${where}.items[${i}]`, depth + 1, inColumns);
				});
				// Built explicitly rather than spread: `...node` would carry the
				// RAW string label through and the compiled node would hold two
				// incompatible shapes for the same field.
				const compiled: CompiledNode = { type: "row", items, class: node.class, justify: node.justify };
				if (node.label !== undefined) compiled.label = tpl(node.label, `${where}.label`);
				if (node.sub !== undefined) compiled.sub = tpl(node.sub, `${where}.sub`);
				return compiled;
			}
			case "grid":
				return { ...node, items: node.items.map((n, i) => compileNode(n, `${where}.items[${i}]`, depth + 1, inColumns)) };
			case "forEach": {
				const from = parseOmSelector(node.from);
				if (from === null) throw new Error(`${where}.from: invalid selector "${node.from}"`);
				return { ...node, from, node: compileNode(node.node, `${where}.node`, depth + 1, inColumns) };
			}
			case "columns": {
				if (inColumns) throw new Error(`${where}: columns cannot nest inside columns`);
				if (node.columns.length < 2) {
					throw new Error(`${where}.columns: a columns split needs at least two columns`);
				}
				const columns = node.columns.map((col, i) => {
					const cw = `${where}.columns[${i}]`;
					const weight = col.weight ?? 1;
					// Integer, not just finite: weights are fr RATIOS and a ratio
					// of integers says everything a fraction could (spec §1).
					if (!Number.isInteger(weight) || weight < 1) {
						throw new Error(`${cw}.weight: expected an integer ≥ 1`);
					}
					return {
						weight,
						justify: col.justify,
						nodes: col.nodes.map((n, j) => compileNode(n, `${cw}.nodes[${j}]`, depth + 1, true)),
					};
				});
				return { type: "columns", rulers: node.rulers, columns };
			}
			case "group": {
				const compiled: CompiledNode = {
					type: "group",
					class: node.class,
					justify: node.justify,
					nodes: node.nodes.map((n, i) => compileNode(n, `${where}.nodes[${i}]`, depth + 1, inColumns)),
				};
				if (node.label !== undefined) compiled.label = tpl(node.label, `${where}.label`);
				return compiled;
			}
			case "spacer": {
				// size > 0: a zero gap is the absence of a spacer (the slider
				// step > 0 precedent); absent = flexible, a REAL state, not 0.
				if (node.size !== undefined && (!Number.isFinite(node.size) || node.size <= 0)) {
					throw new Error(`${where}.size: expected a positive number of u`);
				}
				return node;
			}
		}
	};

	return {
		inputs: spec.inputs,
		nodes: spec.nodes.map((n, i) => compileNode(n, `nodes[${i}]`, 1, false)),
	} as unknown as CompiledControlSpec;
}
