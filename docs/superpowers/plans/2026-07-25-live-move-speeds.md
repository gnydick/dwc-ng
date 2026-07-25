# Live Move Speeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render RRF's live `move.currentMove` — requested speed, achieved speed, and extrusion rate (toggling to volumetric flow) — as a fixed three-slot footer on the Position card.

**Architecture:** The data already arrives in the store via the connector's 500 ms `d99fn` live poll; nothing subscribes to it. One new derivation module (`om/speeds.ts`) turns the object model into a fixed 3-tuple of pre-formatted cells and is the only place raw speed values become display text. The Position card renders that tuple. A small localStorage module holds the mm/s ⇄ mm³/s toggle.

**Tech Stack:** SolidJS + TypeScript, `node:test` + `node:assert/strict`, hand-rolled CSS.

**Spec:** `docs/superpowers/specs/2026-07-25-live-move-speeds-design.md`

## Global Constraints

- **Never copy vendored/reference code.** Everything under `reference/` is read-only understanding, never a source to transcribe or paraphrase line-by-line. Cite by file/line in comments; write the implementation from scratch. This is a hard project rule (CLAUDE.md).
- **Solid rules, reviewed for:** never destructure props (use `props.x` or `splitProps`); use `<Show>`/`<For>`/`<Switch>`, never early returns or `.map` in JSX; signals/stores read inside tracking scopes only.
- **Positional stability is the primary UI concern.** Live-updating readouts must not jitter or reflow. `font-variant-numeric: tabular-nums` plus fixed-width slots, verified live and at mobile width.
- **CRLF:** this repo has mixed CRLF/LF line endings. Use the Edit/Write tools. Do NOT rewrite files with Python text-mode writes — it normalises endings and produces huge noise diffs.
- **Typecheck command:** `npx tsc -b --force`. Plain `npx tsc --noEmit` checks ZERO files here (solution-style root tsconfig) and will falsely report success.
- **Test command (all):** `cd packages/ui && pnpm test`
- **Test command (one file):** `cd packages/ui && node --conditions=browser --test test/speeds.test.ts`
- **Tests import source with the `.ts` extension** (`from "../src/om/speeds.ts"`), matching every existing test in `packages/ui/test/`.
- **Units:** mm/s and mm³/s only. Imperial is explicitly out of scope.
- **Label wording:** cell 1 is `Requested`, cell 2 is `Actual` (a deliberate, recorded divergence from DWC's "Top Speed"), cell 3 is `Extrusion` or `Flow`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/src/om/speeds.ts` *(new)* | The sole OM → display-text derivation. Owns `numberOrNull` (the I-A gate), the 3-tuple shape (I-B), and volumetric derivation (I-C). |
| `packages/ui/src/shell/speedFlowMode.ts` *(new)* | localStorage-backed `linear` ⇄ `volumetric` toggle signal. |
| `packages/ui/src/om/types.ts` | `CurrentMove` interface, `emptyModel()` defaults, `move` conform arm. |
| `packages/ui/src/cards/PositionCard.tsx` | Renders the footer row in both orientations. |
| `packages/ui/src/app.css` | `.speed-foot` styles, in the existing DRO block. |
| `packages/ui/src/compose/defs.ts` | Position card `tip` and measured `size.rowSpan`. |
| `packages/ui/src/dev/cardScenarios.ts` | Card-lab fixtures so both numeric and em-dash paths are reachable without a machine. |
| `packages/ui/test/speeds.test.ts` *(new)* | Derivation + I-A/I-B/I-D behaviour. |
| `packages/ui/test/om-conform.test.ts` | Extended for the conformed `currentMove` shape. |
| `docs/dwc-parity.md` | §4 row for the new capability. |

---

### Task 1: The speeds derivation module

The heart of the feature. Built first and standalone so every later task consumes a settled interface.

**Files:**
- Create: `packages/ui/src/om/speeds.ts`
- Test: `packages/ui/test/speeds.test.ts`

**Interfaces:**
- Consumes: `ObjectModel` from `../src/om/types.ts` (existing export).
- Produces: `numberOrNull(value: unknown): number | null`, `FlowMode`, `SpeedCell`, `SpeedRow`, `speedRow(om: ObjectModel, mode: FlowMode): SpeedRow`. Tasks 2, 3 and 4 all depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/speeds.test.ts`:

```ts
/**
 * The sole OM → display-text derivation for move.currentMove.
 *
 * I-A: no unvalidated number reaches a rendered speed string. conform is NOT
 * the OM's single entry — store.ts:89 routes live d99fn patches straight into
 * deepMergeInto — so speedRow parses its inputs rather than trusting the
 * declared type.
 * I-B: the row is always exactly three cells, so the footer cannot reflow.
 * I-D: absent ("—") and zero ("0.0") are different renderings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberOrNull, speedRow } from "../src/om/speeds.ts";
import { emptyModel, type ObjectModel } from "../src/om/types.ts";

/** A model with one tool selected, feeding extruder 0 at 1.75 mm. */
function modelWith(currentMove: unknown): ObjectModel {
	const m = emptyModel();
	m.move.extruders = [{ filamentDiameter: 1.75, filament: "PLA" }];
	m.tools = [{ number: 0, name: "T0", heaters: [1], filamentExtruder: 0, active: [210], standby: [0], state: "active" }];
	m.state.currentTool = 0;
	(m.move as Record<string, unknown>).currentMove = currentMove;
	return m;
}

test("numberOrNull parses, it does not trust", () => {
	assert.equal(numberOrNull(12.5), 12.5);
	assert.equal(numberOrNull(0), 0);
	assert.equal(numberOrNull("fast"), null);
	assert.equal(numberOrNull(null), null);
	assert.equal(numberOrNull(undefined), null);
	assert.equal(numberOrNull(NaN), null);
	assert.equal(numberOrNull(Infinity), null);
	assert.equal(numberOrNull({}), null);
});

test("the row is always exactly three cells (I-B)", () => {
	const cases: unknown[] = [
		{ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 },
		{ requestedSpeed: null, topSpeed: null, extrusionRate: null },
		"garbage",
		undefined,
		{},
	];
	for (const c of cases) {
		assert.equal(speedRow(modelWith(c), "linear").length, 3, `three cells for ${JSON.stringify(c)}`);
		assert.equal(speedRow(modelWith(c), "volumetric").length, 3);
	}
});

test("numbers render at one decimal place, with the right labels", () => {
	const row = speedRow(modelWith({ requestedSpeed: 120, topSpeed: 87.44, extrusionRate: 3.2 }), "linear");
	assert.deepEqual(row.map(c => c.key), ["requested", "actual", "flow"]);
	assert.deepEqual(row.map(c => c.label), ["Requested", "Actual", "Extrusion"]);
	assert.deepEqual(row.map(c => c.value), ["120.0", "87.4", "3.2"]);
	assert.deepEqual(row.map(c => c.unit), ["mm/s", "mm/s", "mm/s"]);
});

test("absent renders as an em-dash, zero renders as 0.0 (I-D)", () => {
	const absent = speedRow(modelWith({}), "linear");
	assert.deepEqual(absent.map(c => c.value), ["—", "—", "—"]);
	const stopped = speedRow(modelWith({ requestedSpeed: 0, topSpeed: 0, extrusionRate: 0 }), "linear");
	assert.deepEqual(stopped.map(c => c.value), ["0.0", "0.0", "0.0"]);
});

test("a string from the wire renders as an em-dash, never throws (I-A)", () => {
	const row = speedRow(modelWith({ requestedSpeed: "fast", topSpeed: 87.4, extrusionRate: 3.2 }), "linear");
	assert.equal(row[0].value, "—");
	assert.equal(row[1].value, "87.4", "the neighbouring good value still renders");
});

test("volumetric flow is derived from extrusionRate and filament area (I-C)", () => {
	const row = speedRow(modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 }), "volumetric");
	// area = pi * (1.75/2)^2 = 2.40528... mm^2; 2.40528 * 3.2 = 7.6969... mm^3/s
	assert.equal(row[2].label, "Flow");
	assert.equal(row[2].unit, "mm³/s");
	assert.equal(row[2].value, "7.7");
	assert.deepEqual(row.slice(0, 2).map(c => c.unit), ["mm/s", "mm/s"], "only cell 3 changes unit");
});

test("volumetric with no usable filament diameter shows a dash, not the linear number", () => {
	const noTool = modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 });
	noTool.state.currentTool = -1;
	assert.equal(speedRow(noTool, "volumetric")[2].value, "—");

	const noExtruder = modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 });
	noExtruder.tools[0] = { ...noExtruder.tools[0]!, filamentExtruder: -1 };
	assert.equal(speedRow(noExtruder, "volumetric")[2].value, "—");

	const zeroDiameter = modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 });
	zeroDiameter.move.extruders = [{ filamentDiameter: 0, filament: "" }];
	assert.equal(speedRow(zeroDiameter, "volumetric")[2].value, "—");
});

test("every cell names its OM source for the title attribute", () => {
	const row = speedRow(modelWith({ requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 }), "linear");
	assert.deepEqual(row.map(c => c.source), [
		"move.currentMove.requestedSpeed",
		"move.currentMove.topSpeed",
		"move.currentMove.extrusionRate",
	]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/speeds.test.ts`
Expected: FAIL — `Cannot find module '../src/om/speeds.ts'`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/om/speeds.ts`:

```ts
/**
 * move.currentMove → display cells. The ONE place raw speed values become
 * rendered text.
 *
 * Field meanings are the RRF 3.6 Object Model Documentation's, verified
 * 2026-07-25 (the vendored class at reference/objectmodel/src/move/index.ts
 * :13-20 declares the fields but documents none of them):
 *   requestedSpeed  "Requested speed of the current move (in mm/s)"
 *   topSpeed        "Top speed of the current move (in mm/s)"
 *   extrusionRate   "Current extrusion rate (in mm/s)"  — filament, not travel
 *
 * RRF exposes no instantaneous velocity. topSpeed is the achieved speed of
 * the move executing right now, re-sampled every poll, which is why it is
 * labelled "Actual" here rather than DWC's "Top Speed" — the latter reads as
 * a high-water mark that only climbs.
 *
 * I-A: this module PARSES rather than trusting the declared type. conform is
 * not the OM's single entry — store.ts:89 routes the live d99fn patch (which
 * is what updates currentMove at 2 Hz) straight into deepMergeInto, bypassing
 * conformModelKey entirely. The two ingress routes reconverge here, so here is
 * where the guarantee has to live.
 *
 * I-B: the return type is a fixed 3-tuple. "Two cells" and "four cells" have
 * no representation, so machine state cannot reflow the footer.
 */

import type { ObjectModel } from "./types.ts";

export type FlowMode = "linear" | "volumetric";

export interface SpeedCell {
	key: "requested" | "actual" | "flow";
	label: string;
	/** Already formatted — "120.0", or EM_DASH when there is no usable value. */
	value: string;
	unit: string;
	/** OM path, surfaced as the cell's title attribute. */
	source: string;
}

/** Exactly three cells, always (I-B). */
export type SpeedRow = readonly [SpeedCell, SpeedCell, SpeedCell];

/** Shown when a value is absent or unusable — never "0.0", which would assert
 *  the machine is stopped on no evidence (I-D). */
const EM_DASH = "—";

/** The I-A gate. Anything that is not a finite number becomes null. */
export function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function format(value: number | null): string {
	return value === null ? EM_DASH : value.toFixed(1);
}

/** Cross-sectional area of the loaded filament, or null when unknowable. */
function filamentArea(om: ObjectModel): number | null {
	const tool = om.tools[om.state.currentTool];
	if (!tool || tool.filamentExtruder < 0) return null;
	const extruder = om.move.extruders[tool.filamentExtruder];
	const diameter = numberOrNull(extruder?.filamentDiameter);
	if (diameter === null || diameter <= 0) return null;
	const radius = diameter / 2;
	return Math.PI * radius * radius;
}

export function speedRow(om: ObjectModel, mode: FlowMode): SpeedRow {
	// Read as unknown: the declared type is not load-bearing here (I-A).
	const raw = om.move.currentMove as unknown;
	const cm: Record<string, unknown> =
		typeof raw === "object" && raw !== null && !Array.isArray(raw)
			? raw as Record<string, unknown>
			: {};

	const extrusionRate = numberOrNull(cm.extrusionRate);
	// Volumetric is DERIVED at use time, never stored (I-C). No fallback to the
	// linear number: showing mm/s under a mm³/s unit is worse than a dash.
	const area = mode === "volumetric" ? filamentArea(om) : null;
	const flow: SpeedCell = mode === "volumetric"
		? {
			key: "flow",
			label: "Flow",
			value: area === null || extrusionRate === null ? EM_DASH : format(area * extrusionRate),
			unit: "mm³/s",
			source: "move.currentMove.extrusionRate",
		}
		: {
			key: "flow",
			label: "Extrusion",
			value: format(extrusionRate),
			unit: "mm/s",
			source: "move.currentMove.extrusionRate",
		};

	return [
		{
			key: "requested",
			label: "Requested",
			value: format(numberOrNull(cm.requestedSpeed)),
			unit: "mm/s",
			source: "move.currentMove.requestedSpeed",
		},
		{
			key: "actual",
			label: "Actual",
			value: format(numberOrNull(cm.topSpeed)),
			unit: "mm/s",
			source: "move.currentMove.topSpeed",
		},
		flow,
	];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/ui && node --conditions=browser --test test/speeds.test.ts`
Expected: PASS, 8 tests.

If the volumetric assertion fails, print the actual value before changing the expectation — `π × (1.75/2)² × 3.2 = 7.6969…` rounds to `"7.7"`. A different result means the area formula is wrong, not the expectation.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b --force`
Expected: no errors. (`npx tsc --noEmit` checks zero files here — do not substitute it.)

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/om/speeds.ts packages/ui/test/speeds.test.ts
git commit -m "feat(om): derive move-speed display cells from currentMove"
```

---

### Task 2: Harden the OM type and conform arm

Fixes the store's own shape on the refetch route. Not the render guarantee — that shipped in Task 1.

**Files:**
- Modify: `packages/ui/src/om/types.ts` (the `Move` interface ~line 49, `emptyModel()` ~line 280, the `move` conform arm ~line 338)
- Test: `packages/ui/test/om-conform.test.ts` (extend)

**Interfaces:**
- Consumes: `numberOrNull` from `./speeds.ts` (Task 1).
- Produces: `CurrentMove` interface, exported from `om/types.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/om-conform.test.ts`:

```ts
test("currentMove's numbers are parsed, not waved through", () => {
	const move = conformModelKey("move", {
		axes: [],
		extruders: [],
		currentMove: { requestedSpeed: "fast", topSpeed: 87.4, extrusionRate: null },
	});
	assert.ok(move.ok);
	if (move.ok) {
		const cm = (move.value as Record<string, unknown>).currentMove as Record<string, unknown>;
		assert.equal(cm.requestedSpeed, null, "a string becomes null, not a string reaching toFixed()");
		assert.equal(cm.topSpeed, 87.4, "good neighbours survive");
		assert.equal(cm.extrusionRate, null);
	}
});

test("a move subtree with no currentMove still conforms to the promised shape", () => {
	const move = conformModelKey("move", { axes: [], extruders: [] });
	assert.ok(move.ok);
	if (move.ok) {
		const cm = (move.value as Record<string, unknown>).currentMove as Record<string, unknown>;
		assert.deepEqual(cm, { requestedSpeed: null, topSpeed: null, extrusionRate: null });
	}
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/om-conform.test.ts`
Expected: FAIL — `requestedSpeed` is still the string `"fast"`.

- [ ] **Step 3: Change the interface**

In `packages/ui/src/om/types.ts`, replace the `currentMove` line in `Move` with a named interface declared just above `Move`:

```ts
/**
 * reference/objectmodel/src/move/index.ts:13-20 (CurrentMove).
 *
 * RRF declares all three as non-nullable numbers defaulting to 0, so a
 * connected board serving this subtree always sends numbers. `null` here means
 * the field was ABSENT — before the first sync, or on a partial patch — which
 * must not render as "0.0", since that asserts the machine is stopped on no
 * evidence. (DWC has exactly this bug: its isFinite() guard passes null
 * through as 0, because isFinite(null) === true.)
 */
export interface CurrentMove {
	/** "Requested speed of the current move (in mm/s)" — after M220. */
	requestedSpeed: number | null;
	/** "Top speed of the current move (in mm/s)" — the achieved speed. */
	topSpeed: number | null;
	/** "Current extrusion rate (in mm/s)" — filament, not nozzle travel. */
	extrusionRate: number | null;
}
```

and in `Move`:

```ts
	currentMove: CurrentMove;
```

- [ ] **Step 4: Change the default**

In `emptyModel()`, replace `currentMove: { requestedSpeed: 0, topSpeed: 0 },` with:

```ts
			currentMove: { requestedSpeed: null, topSpeed: null, extrusionRate: null },
```

- [ ] **Step 5: Change the conform arm**

Add the import at the top of `packages/ui/src/om/types.ts`:

```ts
import { numberOrNull } from "./speeds.ts";
```

In the `case "move":` arm, replace the `currentMove` line with:

```ts
				currentMove: conformCurrentMove(value.currentMove),
```

and add this module-level helper next to `arrayOr` (~line 291):

```ts
/**
 * Parse currentMove's numbers at the refetch gate so the store's shape matches
 * its declared type. NOT the render guarantee: the live d99fn patch route
 * (store.ts:89) never reaches conformModelKey, so om/speeds.ts parses again at
 * the point of display. See I-A in the design doc.
 */
const conformCurrentMove = (value: unknown): CurrentMove => {
	const v = typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		requestedSpeed: numberOrNull(v.requestedSpeed),
		topSpeed: numberOrNull(v.topSpeed),
		extrusionRate: numberOrNull(v.extrusionRate),
	};
};
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `cd packages/ui && pnpm test`
Expected: PASS. The pre-existing `"good subtrees pass through with served values intact"` test passes `currentMove: { requestedSpeed: 50, topSpeed: 60 }` but only asserts on `axes` and `speedFactor`, so it is unaffected.

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b --force`
Expected: no errors. If `dev/cardScenarios.ts:73` errors on the missing `extrusionRate`, that is expected — fix it in Task 5, or add `extrusionRate: null` now to keep the build green and revisit the values in Task 5.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/om/types.ts packages/ui/test/om-conform.test.ts
git commit -m "fix(om): parse currentMove's numbers instead of waving them through"
```

---

### Task 3: The flow-mode toggle

**Files:**
- Create: `packages/ui/src/shell/speedFlowMode.ts`
- Test: `packages/ui/test/speeds.test.ts` (extend)

**Interfaces:**
- Consumes: `FlowMode` from `../om/speeds.ts` (Task 1).
- Produces: `speedFlowMode(): FlowMode`, `toggleSpeedFlowMode(): void`, `parseSpeedFlowMode(raw: string | null): FlowMode`, `DEFAULT_SPEED_FLOW_MODE`. Task 4 consumes `speedFlowMode` and `toggleSpeedFlowMode`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/speeds.test.ts`:

```ts
import { parseSpeedFlowMode, DEFAULT_SPEED_FLOW_MODE } from "../src/shell/speedFlowMode.ts";

test("the flow-mode parse is tolerant — bad storage never throws", () => {
	assert.equal(parseSpeedFlowMode("volumetric"), "volumetric");
	assert.equal(parseSpeedFlowMode("linear"), "linear");
	assert.equal(parseSpeedFlowMode(null), DEFAULT_SPEED_FLOW_MODE);
	assert.equal(parseSpeedFlowMode(""), DEFAULT_SPEED_FLOW_MODE);
	assert.equal(parseSpeedFlowMode("{]"), DEFAULT_SPEED_FLOW_MODE);
	assert.equal(parseSpeedFlowMode("imperial"), DEFAULT_SPEED_FLOW_MODE);
	assert.equal(DEFAULT_SPEED_FLOW_MODE, "linear");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/speeds.test.ts`
Expected: FAIL — `Cannot find module '../src/shell/speedFlowMode.ts'`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/shell/speedFlowMode.ts`:

```ts
/**
 * Whether the Position card's third speed cell shows extrusion rate (mm/s of
 * filament) or volumetric flow (mm³/s). Global across every Position card
 * instance and persisted across reloads.
 *
 * localStorage, not the config overlay: that overlay uploads to the machine's
 * SD card and drives the dirty/"Save to machine" cycle (config/types.ts:149),
 * and a display-unit preference is neither machine configuration nor worth
 * marking config unsaved. Same reasoning as shell/cameraViewState.ts.
 */

import { createSignal } from "solid-js";
import type { FlowMode } from "../om/speeds.ts";

export const DEFAULT_SPEED_FLOW_MODE: FlowMode = "linear";

const STORAGE_KEY = "dwc-ng.speed-flow-mode";

/** Tolerant parse: anything unexpected yields the default, never a throw. */
export function parseSpeedFlowMode(raw: string | null): FlowMode {
	return raw === "volumetric" || raw === "linear" ? raw : DEFAULT_SPEED_FLOW_MODE;
}

function loadStored(): FlowMode {
	if (typeof localStorage === "undefined") return DEFAULT_SPEED_FLOW_MODE;
	try {
		return parseSpeedFlowMode(localStorage.getItem(STORAGE_KEY));
	} catch {
		return DEFAULT_SPEED_FLOW_MODE;
	}
}

function writeStored(mode: FlowMode): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// Private mode / quota exceeded: the choice just won't survive a reload.
	}
}

const [speedFlowMode, setSpeedFlowModeSignal] = createSignal<FlowMode>(loadStored());
export { speedFlowMode };

export function toggleSpeedFlowMode(): void {
	const next: FlowMode = speedFlowMode() === "linear" ? "volumetric" : "linear";
	setSpeedFlowModeSignal(next);
	writeStored(next);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/ui && node --conditions=browser --test test/speeds.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b --force`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/shell/speedFlowMode.ts packages/ui/test/speeds.test.ts
git commit -m "feat(shell): persist the extrusion/flow unit choice per browser"
```

---

### Task 4: The footer row on the Position card

**Files:**
- Modify: `packages/ui/src/cards/PositionCard.tsx`
- Modify: `packages/ui/src/app.css` (append to the DRO block, after `.dro-h-val`)
- Modify: `packages/ui/src/compose/defs.ts:56` (the `tip`)

**Interfaces:**
- Consumes: `speedRow`, `type SpeedRow` from `../om/speeds.ts` (Task 1); `speedFlowMode`, `toggleSpeedFlowMode` from `../shell/speedFlowMode.ts` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the imports and the memo**

In `packages/ui/src/cards/PositionCard.tsx`, extend the existing import line and add two more:

```tsx
import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { speedRow } from "../om/speeds.ts";
import { speedFlowMode, toggleSpeedFlowMode } from "../shell/speedFlowMode.ts";
import type { Orientation } from "../shell/panelOrientation.ts";
```

Inside `PositionBody`, below the existing `visibleAxes` memo:

```tsx
	const speeds = createMemo(() => speedRow(app.om.om, speedFlowMode()));
```

- [ ] **Step 2: Add the footer markup**

The footer sits at the same level in both orientations — it is machine-wide, not per-axis — so it goes after the inner `<Show>`, still inside the outer `<Show>`. Replace the closing of the outer `<Show>` so the structure reads:

```tsx
			</Show>
			<div class="speed-foot">
				<span class="speed-foot-tag">Speed</span>
				<For each={speeds()}>
					{cell => (
						<div class="speed-cell">
							<Show
								when={cell.key === "flow"}
								fallback={<span class="speed-label">{cell.label}</span>}
							>
								<button
									type="button"
									class="speed-label speed-toggle"
									onClick={toggleSpeedFlowMode}
									title="Switch between extrusion rate (mm/s of filament) and volumetric flow (mm³/s)"
								>
									{cell.label}
								</button>
							</Show>
							<span class="speed-val" title={cell.source}>
								{cell.value}<small>{cell.unit}</small>
							</span>
						</div>
					)}
				</For>
			</div>
		</Show>
```

Note: `cell` is the `<For>` callback parameter, so reading `cell.key` / `cell.label` is not prop destructuring — the Solid rule does not apply here.

- [ ] **Step 3: Add the styles**

Append to `packages/ui/src/app.css`, immediately after the `.dro-h-val` rule that closes the DRO block:

```css
/* Live move speeds (move.currentMove) — a fixed three-slot footer. The slots
   are fixed-width and tabular so a value going 99.4 -> 100.0 twice a second
   cannot shift the row, and so the cell count never changes with machine
   state (om/speeds.ts returns a 3-tuple by construction). */
.speed-foot {
	display: flex;
	align-items: baseline;
	gap: 14px;
	margin-top: 8px;
	padding-top: 8px;
	border-top: 1px solid var(--hairline);
}
.speed-foot-tag {
	font-family: var(--font-display);
	font-weight: 700;
	font-size: 10px;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--silk-dim);
	flex: none;
}
.speed-cell {
	display: flex;
	flex-direction: column;
	gap: 2px;
	/* Fixed, not auto: "Requested" and "Flow" differ in width, and the toggle
	   swaps between "Extrusion" and "Flow" on click. An auto column would move
	   the neighbouring cells every time. */
	flex: 0 0 88px;
	min-width: 0;
}
.speed-label {
	font-family: var(--font-display);
	font-weight: 600;
	font-size: 10px;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--silk-dim);
	white-space: nowrap;
}
.speed-toggle {
	/* A real button, not DWC's javascript:void(0) anchor — it is keyboard
	   reachable and announces as a control. */
	appearance: none;
	background: none;
	border: none;
	border-bottom: 1px dotted var(--copper);
	padding: 0;
	cursor: pointer;
	text-align: left;
	color: var(--copper);
}
.speed-toggle:hover { color: var(--silk); border-bottom-color: var(--silk); }
.speed-val {
	font-family: var(--font-display);
	font-weight: 600;
	font-size: 15px;
	line-height: 1;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}
.speed-val small { font-size: 10px; color: var(--silk-dim); margin-left: 3px; }
```

- [ ] **Step 4: Update the card tip**

In `packages/ui/src/compose/defs.ts`, change the `position` card's tip (line 56) from `tip: "move.axes",` to:

```ts
		tip: "move.axes · move.currentMove",
```

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc -b --force && cd packages/ui && pnpm test`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/cards/PositionCard.tsx packages/ui/src/app.css packages/ui/src/compose/defs.ts
git commit -m "feat(cards): show live requested/actual speed on the Position card"
```

---

### Task 5: Card-lab fixtures and the measured card height

The height must be measured from the rendered footer, not guessed — that is what `panelCanvas.ts:264` exists for.

**Files:**
- Modify: `packages/ui/src/dev/cardScenarios.ts:73` and the printing scenario
- Modify: `packages/ui/src/compose/defs.ts:58` (`size.rowSpan`)

**Interfaces:**
- Consumes: the `CurrentMove` shape from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Give the idle scenario an absent currentMove**

In `packages/ui/src/dev/cardScenarios.ts`, replace line 73's `currentMove: { requestedSpeed: 0, topSpeed: 0 },` with:

```ts
		// Absent, not zero: the idle scenario is what exercises the em-dash
		// path, so both renderings are reachable in the lab without a machine.
		currentMove: { requestedSpeed: null, topSpeed: null, extrusionRate: null },
```

- [ ] **Step 2: Give the printing scenario live-looking values**

In `withPrintingJob`, alongside the existing `model.state.currentTool = 0;` line, add:

```ts
	// Requested above achieved — the normal printing case, where cornering and
	// segment length keep the machine off its commanded feedrate.
	model.move.currentMove = { requestedSpeed: 120, topSpeed: 87.4, extrusionRate: 3.2 };
```

- [ ] **Step 3: Verify both renderings in the Card Lab**

Run: `pnpm dev`, open the Card Lab, and select the Position card.
- Idle scenario → all three cells read `—`.
- Printing scenario → `120.0`, `87.4`, `3.2`; clicking `Extrusion` switches to `Flow 7.7 mm³/s` and the label persists across a reload.

- [ ] **Step 4: Measure the required rowSpan**

With the Position card rendered on a composed screen in the browser, read the content-fit minimum that `fitRowSpan` (`packages/ui/src/shell/panelCanvas.ts:264`) computes for it — either via the card's existing fit-to-content affordance, or by evaluating that function against the card element in the devtools console.

Record the measured number. Do NOT guess: `ROW_UNIT_PX` is 4 (`panelCanvas.ts:33`), so the current 95 is 380 px and the footer adds roughly 9–10 units, but the measured value is the one that ships.

- [ ] **Step 5: Set the measured default**

In `packages/ui/src/compose/defs.ts`, update the `position` card's size to the measured value:

```ts
		size: { colSpan: 12, rowSpan: <measured> },
```

- [ ] **Step 6: Verify a fresh layout is not clipped**

In the browser, reset the layout on a screen carrying the Position card and confirm the footer is fully visible with no scrollbar inside the card.

Known and accepted: an already-saved layout overlay keeps its stored `95` and will clip the footer until that card is resized once by hand. No migration — `panelCanvas`'s collision rules can refuse a programmatic grow when a card sits directly below, which would clip anyway and silently.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/dev/cardScenarios.ts packages/ui/src/compose/defs.ts
git commit -m "feat(cards): size the Position card for the speed footer, add lab fixtures"
```

---

### Task 6: Live verification and parity doc

**Files:**
- Modify: `docs/dwc-parity.md` (§4, after the `Speed factor (M220)` row at line 86)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Verify against a running machine**

Per the standing project rule, "verified" requires a check that could have failed. Run a real job (or mock-duet's mid-print scenario) and confirm all three:

1. **Requested and Actual diverge** during acceleration and cornering. If they track each other exactly at all times, the values are not live and this check has FAILED — report it rather than proceeding.
2. **`M220` moves Requested.** Change the speed factor and watch the requested figure follow.
3. **No horizontal shift** as digit counts change (e.g. `99.4` → `100.0`), at desktop and at mobile width.

- [ ] **Step 2: Record the result honestly**

If any check failed, stop and report it. Do not mark the feature complete on "numbers appeared" — that is the exact failure mode the project rule exists to prevent.

- [ ] **Step 3: Update the parity doc**

In `docs/dwc-parity.md` §4, add after the `Speed factor (M220)` row:

```markdown
| **Live move speeds** (requested vs achieved) | ✅ (`StatusPanel.vue`) | ✅ | `om/speeds.ts` — footer on the Position card. `move.currentMove`; requested/achieved plus extrusion rate toggling to volumetric flow. Labelled "Actual" rather than DWC's "Top Speed": RRF has no instantaneous-velocity field, and the achieved figure is re-sampled every poll, so "Top Speed" would read as a high-water mark. |
```

- [ ] **Step 4: Commit**

```bash
git add docs/dwc-parity.md
git commit -m "docs: record live move speeds in the parity matrix"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Harden parse boundary (`types.ts`) | 2 |
| I-A render gate (`speedRow` parses) | 1 |
| `om/speeds.ts` derivation, I-B 3-tuple, I-C derived flow, I-D dash-vs-zero | 1 |
| `shell/speedFlowMode.ts` | 3 |
| Footer row + CSS, `Actual` label, cell `title` | 4 |
| `defs.ts` tip + measured `rowSpan` | 4 (tip), 5 (size) |
| `dev/cardScenarios.ts` fixtures | 5 |
| Tests (`speeds.test.ts`, `om-conform.test.ts`) | 1, 2, 3 |
| Live verification | 6 |
| Parity doc | 6 |

**Type consistency:** `numberOrNull`, `FlowMode`, `SpeedCell`, `SpeedRow`, `speedRow`, `speedFlowMode`, `toggleSpeedFlowMode`, `parseSpeedFlowMode`, `DEFAULT_SPEED_FLOW_MODE`, `CurrentMove` are each defined once and referenced under the same name throughout. Cell keys are `"requested" | "actual" | "flow"` in the type, the implementation, and the test.

**Known circular-import check:** `om/types.ts` (Task 2) imports `numberOrNull` from `om/speeds.ts`, which imports `type ObjectModel` from `om/types.ts`. The latter is a **type-only** import, erased at compile time, so no runtime cycle exists. If the bundler or `tsc` nonetheless complains, move `numberOrNull` into `om/types.ts` and have `speeds.ts` import it from there — the helper's home is an implementation detail; having exactly one implementation is not.
