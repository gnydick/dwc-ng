import { test } from "node:test";
import assert from "node:assert/strict";
import { planScreenImport, screenList } from "../src/compose/screens.ts";
import { DEFAULT_CONFIG, type UiConfig } from "../src/config/types.ts";

/** DEFAULT_CONFIG with the screens overlay replaced. */
const withScreens = (screens: Partial<UiConfig["screens"]>): UiConfig => ({
	...DEFAULT_CONFIG,
	screens: { ...DEFAULT_CONFIG.screens, ...screens },
});

test("importing a screen named after a BUILT-IN overwrites that built-in", () => {
	// The reported bug: "I uploaded a new control screen and it didn't replace
	// it." Control is a built-in, and the old rule skipped built-ins outright,
	// so every import minted a second screen also called "Control".
	const plan = planScreenImport(DEFAULT_CONFIG, "Control");
	assert.notEqual(plan.target, null);
	assert.equal(plan.target?.id, "control");
	assert.equal(plan.target?.builtin, true);
});

test("EVERY built-in is an import target — the fix is not Control-specific", () => {
	const expected = [
		["Machine", "machine"],
		["Control", "control"],
		["Jobs", "jobs"],
		["Macros", "macros"],
		["System", "system"],
		["Settings", "settings"],
		["Activity", "activity"],
		["Bed maintenance", "bed"],
	] as const;
	for (const [name, id] of expected) {
		const plan = planScreenImport(DEFAULT_CONFIG, name);
		assert.equal(plan.target?.id, id, `importing "${name}" should overwrite ${id}`);
		assert.equal(plan.target?.builtin, true);
	}
});

test("overwriting a built-in keeps its id, so everything keyed on it survives", () => {
	const before = screenList(DEFAULT_CONFIG).find(s => s.def.name === "Control");
	const plan = planScreenImport(DEFAULT_CONFIG, "Control");
	assert.equal(plan.target?.id, before?.id);
});

test("a built-in wins over a same-named user screen, and the duplicate is purged", () => {
	// The state the old bug left behind: a stray user "Control" beside the
	// real one. Importing again should land on the built-in and clear the
	// stray rather than ping-ponging between two entries.
	const config = withScreens({ custom: { "u-dupe": { name: "Control", cards: {} } } });
	const plan = planScreenImport(config, "Control");
	assert.equal(plan.target?.id, "control");
	assert.deepEqual(plan.purge, ["u-dupe"]);
});

test("a renamed built-in is matched by its DISPLAYED name, not its original", () => {
	const config = withScreens({ renames: { control: "Manual" } });
	assert.equal(planScreenImport(config, "Manual").target?.id, "control");
	// The original name no longer refers to anything, so it mints a new screen.
	assert.equal(planScreenImport(config, "Control").target, null);
});

test("a user screen is still replaced in place when no built-in shares the name", () => {
	const config = withScreens({ custom: { "u-mine": { name: "Bench", cards: {} } } });
	const plan = planScreenImport(config, "Bench");
	assert.equal(plan.target?.id, "u-mine");
	assert.equal(plan.target?.builtin, false);
	assert.deepEqual(plan.purge, []);
});

test("several same-named user screens collapse to one — first kept, rest purged", () => {
	const config = withScreens({
		custom: {
			"u-a": { name: "Bench", cards: {} },
			"u-b": { name: "Bench", cards: {} },
			"u-c": { name: "Bench", cards: {} },
		},
	});
	const plan = planScreenImport(config, "Bench");
	assert.equal(plan.target?.id, "u-a");
	assert.deepEqual(plan.purge.sort(), ["u-b", "u-c"]);
});

test("an unmatched name mints a new screen and purges nothing", () => {
	const plan = planScreenImport(DEFAULT_CONFIG, "Totally New");
	assert.equal(plan.target, null);
	assert.deepEqual(plan.purge, []);
});

test("a hidden built-in is not an import target — it is not in the list", () => {
	// screenList omits hidden built-ins, so importing that name should create
	// a visible screen rather than writing into something the operator hid.
	const config = withScreens({ hidden: ["control"] });
	const plan = planScreenImport(config, "Control");
	assert.equal(plan.target, null);
});

test("importing never targets a screen whose name differs by case or padding", () => {
	// Names are matched exactly; near-misses must not silently overwrite.
	assert.equal(planScreenImport(DEFAULT_CONFIG, "control").target, null);
	assert.equal(planScreenImport(DEFAULT_CONFIG, "Control ").target, null);
});
