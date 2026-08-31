/**
 * Screen-global spacing tokens (GIT_194 increment 5): the per-screen
 * between-cards gutter and default in-card padding are machine-scoped
 * overlay data (they ride `screens` like layouts do), sanitized through ONE
 * gate, and emitted only as n × var(--u) custom properties.
 *
 * See docs/superpowers/specs/2026-08-30-screen-spacing-tokens-design.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRoot, createSignal } from "solid-js";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore, type MachineStore } from "../src/config/machineStore.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";
import { splitOverlay, joinOverlay } from "../src/config/types.ts";
import { parseOverlay } from "../src/config/parse.ts";
import {
	DEFAULT_GUTTER_U, DEFAULT_PAD_U, GUTTER_MAX_U, PAD_MAX_U,
	sanitizeScreenSpacing, spacingVars, type ScreenSpacingVars,
} from "../src/config/screenSpacing.ts";

// ---------------------------------------------------------------------------
// The ScreenSpacingVars brand (inc 3 review): compile-time counterexamples.
// PanelCanvas's `vars` prop accepts only the branded type whose SOLE producer
// is spacingVars(). Each @ts-expect-error below is a pin, not a suppression:
// if a refactor widens the prop again (drops the brand, or the
// `--sp-card-${string}` key template), the error it expects disappears and
// `tsc -b` fails on the then-unsatisfied directive. Never executed — the
// function exists for the compiler, which checks test/ at the same bar as
// src (tsconfig.test.json).
// ---------------------------------------------------------------------------

export function screenSpacingVarsCompilePins(
	consume: (vars: ScreenSpacingVars) => void,
	widened: Record<string, string>,
): void {
	// The first hole the brand closed: {"--u": "0px"} would re-ground the
	// drawn grid's var(--u) while the drag math reads the root's, splitting
	// cursor from card.
	// @ts-expect-error — "--u" is not a `--sp-card-*` key and the literal has no brand
	consume({ "--u": "0px" });
	// The second: a Record<string, string> launders ANY key past the
	// template-literal check.
	// @ts-expect-error — a widened record carries no brand
	consume(widened);
	// Even the right key is not enough: obtaining the type IS having gone
	// through the producer.
	// @ts-expect-error — an unbranded literal with a legal key still refuses
	consume({ "--sp-card-gutter": "calc(1 * var(--u))" });
	// And the producer's own result IS accepted — proof the three refusals
	// above are the brand at work, not an unsatisfiable parameter.
	consume(spacingVars({ gutterU: 2 }));
}

// ---------------------------------------------------------------------------
// D1: spacing is a MACHINE fact riding `screens`, exactly like layouts.
// FALSIFYING TEST (brief requirement): before the types.ts change, `spacing`
// falls into the person-side `...rest` and would follow the operator across
// machines — this test finds that and fails.
// ---------------------------------------------------------------------------

test("splitOverlay routes screens.spacing to the machine half, beside layouts", () => {
	const { machine, person } = splitOverlay({
		screens: {
			layouts: { machine: { c1: { col: 0, row: 0, colSpan: 10, rowSpan: 10 } } },
			spacing: { machine: { gutterU: 0 }, "u-abc": { padU: 2 } },
			renames: { machine: "Mach" },
			hidden: ["jobs"],
		},
	} as never);
	assert.deepEqual(machine.screens, {
		layouts: { machine: { c1: { col: 0, row: 0, colSpan: 10, rowSpan: 10 } } },
		spacing: { machine: { gutterU: 0 }, "u-abc": { padU: 2 } },
	});
	assert.deepEqual(person.screens, { renames: { machine: "Mach" }, hidden: ["jobs"] });
	assert.equal((person.screens as Record<string, unknown>).spacing, undefined, "spacing must not follow the person");
});

test("splitOverlay: spacing alone still produces a machine screens half (and no person one)", () => {
	const { machine, person } = splitOverlay({ screens: { spacing: { ctrl: { gutterU: 2 } } } } as never);
	assert.deepEqual(machine.screens, { spacing: { ctrl: { gutterU: 2 } } });
	assert.equal(person.screens, undefined, "an empty person screens half is omitted, not written as {}");
});

test("split then join is the identity for an overlay carrying spacing", () => {
	const overlay = {
		screens: {
			layouts: { machine: { c1: { col: 0, row: 2, colSpan: 5, rowSpan: 5 } } },
			spacing: { machine: { gutterU: 3, padU: 1.5 } },
			hidden: ["macros"],
		},
		thermalColors: { hot: "#f00" },
	} as never;
	const { machine, person } = splitOverlay(overlay);
	assert.deepEqual(joinOverlay(machine, person), overlay);
});

// ---------------------------------------------------------------------------
// D5: one sanitation gate. clampRect precedent: corrupt input becomes a safe
// value or is dropped; nothing throws.
// ---------------------------------------------------------------------------

test("sanitizeScreenSpacing: in-range, on-step values pass through", () => {
	assert.deepEqual(sanitizeScreenSpacing({ gutterU: 0, padU: 0 }), { gutterU: 0, padU: 0 });
	assert.deepEqual(sanitizeScreenSpacing({ gutterU: 3 }), { gutterU: 3 });
	assert.deepEqual(sanitizeScreenSpacing({ padU: 2.5 }), { padU: 2.5 });
	assert.deepEqual(sanitizeScreenSpacing({ gutterU: GUTTER_MAX_U, padU: PAD_MAX_U }), { gutterU: GUTTER_MAX_U, padU: PAD_MAX_U });
});

test("sanitizeScreenSpacing: finite numbers clamp into range and quantize to the legal step", () => {
	assert.deepEqual(sanitizeScreenSpacing({ gutterU: 9 }), { gutterU: GUTTER_MAX_U });
	assert.deepEqual(sanitizeScreenSpacing({ gutterU: -1 }), { gutterU: 0 });
	assert.deepEqual(sanitizeScreenSpacing({ gutterU: 2.6 }), { gutterU: 3 }, "gutter quantizes to whole cells (app.css GIT_170 ruling)");
	assert.deepEqual(sanitizeScreenSpacing({ padU: 3.7 }), { padU: 3.5 }, "padding quantizes to half-steps");
	assert.deepEqual(sanitizeScreenSpacing({ padU: 99 }), { padU: PAD_MAX_U });
	assert.deepEqual(sanitizeScreenSpacing({ padU: -0.2 }), { padU: 0 });
});

test("sanitizeScreenSpacing: garbage members drop; garbage wholes are undefined; nothing throws", () => {
	assert.equal(sanitizeScreenSpacing(null), undefined);
	assert.equal(sanitizeScreenSpacing("tight"), undefined);
	assert.equal(sanitizeScreenSpacing([2]), undefined);
	assert.equal(sanitizeScreenSpacing({}), undefined);
	assert.equal(sanitizeScreenSpacing({ gutterU: "big" }), undefined);
	assert.equal(sanitizeScreenSpacing({ gutterU: NaN }), undefined);
	assert.equal(sanitizeScreenSpacing({ padU: Infinity }), undefined);
	assert.deepEqual(sanitizeScreenSpacing({ gutterU: 1, padU: "x" }), { gutterU: 1 }, "a bad member costs that member, not the record");
});

// ---------------------------------------------------------------------------
// Untrusted boundary: parseOverlay carries a valid spacing leaf and drops a
// mis-typed one, per the parse-don't-validate philosophy.
// ---------------------------------------------------------------------------

test("parseOverlay: a valid screens.spacing survives the boundary", () => {
	const out = parseOverlay({ screens: { spacing: { machine: { gutterU: 0, padU: 3 }, "u-x": { gutterU: 2 } } } });
	assert.deepEqual(out.screens?.spacing, { machine: { gutterU: 0, padU: 3 }, "u-x": { gutterU: 2 } });
});

test("parseOverlay: mis-typed spacing drops per-leaf, never fatally", () => {
	assert.equal(parseOverlay({ screens: { spacing: "x" } }).screens, undefined);
	const out = parseOverlay({ screens: { spacing: { a: { gutterU: "big" }, b: { padU: 1.5 }, c: 7 } } });
	assert.deepEqual(out.screens?.spacing, { b: { padU: 1.5 } });
	// Off-grid hand-edited numbers become safe values (clampRect precedent).
	const clamped = parseOverlay({ screens: { spacing: { a: { gutterU: 2.4, padU: -3 } } } });
	assert.deepEqual(clamped.screens?.spacing, { a: { gutterU: 2, padU: 0 } });
});

// ---------------------------------------------------------------------------
// D4: the one producer of emitted CSS. Only calc(n * var(--u)) ever leaves it
// (the px lint would catch a literal; this pins the shape).
// ---------------------------------------------------------------------------

test("spacingVars: no override, no vars", () => {
	assert.deepEqual(spacingVars(undefined), {});
	assert.deepEqual(spacingVars({}), {});
});

test("spacingVars: gutter 0 is a REAL zero, not absence", () => {
	assert.deepEqual(spacingVars({ gutterU: 0 }), { "--sp-card-gutter": "calc(0 * var(--u))" });
});

test("spacingVars: padding emits x and half-b, leaves t alone", () => {
	assert.deepEqual(spacingVars({ padU: 3 }), {
		"--sp-card-x": "calc(3 * var(--u))",
		"--sp-card-b": "calc(1.5 * var(--u))",
	});
	const both = spacingVars({ gutterU: 2, padU: 5 });
	assert.deepEqual(both, {
		"--sp-card-gutter": "calc(2 * var(--u))",
		"--sp-card-x": "calc(5 * var(--u))",
		"--sp-card-b": "calc(2.5 * var(--u))",
	});
	assert.ok(!("--sp-card-t" in both), "top padding is structural (sticky head parks there) and never overridden");
});

// ---------------------------------------------------------------------------
// The mirror pin: DEFAULT_GUTTER_U / DEFAULT_PAD_U are TS copies of the
// index.css tokens (the drawer displays them; the browser reads the CSS). A
// stylesheet edit that moves either token without the constant fails here —
// the same source-text guard style test/panel-canvas.test.ts uses.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// D6: the store writer. Writes go through the gate; null clears one key;
// clearing both drops the screen's entry (reset = drop the override); a
// deleted custom screen leaves no orphan; and — the hazard this section's
// machine scoping exists for — spacing set on machine A never shows on B.
// ---------------------------------------------------------------------------

test("setScreenSpacing writes through the gate and reads back from the effective config", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms] = createSignal<MachineStore | null>(A);
			const store = createConfigStore({ machineStore: ms });
			store.setScreenSpacing("machine", "gutterU", 0);
			assert.deepEqual(store.config.screens.spacing.machine, { gutterU: 0 }, "a real zero is stored, not dropped");
			store.setScreenSpacing("machine", "padU", 3.7);
			assert.deepEqual(store.config.screens.spacing.machine, { gutterU: 0, padU: 3.5 }, "off-step input lands quantized");
			dispose();
		});
	});
});

test("null clears one key; clearing both drops the screen's entry entirely", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms] = createSignal<MachineStore | null>(A);
			const store = createConfigStore({ machineStore: ms });
			store.setScreenSpacing("jobs", "gutterU", 2);
			store.setScreenSpacing("jobs", "padU", 1);
			store.setScreenSpacing("jobs", "gutterU", null);
			assert.deepEqual(store.config.screens.spacing.jobs, { padU: 1 });
			store.setScreenSpacing("jobs", "padU", null);
			assert.equal(store.config.screens.spacing.jobs, undefined, "reset = drop the override, no husk left");
			dispose();
		});
	});
});

test("removeScreen drops the removed screen's spacing with it", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms] = createSignal<MachineStore | null>(A);
			const store = createConfigStore({ machineStore: ms });
			const id = store.addScreen("Scratch");
			store.setScreenSpacing(id, "padU", 2);
			assert.deepEqual(store.config.screens.spacing[id], { padU: 2 });
			store.removeScreen(id);
			assert.equal(store.config.screens.spacing[id], undefined, "a deleted screen leaves no orphan spacing");
			dispose();
		});
	});
});

test("spacing set on machine A is not visible on machine B", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			setMs(A);
			store.setScreenSpacing("machine", "gutterU", 0);
			assert.deepEqual(store.config.screens.spacing.machine, { gutterU: 0 });
			setMs(B);
			assert.equal(store.config.screens.spacing.machine, undefined, "B must not inherit A's screen spacing");
			dispose();
		});
	});
});

test("the shipped-default constants match the index.css tokens", () => {
	const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
	assert.match(
		css,
		new RegExp(`--sp-card-gutter:\\s*calc\\(${DEFAULT_GUTTER_U} \\* var\\(--u\\)\\)`),
		`index.css --sp-card-gutter must be calc(${DEFAULT_GUTTER_U} * var(--u)) or DEFAULT_GUTTER_U must move with it`,
	);
	assert.match(
		css,
		new RegExp(`--sp-card-x:\\s*calc\\(${DEFAULT_PAD_U} \\* var\\(--u\\)\\)`),
		`index.css --sp-card-x must be calc(${DEFAULT_PAD_U} * var(--u)) or DEFAULT_PAD_U must move with it`,
	);
});
