import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOmSelector, readOm, readOmList } from "../src/compose/controls/omSelector.ts";
import { compileTemplate, resolveTemplate, type TemplateScope } from "../src/compose/controls/template.ts";
import { compileControlSpec, isInputRef, type CompiledControlSpec, type CompiledNode } from "../src/compose/controls/spec.ts";
import type { CompiledTemplate } from "../src/compose/controls/template.ts";
import { HOMING_SPEC, MOVEMENT_SPEC } from "../src/compose/controls/builtin.ts";
import { cmd } from "../src/control/commands.ts";
import { unreachable } from "../src/util/unreachable.ts";

// ---- I14: the selector grammar — no eval form representable ----

test("selector grammar accepts paths, indexes, and filters", () => {
	assert.ok(parseOmSelector("move.axes"));
	assert.ok(parseOmSelector("move.axes[3].letter"));
	assert.ok(parseOmSelector("move.axes[visible]"));
	assert.ok(parseOmSelector("move.axes[letter=C]"));
	assert.ok(parseOmSelector("heat.heaters[2].active"));
});

test("selector grammar rejects everything outside it — injection has no encoding", () => {
	for (const bad of [
		"", "   ", "a..b", "a.b()", "constructor.constructor", // dots/idents only — () not in grammar
		"a[b()]", "a[1+1]", "a['x']", "a[\"x\"]", "a[b.c]", "a[=]", "a[x=]",
		"a b", "a-b.c", "a[0][1]", "__proto__()", "a.{b}",
	]) {
		// constructor/__proto__ as PLAIN identifiers parse (they're just keys) —
		// the ones with calls, quotes, or arithmetic must not.
		if (bad === "constructor.constructor") continue;
		assert.equal(parseOmSelector(bad), null, `must reject: ${bad}`);
	}
});

test("evaluation is total and read-only", () => {
	const om = {
		move: { axes: [
			{ letter: "X", visible: true, machinePosition: 5 },
			{ letter: "U", visible: false },
			{ letter: "C", visible: true },
		] },
	};
	assert.equal(readOm(om, parseOmSelector("move.axes[0].letter")!), "X");
	assert.equal(readOm(om, parseOmSelector("move.axes[9].letter")!), undefined, "missing index reads undefined");
	assert.equal(readOm(om, parseOmSelector("no.such.path")!), undefined);
	assert.deepEqual(
		(readOmList(om, parseOmSelector("move.axes[visible]")!) as Array<{ letter: string }>).map(a => a.letter),
		["X", "C"],
	);
	assert.deepEqual(
		(readOmList(om, parseOmSelector("move.axes[letter=C]")!) as Array<{ letter: string }>).map(a => a.letter),
		["C"],
	);
	assert.deepEqual(readOmList(om, parseOmSelector("move.axes[0].letter")!), [], "non-array coerces to empty list");
});

// ---- templates: compile boundary + total resolution ----

const scope = (input: Record<string, number>, om: unknown = {}, vars: Record<string, unknown> = {}): TemplateScope => ({
	input: name => input[name],
	om,
	vars,
});

test("templates compile placeholders or fail whole", () => {
	assert.ok(compileTemplate("G28"));
	assert.ok(compileTemplate("G1 X{input.step} F{input.feed}"));
	assert.ok(compileTemplate("M104 S{om:heat.heaters[1].active}"));
	assert.ok(compileTemplate("G28 {axis.letter}"));
	assert.equal(compileTemplate("G1 X{unclosed"), null);
	assert.equal(compileTemplate("G1 X{}"), null);
	assert.equal(compileTemplate("G1 X{input.}"), null);
	assert.equal(compileTemplate("G1 X{om:a[b()]}"), null, "the selector boundary holds inside templates");
	assert.equal(compileTemplate("{justaname}"), null, "a bare name is not a form");
});

test("resolution substitutes inputs, om reads, and loop vars; missing = empty", () => {
	const tpl = compileTemplate("G1 {axis.letter}{input.step} F{input.feed} ;{om:state.status}")!;
	const out = resolveTemplate(tpl, scope({ step: 10, feed: 6000 }, { state: { status: "idle" } }, { axis: { letter: "U" } }));
	assert.equal(out, "G1 U10 F6000 ;idle");
	const gap = resolveTemplate(tpl, scope({}, {}, {}));
	assert.equal(gap, "G1  F ;", "missing values render visibly empty, never throw");
});

// ---- spec compile boundary ----

test("a spec referencing an unknown input or bad template cannot compile", () => {
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "jog-pad", step: "step", feed: "feed" }],
	}), /unknown input/);
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "gcode-button", label: "X", template: "G1 {nope}" }],
	}), /invalid template/);
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "forEach", from: "move.axes[b()]", as: "a", node: { type: "gcode-button", label: "x", template: "G4" } }],
	}), /invalid selector/);
});

// ---- readout + slider (GIT_194): compile boundary ----

test("readout and slider compile through the sole boundary", () => {
	const spec = compileControlSpec({
		inputs: { speed: { kind: "number", label: "Speed", default: 100, unit: "%" } },
		nodes: [
			{ type: "readout", om: "heat.heaters[1].current", label: "Nozzle", unit: "°C", decimals: 1 },
			{ type: "slider", input: "speed", min: 0, max: 200, step: 5, template: "M220 S{input.speed}" },
			{ type: "slider", input: "speed", min: 0, max: 200, template: "M220 S{input.speed}" },
		],
	});
	const readout = spec.nodes[0]!;
	assert.equal(readout.type, "readout");
	if (readout.type === "readout") {
		assert.equal(readout.om.text, "heat.heaters[1].current", "selector compiled, not carried raw");
		assert.equal(readout.decimals, 1);
	}
	const slider = spec.nodes[2]!;
	assert.equal(slider.type, "slider");
	if (slider.type === "slider") {
		assert.equal(slider.step, 1, "omitted step compiles to the concrete default");
		assert.equal(slider.template.text, "M220 S{input.speed}");
	}
});

test("readout rejects bad selectors and out-of-range decimals, path-named", () => {
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "readout", om: "a[b()]" }],
	}), /nodes\[0\]\.om: invalid selector/);
	for (const decimals of [9, 1.5, -1, Number.NaN]) {
		assert.throws(() => compileControlSpec({
			inputs: {},
			nodes: [{ type: "readout", om: "state.status", decimals }],
		}), /nodes\[0\]\.decimals/, `decimals ${decimals} must not compile`);
	}
});

test("slider rejects unknown inputs, empty ranges, bad steps, bad templates", () => {
	const inputs = { speed: { kind: "number", label: "Speed", default: 100 } } as const;
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "slider", input: "speed", min: 0, max: 200, template: "M220 S{input.speed}" }],
	}), /nodes\[0\]\.input: unknown input "speed"/);
	assert.throws(() => compileControlSpec({
		inputs: { ...inputs },
		nodes: [{ type: "slider", input: "speed", min: 200, max: 200, template: "M220 S{input.speed}" }],
	}), /nodes\[0\]: min must be less than max/);
	assert.throws(() => compileControlSpec({
		inputs: { ...inputs },
		nodes: [{ type: "slider", input: "speed", min: 0, max: Number.POSITIVE_INFINITY, template: "M220 S{input.speed}" }],
	}), /nodes\[0\]: min must be less than max/, "non-finite bounds are not a range");
	assert.throws(() => compileControlSpec({
		inputs: { ...inputs },
		nodes: [{ type: "slider", input: "speed", min: 0, max: 200, step: 0, template: "M220 S{input.speed}" }],
	}), /nodes\[0\]\.step/);
	assert.throws(() => compileControlSpec({
		inputs: { ...inputs },
		nodes: [{ type: "slider", input: "speed", min: 0, max: 200, template: "M220 S{input.}" }],
	}), /nodes\[0\]\.template: invalid template/);
});

// ---- select + toggle (GIT_194 increment 2): compile boundary ----

test("a select input compiles, with numeric or author-enumerated string values", () => {
	const spec = compileControlSpec({
		inputs: {
			mode: { kind: "select", label: "Mode", default: 0, options: [
				{ label: "Off", value: 0 }, { label: "Half", value: 0.5 }, { label: "Full", value: 1 },
			] },
			macro: { kind: "select", label: "Macro", default: "purge", options: [
				{ label: "Purge", value: "purge" }, { label: "Wipe", value: "wipe" },
			] },
		},
		nodes: [
			// A select whose options are ALL numeric is number-valued and binds
			// anywhere chips could — including a slider.
			{ type: "slider", input: "mode", min: 0, max: 1, step: 0.5, template: "M106 S{input.mode}" },
			{ type: "gcode-button", label: "Run", template: 'M98 P"/macros/{input.macro}"' },
		],
	});
	assert.equal(spec.nodes.length, 2);
});

test("select rejects empty options, off-list defaults, and control characters — path-named", () => {
	assert.throws(() => compileControlSpec({
		inputs: { m: { kind: "select", label: "m", default: 0, options: [] } },
		nodes: [],
	}), /inputs\.m\.options: a select needs at least one option/);
	assert.throws(() => compileControlSpec({
		inputs: { m: { kind: "select", label: "m", default: 2, options: [{ label: "One", value: 1 }] } },
		nodes: [],
	}), /inputs\.m\.default: must be one of the option values/);
	// The line-count invariant's new mechanism: an author-enumerated string
	// is refused at the SOLE compile boundary if it carries a control
	// character — a staged value still cannot add a line to any template.
	assert.throws(() => compileControlSpec({
		inputs: { m: { kind: "select", label: "m", default: "a", options: [{ label: "A", value: "a" }, { label: "Evil", value: "x\nM112" }] } },
		nodes: [],
	}), /inputs\.m\.options\[1\]\.value: control characters/);
	assert.throws(() => compileControlSpec({
		inputs: { m: { kind: "select", label: "m", default: 1, options: [{ label: "Bad", value: Number.POSITIVE_INFINITY }, { label: "One", value: 1 }] } },
		nodes: [],
	}), /inputs\.m\.options\[0\]\.value/, "a non-finite numeric option is not a value");
});

test("a double quote in a string option value is refused at the compile boundary", () => {
	// RRF starts a new command at any G/M letter OUTSIDE a quoted string
	// (reference/duet-gcode.md, quoting rules), so in a quoted context like
	// M98 P"/macros/{input.macro}" a value carrying `"` closes the string and
	// smuggles a second command behind the one the stamp and the import
	// review's per-option inventory show. Refused like the control characters
	// — never escaped: auto-encoding would silently rewrite the author's
	// command, which the 1:1 rule forbids. Labels stay free ("" is fine in
	// display text).
	assert.throws(() => compileControlSpec({
		inputs: { m: { kind: "select", label: "m", default: "wipe", options: [
			{ label: "Wipe", value: "wipe" },
			{ label: "Evil", value: 'wipe" M112' },
		] } },
		nodes: [],
	}), /inputs\.m\.options\[1\]\.value: a double quote/);
	// A quote in the LABEL is display text, not a stageable value — it compiles.
	const spec = compileControlSpec({
		inputs: { m: { kind: "select", label: "m", default: 1, options: [{ label: '"fast"', value: 1 }] } },
		nodes: [],
	});
	assert.ok(spec);
});

test("legal string option values splice into templates RAW — verbatim, unquoted, unescaped", () => {
	// The mechanism is enumeration + review, NOT encoding: resolveTemplate
	// splices the staged string exactly as the author enumerated it (slashes,
	// dots, spaces and all), because rewriting it would emit a command the
	// author never wrote. This pins the splice so a future "helpful" escape
	// layer shows up as a failure here.
	const spec = compileControlSpec({
		inputs: { macro: { kind: "select", label: "Macro", default: "purge/all v2.g", options: [
			{ label: "Purge", value: "purge/all v2.g" },
			{ label: "Wipe", value: "wipe.g" },
		] } },
		nodes: [{ type: "row", items: [{ type: "gcode-button", label: "Run", template: 'M98 P"/macros/{input.macro}"' }] }],
	});
	const row = spec.nodes[0]!;
	assert.ok(row.type === "row");
	const button = row.items[0]!;
	assert.ok(!isInputRef(button) && button.type === "gcode-button");
	const resolved = resolveTemplate(button.template, {
		input: () => "purge/all v2.g",
		om: {},
		vars: {},
	});
	assert.equal(resolved, 'M98 P"/macros/purge/all v2.g"', "the enumerated value lands verbatim inside the author's own quotes");
});

test("string-valued selects cannot bind where the value space must be numeric", () => {
	const inputs = {
		macro: { kind: "select" as const, label: "Macro", default: "a", options: [{ label: "A", value: "a" }] },
		feed: { kind: "number" as const, label: "Feed", default: 3000 },
	};
	assert.throws(() => compileControlSpec({
		inputs: { ...inputs },
		nodes: [{ type: "slider", input: "macro", min: 0, max: 1, template: "M106 S{input.macro}" }],
	}), /nodes\[0\]\.input: input "macro" can stage a string/, "an HTML range cannot hold a string");
	assert.throws(() => compileControlSpec({
		inputs: { ...inputs },
		nodes: [{ type: "jog-pad", step: "macro", feed: "feed" }],
	}), /nodes\[0\]\.step: input "macro" can stage a string/, "cmd.jog takes numbers");
	assert.throws(() => compileControlSpec({
		inputs: { ...inputs },
		nodes: [{ type: "axis-jog", axisVar: "a", step: "feed", feed: "macro" }],
	}), /nodes\[0\]\.feed: input "macro" can stage a string/);
});

test("toggle compiles both templates and its selector through the sole boundary", () => {
	const spec = compileControlSpec({
		inputs: {},
		nodes: [{ type: "toggle", om: "fans[0].requestedValue", label: "Part fan", whenOn: "M106 P0 S0", whenOff: "M106 P0 S1" }],
	});
	const toggle = spec.nodes[0]!;
	assert.equal(toggle.type, "toggle");
	if (toggle.type === "toggle") {
		assert.equal(toggle.om.text, "fans[0].requestedValue", "selector compiled, not carried raw");
		assert.equal(toggle.whenOn.text, "M106 P0 S0");
		assert.equal(toggle.whenOff.text, "M106 P0 S1");
	}
});

test("toggle rejects bad selectors and bad templates, path-named", () => {
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "toggle", om: "a[b()]", whenOn: "M106 S0", whenOff: "M106 S1" }],
	}), /nodes\[0\]\.om: invalid selector/);
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "toggle", om: "fans[0].requestedValue", whenOn: "M106 S{input.}", whenOff: "M106 S1" }],
	}), /nodes\[0\]\.whenOn: invalid template/);
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "toggle", om: "fans[0].requestedValue", whenOn: "M106 S0", whenOff: "M106 {nope}" }],
	}), /nodes\[0\]\.whenOff: invalid template/);
	assert.throws(() => compileControlSpec({
		inputs: {},
		nodes: [{ type: "toggle", om: "fans[0].requestedValue", label: "{bad", whenOn: "M106 S0", whenOff: "M106 S1" }],
	}), /nodes\[0\]\.label: invalid template/);
});

// ---- toggle state: one total pipeline from an OM read to on/off/unknown ----

test("toggleStateOf is total: absence and non-leaf are unknown; leaf truthiness decides", async () => {
	const { toggleStateOf } = await import("../src/compose/controls/toggle.ts");
	assert.equal(toggleStateOf(undefined), "unknown", "state not yet polled");
	assert.equal(toggleStateOf(null), "unknown");
	assert.equal(toggleStateOf({ value: 1 }), "unknown", "a toggle binds a leaf, not a subtree");
	assert.equal(toggleStateOf([1]), "unknown");
	assert.equal(toggleStateOf(0), "off");
	assert.equal(toggleStateOf(0.8), "on", "any nonzero fan fraction is on");
	assert.equal(toggleStateOf(false), "off");
	assert.equal(toggleStateOf(true), "on");
	assert.equal(toggleStateOf(""), "off");
	assert.equal(toggleStateOf("busy"), "on", "strings follow truthiness — bind numeric/boolean leaves");
	// Non-finite numbers are ABSENCE, not a state — the formatReadoutValue
	// precedent: a broken numeric leaf must render indeterminate/inert, never
	// claim the board is off (or on) on garbage.
	assert.equal(toggleStateOf(Number.NaN), "unknown");
	assert.equal(toggleStateOf(Number.POSITIVE_INFINITY), "unknown");
});

// ---- readout formatting: one total pipeline, never a throw ----

test("formatReadoutValue is total: numbers format, absence is the placeholder", async () => {
	const { formatReadoutValue, READOUT_PLACEHOLDER } = await import("../src/compose/controls/readout.ts");
	assert.equal(READOUT_PLACEHOLDER, "—");
	assert.equal(formatReadoutValue(undefined, 1), "—");
	assert.equal(formatReadoutValue(null, undefined), "—");
	assert.equal(formatReadoutValue(214.267, 1), "214.3");
	assert.equal(formatReadoutValue(214.267, 0), "214");
	assert.equal(formatReadoutValue(214.267, undefined), "214.267");
	assert.equal(formatReadoutValue(Number.NaN, 2), "—", "non-finite numbers are absence, not 'NaN'");
	assert.equal(formatReadoutValue(Number.POSITIVE_INFINITY, undefined), "—");
	assert.equal(formatReadoutValue("printing", 2), "printing", "decimals apply to numbers only");
	assert.equal(formatReadoutValue(true, undefined), "true");
	assert.equal(formatReadoutValue({ current: 20 }, undefined), "—", "a readout binds a leaf, not a subtree");
	assert.equal(formatReadoutValue([1, 2], undefined), "—");
});

// ---- the weld: built-in templates equal the commands.ts authority ----
//
// The weld walks the ACTUAL compiled specs and resolves the templates they
// carry — not test-local copies of the strings. A template edited in
// builtin.ts changes what resolveTemplate produces here and fails against
// cmd.*; a button ADDED to a builtin spec without a weld entry fails the
// completeness check. (The previous version of this test compared copies,
// so builtin.ts could drift green — audit finding H7.)

/** Every gcode-button in a compiled spec, wherever it nests. */
function extractButtons(spec: CompiledControlSpec): Array<{ label: string; template: CompiledTemplate }> {
	const found: Array<{ label: string; template: CompiledTemplate }> = [];
	const walk = (node: CompiledNode): void => {
		switch (node.type) {
			case "gcode-button":
				found.push({ label: node.label.text, template: node.template });
				return;
			case "row":
				for (const item of node.items) {
					if (!isInputRef(item)) walk(item);
				}
				return;
			case "grid":
				node.items.forEach(walk);
				return;
			case "forEach":
				walk(node.node);
				return;
			case "jog-pad":
			case "axis-jog":
				return; // motion primitives emit via cmd.jog inside the renderer
			case "readout":
				return; // display-only — emits nothing
			case "slider":
				// No builtin uses a slider yet; when one does, its template joins
				// the weld table below like any button's (it is an emitter).
				found.push({ label: node.input, template: node.template });
				return;
			case "toggle":
				// An emitter with TWO alternatives — BOTH templates join the
				// inventory, so a builtin toggle would weld both to cmd.* forms.
				found.push({ label: `${node.om.text} whenOn`, template: node.whenOn });
				found.push({ label: `${node.om.text} whenOff`, template: node.whenOff });
				return;
		}
		// Totality weld (matches the renderer's): a new CompiledNode variant
		// must be enumerated here or this test file fails to compile.
		unreachable(node);
	};
	spec.nodes.forEach(walk);
	return found;
}

test("the weld: every builtin gcode-button template resolves to its cmd.* form", () => {
	const axis = { letter: "U", label: "U · Z motor 1" };
	const fixture = scope({}, {}, { axis });
	// Keyed by the button's RAW TEMPLATE text, not its label. Labels are not
	// unique any more — the homing table has two buttons reading "All", one in
	// the Home column and one in Release, disambiguated by position. Templates
	// are unique by nature, and they are what this test is actually welding.
	// Every builtin button MUST have an entry: an unwelded button is a failure.
	const expected: Record<string, string> = {
		// Homing — the per-axis buttons are labelled by VERB ("Home",
		// "Release"); the axis is named once by the row they sit in.
		"G28": cmd.homeAll(),
		"G32": cmd.bedTram(),
		"M84": cmd.releaseAllMotors(),
		"G28 {axis.letter}": cmd.homeAxis("U"),
		"M84 {axis.letter}": cmd.releaseAxis("U"),
		// Movement
		'M98 P"/macros/tool_lock"': cmd.couplerLock(),
		'M98 P"/macros/tool_unlock"': cmd.couplerUnlock(),
		// The manual-feed buttons left this spec for the Extruders card, where
		// they can show which tool they will move. They are plain JSX there and
		// call cmd.extrude directly, so there is no template left to weld.
	};
	const buttons = [...extractButtons(HOMING_SPEC), ...extractButtons(MOVEMENT_SPEC)];
	assert.equal(buttons.length, Object.keys(expected).length, "weld table and builtin buttons must stay 1:1");
	for (const button of buttons) {
		const want = expected[button.template.text];
		assert.notEqual(want, undefined, `unwelded builtin button "${button.label}" (${button.template.text}) — add its cmd.* weld`);
		assert.equal(resolveTemplate(button.template, fixture), want, `template drift on "${button.label}"`);
	}
});
