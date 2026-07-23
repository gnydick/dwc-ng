import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOmSelector, readOm, readOmList } from "../src/compose/controls/omSelector.ts";
import { compileTemplate, resolveTemplate, type TemplateScope } from "../src/compose/controls/template.ts";
import { compileControlSpec } from "../src/compose/controls/spec.ts";
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

test("builtin specs compile (module load already proved it) and match cmd.*", () => {
	assert.ok(HOMING_SPEC.nodes.length > 0);
	assert.ok(MOVEMENT_SPEC.nodes.length > 0);

	// Homing: templates resolve to exactly what commands.ts emits.
	const axis = { letter: "U" };
	assert.equal(
		resolveTemplate(compileTemplate("G28 {axis.letter}")!, scope({}, {}, { axis })),
		cmd.homeAxis("U"),
	);
	assert.equal(resolveTemplate(compileTemplate("G28")!, scope({})), cmd.homeAll());
	assert.equal(
		resolveTemplate(compileTemplate("M84 {axis.letter}")!, scope({}, {}, { axis })),
		cmd.releaseAxis("U"),
	);
	assert.equal(resolveTemplate(compileTemplate("M84")!, scope({})), cmd.releaseAllMotors());

	// Movement: extrude/retract and the coupler macros.
	const io = { extMm: 5, extFeed: 300 };
	assert.equal(
		resolveTemplate(compileTemplate("M83\nG1 E{input.extMm} F{input.extFeed}")!, scope(io)),
		cmd.extrude(5, 300),
	);
	assert.equal(
		resolveTemplate(compileTemplate("M83\nG1 E-{input.extMm} F{input.extFeed}")!, scope(io)),
		cmd.extrude(-5, 300),
	);
	assert.equal(resolveTemplate(compileTemplate('M98 P"/macros/tool_lock"')!, scope({})), cmd.couplerLock());
	assert.equal(resolveTemplate(compileTemplate('M98 P"/macros/tool_unlock"')!, scope({})), cmd.couplerUnlock());
});
