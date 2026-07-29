import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOmSelector, readOm, readOmList } from "../src/compose/controls/omSelector.ts";
import { compileTemplate, resolveTemplate, type TemplateScope } from "../src/compose/controls/template.ts";
import { compileControlSpec, type CompiledControlSpec, type CompiledNode } from "../src/compose/controls/spec.ts";
import type { CompiledTemplate } from "../src/compose/controls/template.ts";
import { HOMING_SPEC, MOVEMENT_SPEC } from "../src/compose/controls/builtin.ts";
import { cmd } from "../src/control/commands.ts";

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
					if (!("input" in item && !("type" in item))) walk(item as CompiledNode);
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
		}
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
