# GCode Viewer: Color Modes, Real Alpha, Real Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Activity view's live G-code toolpath viewer with three color modes (speed, feature-type, layer-time), real per-vertex alpha transparency, and real world-space per-segment line width.

**Architecture:** The parser gains new tracked quantities (speed, feature-type, per-layer height/time). A new `hueColors.ts` computes per-segment RGB from the active color mode; the existing `renderModes.ts` is rewritten to compute per-segment alpha instead of a darker shade. Real alpha and real per-segment width both require a vendored, forked copy of Three.js's `LineMaterial`/`LineSegmentsGeometry`/`LineSegments2` (stock Three.js supports neither) — the fork adds a vec4 color attribute and a per-segment width-scale attribute to the existing fat-lines shader.

**Tech Stack:** SolidJS + TypeScript, Three.js@0.185.1 (already installed), node:test.

## Global Constraints

- Never destructure Solid props — use `props.x` or `splitProps`.
- Use `<Show>`/`<For>`/`<Switch>`, not early returns or `.map` in JSX.
- `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- `tsconfig.app.json` has no `"strict": true` — implicit-`any` parameters are allowed; the vendored/forked files in this plan intentionally keep close to their upstream JS structure rather than adding rigorous typing throughout (pragmatic "vendor and extend," matching this project's existing `reference/` convention).
- Run `node ../../node_modules/typescript/bin/tsc -b` and `pnpm test` from `packages/ui` after each task; the pre-existing baseline is 2 known typecheck errors (`writeGuard.ts:48`, `editor/setup.ts:11`) and all tests green — no new errors, no regressions.
- **Float32Array precision**: any test comparing a `Float32Array`-derived value against a literal (e.g. `0.85`, `0.1`) must round-trip the expected value through `Float32Array` too (`Array.from(new Float32Array([0.85, ...]))`), never compare against a raw float64 literal — binary floating point can't represent most decimals exactly, and comparing an already-rounded value against an unrounded one fails even when "the same number" was intended. This bit the previous gcode-viewer plan twice; apply it proactively here.
- The fork is vendored at `src/gcode/lineMaterial/`, forked from the currently-installed `three@0.185.1`'s `node_modules/three/examples/jsm/lines/{LineMaterial,LineSegmentsGeometry,LineSegments2}.js`. `Line2.js` is NOT needed — this app renders disconnected segments (`LineSegments2`), not a connected polyline (`Line2`).
- All PrusaSlicer/SuperSlicer gcode comment formats referenced in this plan (`;TYPE:`, `;LAYER_CHANGE`, `M73 P/R`) were verified directly against both slicers' current source, not assumed — see `docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md` for citations.

---

## Task 1: Add `filamentDiameter` to the object model

**Files:**
- Modify: `packages/ui/src/om/types.ts`

**Interfaces:**
- Produces: `Move.extruders: Extruder[]`, `Extruder { filamentDiameter: number }` — consumed by Task 8 (`GcodeViewer.tsx`, reads `app.om.om.move.extruders[0]?.filamentDiameter` and falls back to 1.75 if absent).

- [ ] **Step 1: Add the `Extruder` interface and extend `Move`**

Edit `packages/ui/src/om/types.ts`. Add after the `Axis` interface (before `Move`):

```ts
/** reference/objectmodel/src/move/Extruder.ts */
export interface Extruder {
	filamentDiameter: number;
}
```

Then change the `Move` interface to:

```ts
/** reference/objectmodel/src/move/index.ts (Move) */
export interface Move {
	axes: Axis[];
	currentMove: { requestedSpeed: number; topSpeed: number };
	speedFactor: number;
	extruders: Extruder[];
}
```

- [ ] **Step 2: Update `emptyModel()`**

In the same file, change the `move` line inside `emptyModel()`:

```ts
move: { axes: [], currentMove: { requestedSpeed: 0, topSpeed: 0 }, speedFactor: 1, extruders: [] },
```

- [ ] **Step 3: Typecheck and full test suite**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b && pnpm test`
Expected: same 2 known pre-existing errors, nothing new; all tests pass (confirmed no test asserts `emptyModel()`'s or `Move`'s exact shape — this is a pure additive extension, matching `om/types.ts`'s own stated design of "everything not typed here still lives in the store").

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/om/types.ts
git commit -m "feat(ui): add extruders/filamentDiameter to the object model types"
```

---

## Task 2: Feature-type label mapping (`featureTypes.ts`)

**Files:**
- Create: `packages/ui/src/gcode/featureTypes.ts`
- Test: `packages/ui/test/feature-types.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const UNKNOWN_FEATURE_TYPE: number; // = 0
  export const FEATURE_TYPE_NAMES: readonly string[];
  export const FEATURE_TYPE_COLORS: readonly (readonly [number, number, number])[];
  export function mapLabelToFeatureType(label: string): number;
  ```
  Consumed by Task 4 (`parseGcode.ts`, calls `mapLabelToFeatureType` while scanning `;TYPE:` comments) and Task 5 (`hueColors.ts`, reads `FEATURE_TYPE_COLORS[toolpath.featureType[i]]`).

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/feature-types.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mapLabelToFeatureType, UNKNOWN_FEATURE_TYPE, FEATURE_TYPE_NAMES, FEATURE_TYPE_COLORS,
} from "../src/gcode/featureTypes.ts";

test("maps every verified PrusaSlicer label to a non-Unknown index", () => {
	const prusaLabels = [
		"Perimeter", "External perimeter", "Overhang perimeter", "Internal infill",
		"Solid infill", "Top solid infill", "Bridge infill", "Gap fill", "Skirt/Brim",
		"Support material", "Support material interface", "Ironing", "Wipe tower", "Custom",
	];
	for (const label of prusaLabels) {
		assert.notEqual(mapLabelToFeatureType(label), UNKNOWN_FEATURE_TYPE, `expected ${label} to map to a known type`);
	}
});

test("maps SuperSlicer's diverged labels to the same bucket as PrusaSlicer's equivalent", () => {
	assert.equal(mapLabelToFeatureType("Internal perimeter"), mapLabelToFeatureType("Perimeter"));
	assert.equal(mapLabelToFeatureType("Skirt"), mapLabelToFeatureType("Skirt/Brim"));
});

test("unrecognized or empty labels map to Unknown", () => {
	assert.equal(mapLabelToFeatureType("Something else entirely"), UNKNOWN_FEATURE_TYPE);
	assert.equal(mapLabelToFeatureType(""), UNKNOWN_FEATURE_TYPE);
});

test("FEATURE_TYPE_COLORS has exactly one entry per FEATURE_TYPE_NAMES entry", () => {
	assert.equal(FEATURE_TYPE_COLORS.length, FEATURE_TYPE_NAMES.length);
});

test("FEATURE_TYPE_NAMES[UNKNOWN_FEATURE_TYPE] is literally \"Unknown\"", () => {
	assert.equal(FEATURE_TYPE_NAMES[UNKNOWN_FEATURE_TYPE], "Unknown");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && node --test test/feature-types.test.ts`
Expected: FAIL — `Cannot find module '../src/gcode/featureTypes.ts'`.

- [ ] **Step 3: Implement**

Create `packages/ui/src/gcode/featureTypes.ts`:

```ts
/**
 * PrusaSlicer/SuperSlicer feature-type (;TYPE:) label -> color-mode bucket
 * mapping. Verified directly against both slicers' current source (see
 * docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md):
 * exact tag format is ";TYPE:<label>" (no space), one tag governs every
 * extrusion move until the next tag. SuperSlicer diverges on two labels
 * only ("Internal perimeter" vs PrusaSlicer's "Perimeter", "Skirt" vs
 * "Skirt/Brim") — both folded into the same bucket as their PrusaSlicer
 * equivalent.
 */

export const UNKNOWN_FEATURE_TYPE = 0;

export const FEATURE_TYPE_NAMES = [
	"Unknown",
	"Perimeter",
	"External perimeter",
	"Overhang perimeter",
	"Internal infill",
	"Solid infill",
	"Top solid infill",
	"Bridge infill",
	"Gap fill",
	"Skirt",
	"Support material",
	"Support material interface",
	"Ironing",
	"Wipe tower",
	"Custom",
] as const;

/** Index-aligned with FEATURE_TYPE_NAMES. */
export const FEATURE_TYPE_COLORS: readonly (readonly [number, number, number])[] = [
	[0.5, 0.5, 0.5],    // Unknown
	[0.85, 0.55, 0.25], // Perimeter
	[0.95, 0.75, 0.35], // External perimeter
	[0.9, 0.4, 0.4],    // Overhang perimeter
	[0.3, 0.55, 0.85],  // Internal infill
	[0.35, 0.65, 0.9],  // Solid infill
	[0.5, 0.8, 0.95],   // Top solid infill
	[0.8, 0.3, 0.6],    // Bridge infill
	[0.6, 0.6, 0.3],    // Gap fill
	[0.4, 0.4, 0.4],    // Skirt
	[0.3, 0.75, 0.4],   // Support material
	[0.45, 0.85, 0.5],  // Support material interface
	[0.9, 0.85, 0.4],   // Ironing
	[0.55, 0.4, 0.7],   // Wipe tower
	[0.7, 0.7, 0.7],    // Custom
];

const LABEL_TO_INDEX: Readonly<Record<string, number>> = {
	"Perimeter": 1,
	"Internal perimeter": 1, // SuperSlicer's name for the same feature
	"External perimeter": 2,
	"Overhang perimeter": 3,
	"Internal infill": 4,
	"Solid infill": 5,
	"Top solid infill": 6,
	"Bridge infill": 7,
	"Gap fill": 8,
	"Skirt/Brim": 9,
	"Skirt": 9, // SuperSlicer's name, and PrusaSlicer's pre-2.3.2 name
	"Support material": 10,
	"Support material interface": 11,
	"Ironing": 12,
	"Wipe tower": 13,
	"Custom": 14,
};

export function mapLabelToFeatureType(label: string): number {
	return LABEL_TO_INDEX[label] ?? UNKNOWN_FEATURE_TYPE;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/feature-types.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/featureTypes.ts packages/ui/test/feature-types.test.ts
git commit -m "feat(ui): add PrusaSlicer/SuperSlicer feature-type label mapping"
```

---

## Task 3: Per-segment width from extrusion volume (`segmentWidth.ts`)

**Files:**
- Create: `packages/ui/src/gcode/segmentWidth.ts`
- Test: `packages/ui/test/segment-width.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TRAVEL_WIDTH_MM: number;
  export function computeSegmentWidths(
      positions: Float32Array,
      deltaE: Float32Array,
      extruding: Uint8Array,
      layerIndex: Uint16Array,
      layerHeights: Float32Array,
      filamentDiameter: number,
  ): Float32Array;
  ```
  Consumed by Task 8 (`GcodeViewer.tsx`), fed the corresponding fields of a `ParsedToolpath` (Task 4) plus the OM's `filamentDiameter` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/segment-width.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentWidths, TRAVEL_WIDTH_MM } from "../src/gcode/segmentWidth.ts";

test("travel segments get the fixed hairline width", () => {
	const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
	const deltaE = new Float32Array([0]);
	const extruding = new Uint8Array([0]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0.2]);
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.deepEqual(Array.from(widths), Array.from(new Float32Array([TRAVEL_WIDTH_MM])));
});

test("computes width from extrusion volume for an extruding segment", () => {
	const positions = new Float32Array([0, 0, 0, 10, 0, 0]); // 10mm segment
	const deltaE = new Float32Array([0.5]); // 0.5mm of 1.75mm filament
	const extruding = new Uint8Array([1]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0.2]); // 0.2mm layer height
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	const filamentArea = Math.PI * (1.75 / 2) ** 2;
	const expected = (filamentArea * 0.5) / (0.2 * 10);
	assert.ok(Math.abs(widths[0]! - expected) < 1e-6, `expected ~${expected}, got ${widths[0]}`);
});

test("zero-length segment falls back to the travel width instead of dividing by zero", () => {
	const positions = new Float32Array([5, 5, 0.2, 5, 5, 0.2]); // degenerate, no movement
	const deltaE = new Float32Array([0.1]);
	const extruding = new Uint8Array([1]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0.2]);
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.deepEqual(Array.from(widths), Array.from(new Float32Array([TRAVEL_WIDTH_MM])));
	assert.ok(Number.isFinite(widths[0]));
});

test("missing/zero layerHeight falls back to a default rather than Infinity", () => {
	const positions = new Float32Array([0, 0, 0, 10, 0, 0]);
	const deltaE = new Float32Array([0.5]);
	const extruding = new Uint8Array([1]);
	const layerIndex = new Uint16Array([0]);
	const layerHeights = new Float32Array([0]); // missing/zero
	const widths = computeSegmentWidths(positions, deltaE, extruding, layerIndex, layerHeights, 1.75);
	assert.ok(Number.isFinite(widths[0]));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && node --test test/segment-width.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ui/src/gcode/segmentWidth.ts`:

```ts
/**
 * Per-segment world-space line width from actual extrusion volume — the
 * same rectangular-bead approximation slicers themselves use:
 *   width = (pi * (filamentDiameter/2)^2 * deltaE) / (layerHeight * segmentLength)
 * Travel moves (no extrusion) get a fixed hairline width instead of
 * running through the formula, which would divide by zero.
 */

export const TRAVEL_WIDTH_MM = 0.1;
const DEFAULT_LAYER_HEIGHT_MM = 0.2;

export function computeSegmentWidths(
	positions: Float32Array,
	deltaE: Float32Array,
	extruding: Uint8Array,
	layerIndex: Uint16Array,
	layerHeights: Float32Array,
	filamentDiameter: number,
): Float32Array {
	const segmentCount = deltaE.length;
	const widths = new Float32Array(segmentCount);
	const filamentArea = Math.PI * (filamentDiameter / 2) ** 2;

	for (let i = 0; i < segmentCount; i++) {
		if (!extruding[i]) {
			widths[i] = TRAVEL_WIDTH_MM;
			continue;
		}
		const base = i * 6;
		const dx = positions[base + 3]! - positions[base]!;
		const dy = positions[base + 4]! - positions[base + 1]!;
		const dz = positions[base + 5]! - positions[base + 2]!;
		const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
		const layerHeight = layerHeights[layerIndex[i]!] || DEFAULT_LAYER_HEIGHT_MM;
		widths[i] = segmentLength > 0
			? (filamentArea * deltaE[i]!) / (layerHeight * segmentLength)
			: TRAVEL_WIDTH_MM;
	}
	return widths;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/segment-width.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/segmentWidth.ts packages/ui/test/segment-width.test.ts
git commit -m "feat(ui): add per-segment width computation from extrusion volume"
```

---

## Task 4: Extend the parser — speed, feature-type, layer-time, deltaE, layerHeights

**Files:**
- Modify: `packages/ui/src/gcode/parseGcode.ts`
- Modify: `packages/ui/test/parse-gcode.test.ts`

**Interfaces:**
- Consumes: `mapLabelToFeatureType` (Task 2).
- Produces: `ParsedToolpath` gains `deltaE: Float32Array`, `speed: Float32Array`, `featureType: Uint8Array`, `layerHeights: Float32Array`, `layerTimeMinutes: Float32Array` — consumed by Task 5 (`hueColors.ts`) and Task 8 (`GcodeViewer.tsx`, both directly and via its call into Task 3's `segmentWidth.ts`).

This task is purely additive to `ParsedToolpath` and the parser's existing behavior — all 9 existing tests in `parse-gcode.test.ts` must still pass unchanged; only new fields and new tests are added.

- [ ] **Step 1: Write the new failing tests**

Add these tests to the END of `packages/ui/test/parse-gcode.test.ts` (keep every existing test in the file as-is; add an import for the feature-type helper):

```ts
import { mapLabelToFeatureType, UNKNOWN_FEATURE_TYPE } from "../src/gcode/featureTypes.ts";
```

(add this import line alongside the file's existing `import { parseGcode } from "../src/gcode/parseGcode.ts";` line)

```ts
test("tracks F (speed) across lines, persisting until changed", () => {
	const gcode = "G1 F1500 X10 E1\nG1 X20 E2\nG1 F3000 X30 E3\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.speed), [1500, 1500, 3000]);
});

test("tracks ;TYPE: comments, applying to every move until the next tag", () => {
	const gcode = ";TYPE:Skirt\nG1 X10 E1\n;TYPE:Perimeter\nG1 X20 E2\nG1 X30 E3\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.featureType), [
		mapLabelToFeatureType("Skirt"),
		mapLabelToFeatureType("Perimeter"),
		mapLabelToFeatureType("Perimeter"),
	]);
});

test("defaults to Unknown feature type when no ;TYPE: tag has appeared yet", () => {
	const gcode = "G1 X10 E1\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.featureType), [UNKNOWN_FEATURE_TYPE]);
});

test("computes deltaE per segment (0 for travel, positive for extrusion)", () => {
	const gcode = "G0 X5 Y5\nG1 X10 Y10 E2\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.deltaE), [0, 2]);
});

test("computes layerHeights per layer: first layer is its own Z, later layers are the Z delta", () => {
	const gcode = [
		"G1 X0 Y0 Z0.2 E1",
		"G1 X10 Y0 Z0.4 E2",
		"G1 X10 Y0 Z0.6 E3",
	].join("\n");
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.layerHeights), Array.from(new Float32Array([0.2, 0.2, 0.2])));
});

test("derives per-layer time from M73 R values bracketing each ;LAYER_CHANGE", () => {
	const gcode = [
		"M73 P0 R10",
		";LAYER_CHANGE",
		"G1 X0 Y0 Z0.2 E1",
		"M73 P50 R6",
		";LAYER_CHANGE",
		"G1 X10 Y0 Z0.4 E2",
		"M73 P100 R0",
	].join("\n");
	const result = parseGcode(gcode);
	// layer 0: R at its LAYER_CHANGE (10) minus R at the NEXT LAYER_CHANGE (6) = 4
	// layer 1 (last layer): R at its LAYER_CHANGE (6) minus the FINAL M73 R seen (0) = 6
	assert.deepEqual(Array.from(result.layerTimeMinutes), [4, 6]);
});

test("layerTimeMinutes is all NaN when the file has no M73/LAYER_CHANGE data", () => {
	const gcode = "G1 X0 Y0 Z0.2 E1\nG1 X10 Y0 Z0.4 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.layerTimeMinutes.length, 2);
	for (const t of result.layerTimeMinutes) assert.ok(Number.isNaN(t));
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd packages/ui && node --test test/parse-gcode.test.ts`
Expected: the 9 pre-existing tests still PASS; the 7 new tests FAIL (new `ParsedToolpath` fields don't exist yet).

- [ ] **Step 3: Implement**

Replace the full contents of `packages/ui/src/gcode/parseGcode.ts`:

```ts
/**
 * G-code -> flat toolpath, for the Activity view's 3D viewer. Scope is a
 * visual preview, not a verifier: G0/G1 linear moves are parsed exactly;
 * G2/G3 arcs are approximated as a single chord to their endpoint (I/J
 * ignored) rather than tessellated. Gcode is ASCII in practice, so one JS
 * string UTF-16 code unit is treated as one byte for the offsets that map
 * to RRF's job.filePosition (also a byte count).
 *
 * Feature-type (;TYPE:) and layer-time (M73 P/R + ;LAYER_CHANGE) tracking
 * targets PrusaSlicer/SuperSlicer's verified comment conventions — see
 * docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md.
 * Layer-time is a best-effort heuristic (M73 emission isn't tied to layer
 * boundaries by either slicer) and is simply absent (NaN) when the
 * source file has no M73/LAYER_CHANGE data at all — most files won't,
 * since it's gated behind an opt-in printer setting.
 */

import { mapLabelToFeatureType } from "./featureTypes.ts";

export interface ParsedToolpath {
	positions: Float32Array;
	layerIndex: Uint16Array;
	byteOffset: Float64Array;
	extruding: Uint8Array;
	segmentCount: number;
	layerCount: number;
	/** Per segment: mm of filament extruded (0 for travel). */
	deltaE: Float32Array;
	/** Per segment: last-seen F value (mm/min) at that move. */
	speed: Float32Array;
	/** Per segment: index into featureTypes.ts's FEATURE_TYPE_NAMES/COLORS. */
	featureType: Uint8Array;
	/** Per layer: Z thickness (first layer approximated as its own Z). */
	layerHeights: Float32Array;
	/** Per layer: estimated minutes, NaN if undeterminable (see module doc). */
	layerTimeMinutes: Float32Array;
}

const CMD_RE = /^([A-Za-z])(\d+)/;
const PARAM_RE = /([XYZEF])(-?\d*\.?\d+)/gi;
const M73_R_RE = /\bR(-?\d+\.?\d*)/i;
const MOVE_COMMANDS = new Set(["G0", "G1", "G2", "G3"]);

export function parseGcode(text: string): ParsedToolpath {
	const positions: number[] = [];
	const layerIndex: number[] = [];
	const byteOffset: number[] = [];
	const extruding: number[] = [];
	const deltaE: number[] = [];
	const speed: number[] = [];
	const featureType: number[] = [];
	const layerHeights: number[] = [];
	const layerStartR: number[] = [];

	let x = 0, y = 0, z = 0, e = 0;
	let absolute = true;
	let eAbsolute = true;
	let currentLayer = 0;
	let lastExtrudeZ: number | null = null;
	let offset = 0;
	let currentSpeed = 0;
	let currentFeatureType = 0;
	let lastM73R: number | null = null;

	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i]!;
		// A split on "\n" consumes a newline for every element except
		// possibly the last: if the text doesn't end with "\n", the final
		// element has no newline after it, so it must NOT get the +1 (else
		// byteOffset ends up one past the actual end of file). The empty
		// string split() produces for text that DOES end in "\n" behaves
		// correctly either way, since it never contains a parseable line.
		const consumedNewline = i < lines.length - 1 || rawLine === "";
		offset += rawLine.length + (consumedNewline ? 1 : 0);

		const semiIdx = rawLine.indexOf(";");
		if (semiIdx !== -1) {
			const commentText = rawLine.slice(semiIdx + 1).trim();
			if (commentText.startsWith("TYPE:")) {
				currentFeatureType = mapLabelToFeatureType(commentText.slice(5).trim());
			} else if (commentText === "LAYER_CHANGE") {
				layerStartR.push(lastM73R ?? NaN);
			}
		}

		const line = rawLine.replace(/;.*$/, "").replace(/\([^)]*\)/g, "").trim();
		if (line === "") continue;

		const cmdMatch = CMD_RE.exec(line);
		if (!cmdMatch) continue;
		const cmd = `${cmdMatch[1]!.toUpperCase()}${Number(cmdMatch[2])}`;

		if (cmd === "G90") { absolute = true; continue; }
		if (cmd === "G91") { absolute = false; continue; }
		if (cmd === "M82") { eAbsolute = true; continue; }
		if (cmd === "M83") { eAbsolute = false; continue; }
		if (cmd === "M73") {
			const rMatch = M73_R_RE.exec(line);
			if (rMatch) lastM73R = Number(rMatch[1]);
			continue;
		}
		if (!MOVE_COMMANDS.has(cmd)) continue;

		const params: Record<string, number> = {};
		PARAM_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PARAM_RE.exec(line)) !== null) {
			params[m[1]!.toUpperCase()] = Number(m[2]);
		}

		if (params.F !== undefined) currentSpeed = params.F;

		const newX = params.X !== undefined ? (absolute ? params.X : x + params.X) : x;
		const newY = params.Y !== undefined ? (absolute ? params.Y : y + params.Y) : y;
		const newZ = params.Z !== undefined ? (absolute ? params.Z : z + params.Z) : z;
		const newE = params.E !== undefined ? (eAbsolute ? params.E : e + params.E) : e;
		const dE = newE - e;
		const isExtruding = dE > 0;

		positions.push(x, y, z, newX, newY, newZ);
		extruding.push(isExtruding ? 1 : 0);
		byteOffset.push(offset);
		deltaE.push(dE);
		speed.push(currentSpeed);
		featureType.push(currentFeatureType);

		if (isExtruding) {
			if (lastExtrudeZ === null) {
				layerHeights.push(newZ);
			} else if (newZ !== lastExtrudeZ) {
				layerHeights.push(newZ - lastExtrudeZ);
				currentLayer += 1;
			}
			lastExtrudeZ = newZ;
		}
		layerIndex.push(currentLayer);

		x = newX; y = newY; z = newZ; e = newE;
	}

	const layerCount = layerIndex.length > 0 ? currentLayer + 1 : 0;

	const layerTimeMinutes = new Float32Array(layerCount);
	for (let i = 0; i < layerCount; i++) {
		const startR = layerStartR[i];
		const endR = i < layerCount - 1 ? layerStartR[i + 1] : (lastM73R ?? undefined);
		layerTimeMinutes[i] = (typeof startR === "number" && !Number.isNaN(startR) && typeof endR === "number" && !Number.isNaN(endR))
			? startR - endR
			: NaN;
	}

	return {
		positions: new Float32Array(positions),
		layerIndex: new Uint16Array(layerIndex),
		byteOffset: new Float64Array(byteOffset),
		extruding: new Uint8Array(extruding),
		segmentCount: layerIndex.length,
		layerCount,
		deltaE: new Float32Array(deltaE),
		speed: new Float32Array(speed),
		featureType: new Uint8Array(featureType),
		layerHeights: new Float32Array(layerHeights),
		layerTimeMinutes,
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/parse-gcode.test.ts`
Expected: all 16 tests PASS (9 pre-existing + 7 new).

- [ ] **Step 5: Full test suite + typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b && pnpm test`
Expected: same 2 known pre-existing errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/gcode/parseGcode.ts packages/ui/test/parse-gcode.test.ts
git commit -m "feat(ui): track speed, feature-type, and layer-time in the gcode parser"
```

---

## Task 5: Per-segment hue from color mode (`hueColors.ts`)

**Files:**
- Create: `packages/ui/src/gcode/hueColors.ts`
- Test: `packages/ui/test/hue-colors.test.ts`

**Interfaces:**
- Consumes: `ParsedToolpath` (Task 4, type-only), `FEATURE_TYPE_COLORS` (Task 2).
- Produces:
  ```ts
  export type ColorMode = "speed" | "feature-type" | "layer-time";
  export function colorModeAvailable(toolpath: ParsedToolpath, mode: ColorMode): boolean;
  export function computeHueColors(toolpath: ParsedToolpath, mode: ColorMode): Float32Array; // RGB, 6 floats/segment (2 vertices x 3 channels)
  ```
  Consumed by Task 8 (`GcodeViewer.tsx`), combined with Task 6's alpha via `combineRGBA`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/hue-colors.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHueColors, colorModeAvailable } from "../src/gcode/hueColors.ts";
import { FEATURE_TYPE_COLORS } from "../src/gcode/featureTypes.ts";
import type { ParsedToolpath } from "../src/gcode/parseGcode.ts";

function makeToolpath(overrides: Partial<ParsedToolpath> & { segmentCount: number }): ParsedToolpath {
	const n = overrides.segmentCount;
	const layerCount = overrides.layerCount ?? 1;
	return {
		positions: new Float32Array(n * 6),
		layerIndex: overrides.layerIndex ?? new Uint16Array(n),
		byteOffset: new Float64Array(n),
		extruding: new Uint8Array(n).fill(1),
		segmentCount: n,
		layerCount,
		deltaE: new Float32Array(n),
		speed: overrides.speed ?? new Float32Array(n),
		featureType: overrides.featureType ?? new Uint8Array(n),
		layerHeights: overrides.layerHeights ?? new Float32Array(layerCount),
		layerTimeMinutes: overrides.layerTimeMinutes ?? new Float32Array(layerCount).fill(NaN),
	};
}

test("feature-type mode colors each segment by its FEATURE_TYPE_COLORS entry", () => {
	const toolpath = makeToolpath({ segmentCount: 2, featureType: new Uint8Array([1, 2]) });
	const colors = computeHueColors(toolpath, "feature-type");
	const expected1 = Array.from(new Float32Array(FEATURE_TYPE_COLORS[1]!));
	const expected2 = Array.from(new Float32Array(FEATURE_TYPE_COLORS[2]!));
	assert.deepEqual(Array.from(colors.slice(0, 3)), expected1);
	assert.deepEqual(Array.from(colors.slice(6, 9)), expected2);
});

test("speed mode: slowest and fastest segments (normalized per file) get visibly different colors", () => {
	const toolpath = makeToolpath({ segmentCount: 2, speed: new Float32Array([1000, 3000]) });
	const colors = computeHueColors(toolpath, "speed");
	const slow = Array.from(colors.slice(0, 3));
	const fast = Array.from(colors.slice(6, 9));
	assert.notDeepEqual(slow, fast);
});

test("layer-time mode falls back to a neutral color when data is unavailable", () => {
	const toolpath = makeToolpath({ segmentCount: 1, layerTimeMinutes: new Float32Array([NaN]) });
	assert.equal(colorModeAvailable(toolpath, "layer-time"), false);
	const colors = computeHueColors(toolpath, "layer-time");
	assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(colors.slice(3, 6))); // still duplicated per vertex
});

test("colorModeAvailable: speed and feature-type are always available", () => {
	const toolpath = makeToolpath({ segmentCount: 1 });
	assert.equal(colorModeAvailable(toolpath, "speed"), true);
	assert.equal(colorModeAvailable(toolpath, "feature-type"), true);
});

test("colorModeAvailable: layer-time is true when at least one layer has real data", () => {
	const toolpath = makeToolpath({ segmentCount: 1, layerCount: 2, layerTimeMinutes: new Float32Array([NaN, 5]) });
	assert.equal(colorModeAvailable(toolpath, "layer-time"), true);
});

test("each segment's two vertices share the same color", () => {
	const toolpath = makeToolpath({ segmentCount: 2, featureType: new Uint8Array([1, 1]) });
	const colors = computeHueColors(toolpath, "feature-type");
	assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(colors.slice(3, 6)));
});

test("returned array length is segmentCount * 6 (2 vertices * 3 channels)", () => {
	const toolpath = makeToolpath({ segmentCount: 3 });
	const colors = computeHueColors(toolpath, "speed");
	assert.equal(colors.length, 18);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && node --test test/hue-colors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ui/src/gcode/hueColors.ts`:

```ts
/**
 * Per-segment RGB from the active color mode. Independent of reveal-mode
 * alpha (see renderModes.ts) — GcodeViewer.tsx combines both into the
 * final RGBA fed to the scene via renderModes.ts's combineRGBA.
 */

import type { ParsedToolpath } from "./parseGcode.ts";
import { FEATURE_TYPE_COLORS } from "./featureTypes.ts";

export type ColorMode = "speed" | "feature-type" | "layer-time";

const SLOW_COLOR: readonly [number, number, number] = [0.25, 0.4, 0.85]; // blue
const FAST_COLOR: readonly [number, number, number] = [0.85, 0.3, 0.25]; // red
const NO_DATA_COLOR: readonly [number, number, number] = [0.5, 0.5, 0.5]; // neutral gray

function lerp3(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
	t: number,
): readonly [number, number, number] {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function colorModeAvailable(toolpath: ParsedToolpath, mode: ColorMode): boolean {
	if (mode === "layer-time") {
		for (const t of toolpath.layerTimeMinutes) if (!Number.isNaN(t)) return true;
		return false;
	}
	return true;
}

export function computeHueColors(toolpath: ParsedToolpath, mode: ColorMode): Float32Array {
	const { segmentCount } = toolpath;
	const colors = new Float32Array(segmentCount * 6);

	const writeSegment = (i: number, rgb: readonly [number, number, number]): void => {
		const base = i * 6;
		colors[base] = rgb[0]; colors[base + 1] = rgb[1]; colors[base + 2] = rgb[2];
		colors[base + 3] = rgb[0]; colors[base + 4] = rgb[1]; colors[base + 5] = rgb[2];
	};

	if (mode === "feature-type") {
		for (let i = 0; i < segmentCount; i++) {
			writeSegment(i, FEATURE_TYPE_COLORS[toolpath.featureType[i]!] ?? NO_DATA_COLOR);
		}
		return colors;
	}

	if (mode === "layer-time") {
		let min = Infinity, max = -Infinity;
		for (const t of toolpath.layerTimeMinutes) if (!Number.isNaN(t)) { min = Math.min(min, t); max = Math.max(max, t); }
		const hasData = Number.isFinite(min) && Number.isFinite(max);
		for (let i = 0; i < segmentCount; i++) {
			const layerTime = toolpath.layerTimeMinutes[toolpath.layerIndex[i]!]!;
			if (!hasData || Number.isNaN(layerTime)) { writeSegment(i, NO_DATA_COLOR); continue; }
			const t = max > min ? (layerTime - min) / (max - min) : 0;
			writeSegment(i, lerp3(SLOW_COLOR, FAST_COLOR, t));
		}
		return colors;
	}

	// speed
	let min = Infinity, max = -Infinity;
	for (const s of toolpath.speed) { min = Math.min(min, s); max = Math.max(max, s); }
	for (let i = 0; i < segmentCount; i++) {
		const s = toolpath.speed[i]!;
		const t = max > min ? (s - min) / (max - min) : 0;
		writeSegment(i, lerp3(SLOW_COLOR, FAST_COLOR, t));
	}
	return colors;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/hue-colors.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/hueColors.ts packages/ui/test/hue-colors.test.ts
git commit -m "feat(ui): add per-segment hue computation for color modes"
```

---

## Task 6: Rewrite `renderModes.ts` for alpha (replaces the RGB dim/bright scheme)

**Files:**
- Modify: `packages/ui/src/gcode/renderModes.ts`
- Modify: `packages/ui/test/render-modes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RenderMode = "progressive" | "static" | "layer-focus"; // unchanged
  export function computeSegmentAlpha(
      segmentCount: number, layerIndex: Uint16Array, liveSegmentIndex: number, mode: RenderMode,
  ): Float32Array; // 1 alpha per vertex (segmentCount * 2)
  export function combineRGBA(rgb: Float32Array, alpha: Float32Array): Float32Array; // rgb (6/segment) + alpha (2/segment) -> rgba (8/segment)
  ```
  `computeSegmentAlpha` replaces the old `computeSegmentColors` (deleted — no consumer of the old RGB dim/bright scheme remains after Task 8). `combineRGBA` is consumed by Task 8 (`GcodeViewer.tsx`), which feeds `hueColors.ts`'s RGB and this task's alpha into it before calling `scene.setGeometry`/`updateColors`.

This REPLACES the entire file and its test file — do not try to preserve the old `computeSegmentColors`/`BRIGHT`/`DIM` API; delete it in favor of the alpha-only version.

- [ ] **Step 1: Write the new test file (full replacement)**

Replace the full contents of `packages/ui/test/render-modes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentAlpha, combineRGBA } from "../src/gcode/renderModes.ts";

test("static mode: every segment is opaque regardless of live index", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1]);
	const alpha = computeSegmentAlpha(4, layerIndex, -1, "static");
	for (let seg = 0; seg < 4; seg++) {
		assert.equal(alpha[seg * 2], 1.0);
		assert.equal(alpha[seg * 2 + 1], 1.0);
	}
});

test("progressive mode: segments up to and including liveSegmentIndex are opaque, rest translucent", () => {
	const layerIndex = new Uint16Array([0, 0, 0, 0]);
	const alpha = computeSegmentAlpha(4, layerIndex, 1, "progressive");
	assert.equal(alpha[0], 1.0); // segment 0
	assert.equal(alpha[2], 1.0); // segment 1 (== liveSegmentIndex)
	assert.ok(alpha[4]! < 1.0); // segment 2
	assert.ok(alpha[6]! < 1.0); // segment 3
});

test("progressive mode with liveSegmentIndex -1: everything translucent (nothing printed yet)", () => {
	const layerIndex = new Uint16Array([0, 0]);
	const alpha = computeSegmentAlpha(2, layerIndex, -1, "progressive");
	assert.ok(alpha[0]! < 1.0);
	assert.ok(alpha[2]! < 1.0);
});

test("layer-focus mode: only segments sharing the live segment's layer are opaque", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1, 2]);
	const alpha = computeSegmentAlpha(5, layerIndex, 2, "layer-focus"); // liveSegmentIndex=2 -> layer 1
	assert.ok(alpha[0]! < 1.0);   // layer 0
	assert.ok(alpha[2]! < 1.0);   // layer 0
	assert.equal(alpha[4], 1.0);  // layer 1
	assert.equal(alpha[6], 1.0);  // layer 1
	assert.ok(alpha[8]! < 1.0);   // layer 2
});

test("each segment's two vertices share the same alpha", () => {
	const layerIndex = new Uint16Array([0, 1]);
	const alpha = computeSegmentAlpha(2, layerIndex, 0, "progressive");
	assert.equal(alpha[0], alpha[1]);
	assert.equal(alpha[2], alpha[3]);
});

test("returned array length is segmentCount * 2 (1 alpha per vertex)", () => {
	const alpha = computeSegmentAlpha(3, new Uint16Array([0, 0, 0]), -1, "static");
	assert.equal(alpha.length, 6);
});

test("combineRGBA interleaves rgb triples with alpha into rgba quads, per vertex", () => {
	const rgb = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]); // 1 segment, 2 vertices
	const alpha = new Float32Array([0.9, 0.8]);
	const rgba = combineRGBA(rgb, alpha);
	assert.deepEqual(Array.from(rgba), Array.from(new Float32Array([0.1, 0.2, 0.3, 0.9, 0.4, 0.5, 0.6, 0.8])));
});

test("combineRGBA output length is segmentCount * 8 (2 vertices * 4 channels)", () => {
	const rgb = new Float32Array(12); // 2 segments
	const alpha = new Float32Array(4);
	const rgba = combineRGBA(rgb, alpha);
	assert.equal(rgba.length, 16);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && node --test test/render-modes.test.ts`
Expected: FAIL — `computeSegmentAlpha`/`combineRGBA` don't exist yet (the file still exports the old `computeSegmentColors`).

- [ ] **Step 3: Implement (full file replacement)**

Replace the full contents of `packages/ui/src/gcode/renderModes.ts`:

```ts
/**
 * Per-mode ALPHA computation for the toolpath mesh — color (hue) comes
 * from hueColors.ts, this only decides how see-through each segment is.
 * "Not yet printed" / "not the focused layer" segments become genuinely
 * translucent (real alpha, via the forked LineMaterial — see
 * src/gcode/lineMaterial/) rather than a darker shade, so GcodeViewer.tsx
 * can combine any color mode with any reveal mode. Recomputing alpha is
 * O(segmentCount) and runs on every live filePosition tick; it never
 * touches geometry/position/hue data, only the alpha channel (see
 * scene.ts's updateColors).
 */

export type RenderMode = "progressive" | "static" | "layer-focus";

const OPAQUE = 1.0;
const TRANSLUCENT = 0.15;

export function computeSegmentAlpha(
	segmentCount: number,
	layerIndex: Uint16Array,
	liveSegmentIndex: number,
	mode: RenderMode,
): Float32Array {
	const alpha = new Float32Array(segmentCount * 2); // 1 value per vertex
	const liveLayer = liveSegmentIndex >= 0 && liveSegmentIndex < layerIndex.length
		? layerIndex[liveSegmentIndex]!
		: -1;

	for (let i = 0; i < segmentCount; i++) {
		let opaque: boolean;
		if (mode === "static") opaque = true;
		else if (mode === "layer-focus") opaque = layerIndex[i] === liveLayer;
		else opaque = i <= liveSegmentIndex; // progressive

		const a = opaque ? OPAQUE : TRANSLUCENT;
		alpha[i * 2] = a;
		alpha[i * 2 + 1] = a;
	}
	return alpha;
}

/** Interleaves hueColors.ts's per-vertex RGB with this module's per-vertex
 *  alpha into the RGBA the forked LineSegmentsGeometry.setColors expects. */
export function combineRGBA(rgb: Float32Array, alpha: Float32Array): Float32Array {
	const segmentCount = alpha.length / 2;
	const rgba = new Float32Array(segmentCount * 8);
	for (let i = 0; i < segmentCount; i++) {
		const rgbBase = i * 6;
		const rgbaBase = i * 8;
		rgba[rgbaBase] = rgb[rgbBase]!;
		rgba[rgbaBase + 1] = rgb[rgbBase + 1]!;
		rgba[rgbaBase + 2] = rgb[rgbBase + 2]!;
		rgba[rgbaBase + 3] = alpha[i * 2]!;
		rgba[rgbaBase + 4] = rgb[rgbBase + 3]!;
		rgba[rgbaBase + 5] = rgb[rgbBase + 4]!;
		rgba[rgbaBase + 6] = rgb[rgbBase + 5]!;
		rgba[rgbaBase + 7] = alpha[i * 2 + 1]!;
	}
	return rgba;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/render-modes.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/renderModes.ts packages/ui/test/render-modes.test.ts
git commit -m "feat(ui): replace dim-color reveal modes with real alpha + RGBA combiner"
```

---

## Task 7: Vendor + fork LineMaterial/LineSegmentsGeometry/LineSegments2 for RGBA + per-segment width

**Files:**
- Create: `packages/ui/src/gcode/lineMaterial/LineSegmentsGeometry.ts`
- Create: `packages/ui/src/gcode/lineMaterial/LineMaterial.ts`
- Create: `packages/ui/src/gcode/lineMaterial/LineSegments2.ts`

**Interfaces:**
- Produces: `LineSegmentsGeometry` (with `setPositions`, `setColors` [now vec4/RGBA], `setWidths` [new]), `LineMaterial` (constructor accepts standard `THREE.Material` options plus `worldUnits`/`linewidth`), `LineSegments2` (a `THREE.Mesh` subclass) — consumed by Task 8 (`scene.ts`).

No automated test for this task: it's a vendored/forked copy of WebGL shader code, not testable in this project's `node:test` setup (no WebGL context) — the same carve-out the original gcode-viewer plan used for `scene.ts`. Verified live as part of Task 8's live-verification step.

- [ ] **Step 1: Create the forked `LineSegmentsGeometry.ts`**

Forked from the installed `three@0.185.1`'s `node_modules/three/examples/jsm/lines/LineSegmentsGeometry.js`. Changes from upstream: `setColors` now takes RGBA (stride 8, itemSize 4) instead of RGB (stride 6, itemSize 3); added `setWidths` for the new per-segment width-scale attribute.

Create `packages/ui/src/gcode/lineMaterial/LineSegmentsGeometry.ts`:

```ts
/**
 * Forked from three@0.185.1's examples/jsm/lines/LineSegmentsGeometry.js.
 * Changes from upstream, for docs/superpowers/specs/
 * 2026-07-19-gcode-viewer-colorize-thick-lines-design.md:
 *   - setColors() now takes RGBA (stride 8, itemSize 4) instead of RGB
 *     (stride 6, itemSize 3) — stock Three.js has no per-vertex alpha
 *     channel on this geometry (see LineMaterial.ts's header comment).
 *   - Added setWidths() for a new per-segment width-scale instanced
 *     attribute, consumed by the forked LineMaterial.ts's vertex shader
 *     to give each segment real, independently-varying line width.
 * Everything else (bounding box/sphere computation, applyMatrix4, the
 * wireframe/mesh/lineSegments conversion helpers) is unchanged from
 * upstream.
 */
import {
	Box3,
	Float32BufferAttribute,
	InstancedBufferGeometry,
	InstancedInterleavedBuffer,
	InterleavedBufferAttribute,
	Sphere,
	Vector3,
} from "three";

const _box = new Box3();
const _vector = new Vector3();

export class LineSegmentsGeometry extends InstancedBufferGeometry {
	isLineSegmentsGeometry = true;

	constructor() {
		super();

		this.type = "LineSegmentsGeometry";

		const positions = [-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0];
		const uvs = [-1, 2, 1, 2, -1, 1, 1, 1, -1, -1, 1, -1, -1, -2, 1, -2];
		const index = [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5];

		this.setIndex(index);
		this.setAttribute("position", new Float32BufferAttribute(positions, 3));
		this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
	}

	applyMatrix4(matrix: any): this {
		const start = this.attributes.instanceStart;
		const end = this.attributes.instanceEnd;

		if (start !== undefined) {
			(start as any).applyMatrix4(matrix);
			(end as any).applyMatrix4(matrix);
			start.needsUpdate = true;
		}

		if (this.boundingBox !== null) this.computeBoundingBox();
		if (this.boundingSphere !== null) this.computeBoundingSphere();

		return this;
	}

	/** Length must be a multiple of six: each segment is (xyz xyz). */
	setPositions(array: Float32Array | number[]): this {
		const lineSegments = array instanceof Float32Array ? array : new Float32Array(array);
		const instanceBuffer = new InstancedInterleavedBuffer(lineSegments, 6, 1);

		this.setAttribute("instanceStart", new InterleavedBufferAttribute(instanceBuffer, 3, 0));
		this.setAttribute("instanceEnd", new InterleavedBufferAttribute(instanceBuffer, 3, 3));

		this.instanceCount = (this.attributes.instanceStart as InterleavedBufferAttribute).count;

		this.computeBoundingBox();
		this.computeBoundingSphere();

		return this;
	}

	/** Length must be a multiple of eight: each segment is (rgba rgba). */
	setColors(array: Float32Array | number[]): this {
		const colors = array instanceof Float32Array ? array : new Float32Array(array);
		const instanceColorBuffer = new InstancedInterleavedBuffer(colors, 8, 1);

		this.setAttribute("instanceColorStart", new InterleavedBufferAttribute(instanceColorBuffer, 4, 0));
		this.setAttribute("instanceColorEnd", new InterleavedBufferAttribute(instanceColorBuffer, 4, 4));

		return this;
	}

	/** One value per segment — the same scale applies to both of a
	 *  segment's vertices, unlike start/end colors/positions. */
	setWidths(array: Float32Array | number[]): this {
		const widths = array instanceof Float32Array ? array : new Float32Array(array);
		const instanceWidthBuffer = new InstancedInterleavedBuffer(widths, 1, 1);

		this.setAttribute("instanceWidthScale", new InterleavedBufferAttribute(instanceWidthBuffer, 1, 0));

		return this;
	}

	computeBoundingBox(): void {
		if (this.boundingBox === null) this.boundingBox = new Box3();

		const start = this.attributes.instanceStart;
		const end = this.attributes.instanceEnd;

		if (start !== undefined && end !== undefined) {
			this.boundingBox.setFromBufferAttribute(start as any);
			_box.setFromBufferAttribute(end as any);
			this.boundingBox.union(_box);
		}
	}

	computeBoundingSphere(): void {
		if (this.boundingSphere === null) this.boundingSphere = new Sphere();
		if (this.boundingBox === null) this.computeBoundingBox();

		const start = this.attributes.instanceStart;
		const end = this.attributes.instanceEnd;

		if (start !== undefined && end !== undefined) {
			const center = this.boundingSphere.center;
			this.boundingBox!.getCenter(center);

			let maxRadiusSq = 0;
			for (let i = 0, il = start.count; i < il; i++) {
				_vector.fromBufferAttribute(start as any, i);
				maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
				_vector.fromBufferAttribute(end as any, i);
				maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_vector));
			}

			this.boundingSphere.radius = Math.sqrt(maxRadiusSq);
		}
	}
}
```

- [ ] **Step 2: Create the forked `LineMaterial.ts`**

Forked from `LineMaterial.js`. Changes from upstream, all documented inline: `instanceColorStart`/`instanceColorEnd` are `vec4` (not `vec3`); a custom `vLineColor` varying replaces the stock `color_pars_vertex`/`color_pars_fragment`/`color_fragment` chunks (which assume `vec3`); a new `instanceWidthScale` attribute scales the world-units half-width; the final fragment alpha multiplies in `vLineColor.a`.

Create `packages/ui/src/gcode/lineMaterial/LineMaterial.ts`:

```ts
/**
 * Forked from three@0.185.1's examples/jsm/lines/LineMaterial.js.
 * Changes from upstream, for docs/superpowers/specs/
 * 2026-07-19-gcode-viewer-colorize-thick-lines-design.md:
 *   - instanceColorStart/instanceColorEnd are vec4 (RGBA) instead of vec3
 *     (RGB) — stock LineMaterial has no per-vertex alpha (a real,
 *     unresolved upstream limitation: github.com/mrdoob/three.js/issues/23680,
 *     "Add vertex color alpha channel support to LineMaterial"). A
 *     dedicated `vLineColor` varying replaces the stock chunks
 *     (`color_pars_vertex`/`color_pars_fragment`/`color_fragment`), which
 *     hardcode vec3 and can't be reused for vec4 without their own fork.
 *   - Added a per-segment `instanceWidthScale` attribute, multiplied into
 *     the world-units half-width calculation, so each segment can have
 *     genuinely different width (stock LineMaterial.linewidth is one
 *     scalar for the whole material).
 *   - Dash support, screen-space (non-worldUnits) width, and
 *     alpha-to-coverage are left in place unchanged — this app always
 *     constructs the material with worldUnits:true, but the fork doesn't
 *     remove the other modes.
 *   - Trimmed upstream's per-property JSDoc blocks (this project's own
 *     convention favors terse comments over verbose per-getter docs);
 *     the runtime behavior of every getter/setter is unchanged from
 *     upstream.
 */
import { ShaderLib, ShaderMaterial, UniformsLib, UniformsUtils, Vector2 } from "three";

(UniformsLib as any).line = {
	worldUnits: { value: 1 },
	linewidth: { value: 1 },
	resolution: { value: new Vector2() },
	dashOffset: { value: 0 },
	dashScale: { value: 1 },
	dashSize: { value: 1 },
	gapSize: { value: 1 },
};

(ShaderLib as any).line = {
	uniforms: UniformsUtils.merge([
		(UniformsLib as any).common,
		(UniformsLib as any).fog,
		(UniformsLib as any).line,
	]),

	vertexShader: /* glsl */ `
		#include <common>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec4 instanceColorStart;
		attribute vec4 instanceColorEnd;
		varying vec4 vLineColor;

		attribute float instanceWidthScale;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH
				varying vec2 vUv;
			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH
			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;
		#endif

		float trimSegmentAlpha( const in vec4 start, const in vec4 end ) {
			float a = projectionMatrix[ 2 ][ 2 ];
			float b = projectionMatrix[ 3 ][ 2 ];
			float nearEstimate = ( a > 0.0 ) ? ( - b / ( a + 1.0 ) ) : ( - 0.5 * b / a );
			return ( nearEstimate - start.z ) / ( end.z - start.z );
		}

		void main() {

			vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			float aspect = resolution.x / resolution.y;

			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef USE_DASH
				float lineDistanceStart = dashScale * instanceDistanceStart;
				float lineDistanceEnd = dashScale * instanceDistanceEnd;
			#endif

			#ifdef WORLD_UNITS
				worldStart = start.xyz;
				worldEnd = end.xyz;
			#else
				vUv = uv;
			#endif

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 );

			if ( perspective ) {
				if ( start.z < 0.0 && end.z >= 0.0 ) {
					float alpha = trimSegmentAlpha( start, end );
					end.xyz = mix( start.xyz, end.xyz, alpha );
					#ifdef USE_DASH
						lineDistanceEnd = mix( lineDistanceStart, lineDistanceEnd, alpha );
					#endif
				} else if ( end.z < 0.0 && start.z >= 0.0 ) {
					float alpha = trimSegmentAlpha( end, start );
					start.xyz = mix( end.xyz, start.xyz, alpha );
					#ifdef USE_DASH
						lineDistanceStart = mix( lineDistanceEnd, lineDistanceStart, alpha );
					#endif
				}
			}

			#ifdef USE_DASH
				vLineDistance = ( position.y < 0.5 ) ? lineDistanceStart : lineDistanceEnd;
				vUv = uv;
			#endif

			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			vec2 dir = ndcEnd.xy - ndcStart.xy;

			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				float hw = linewidth * 0.5 * instanceWidthScale;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				#ifndef USE_DASH
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;
					worldPos.xyz += worldFwd * hw;
					if ( position.y > 1.0 || position.y < 0.0 ) {
						worldPos.xyz -= worldFwd * 2.0 * hw;
					}
				#endif

				vec4 clip = projectionMatrix * worldPos;

				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				dir.x /= aspect;
				offset.x /= aspect;

				if ( position.x < 0.0 ) offset *= - 1.0;

				if ( position.y < 0.0 ) {
					offset += - dir;
				} else if ( position.y > 1.0 ) {
					offset += dir;
				}

				offset *= linewidth * instanceWidthScale;
				offset /= resolution.y;

				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end;

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,

	fragmentShader: /* glsl */ `
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH
			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;
		#endif

		varying float vLineDistance;
		varying vec4 vLineColor;

		#ifdef WORLD_UNITS
			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;
			#ifdef USE_DASH
				varying vec2 vUv;
			#endif
		#else
			varying vec2 vUv;
		#endif

		#include <common>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {
			float mua; float mub;
			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;
			vec3 p21 = p2 - p1;
			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );
			float denom = d2121 * d4343 - d4321 * d4321;
			float numer = d1343 * d4321 - d1321 * d4343;
			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );
			return vec2( mua, mub );
		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH
				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard;
				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard;
			#endif

			#ifdef WORLD_UNITS

				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );
				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH
					#ifdef USE_ALPHA_TO_COVERAGE
						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );
					#else
						if ( norm > 0.5 ) discard;
					#endif
				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );
					if ( abs( vUv.y ) > 1.0 ) {
						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );
					}
				#else
					if ( abs( vUv.y ) > 1.0 ) {
						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;
						if ( len2 > 1.0 ) discard;
					}
				#endif

			#endif

			diffuseColor.rgb *= vLineColor.rgb;

			#include <logdepthbuf_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha * vLineColor.a );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`,
};

export class LineMaterial extends ShaderMaterial {
	isLineMaterial = true;

	constructor(parameters?: Record<string, unknown>) {
		super({
			type: "LineMaterial",
			uniforms: UniformsUtils.clone((ShaderLib as any).line.uniforms),
			vertexShader: (ShaderLib as any).line.vertexShader,
			fragmentShader: (ShaderLib as any).line.fragmentShader,
			clipping: true,
		});

		this.setValues(parameters as any);
	}

	get color() { return (this.uniforms as any).diffuse.value; }
	set color(value) { (this.uniforms as any).diffuse.value = value; }

	get worldUnits() { return "WORLD_UNITS" in this.defines!; }
	set worldUnits(value: boolean) {
		if ((value === true) !== this.worldUnits) this.needsUpdate = true;
		if (value === true) this.defines!.WORLD_UNITS = "";
		else delete this.defines!.WORLD_UNITS;
	}

	get linewidth() { return (this.uniforms as any).linewidth.value; }
	set linewidth(value: number) {
		if (!(this.uniforms as any).linewidth) return;
		(this.uniforms as any).linewidth.value = value;
	}

	get dashed() { return "USE_DASH" in this.defines!; }
	set dashed(value: boolean) {
		if ((value === true) !== this.dashed) this.needsUpdate = true;
		if (value === true) this.defines!.USE_DASH = "";
		else delete this.defines!.USE_DASH;
	}

	get dashScale() { return (this.uniforms as any).dashScale.value; }
	set dashScale(value: number) { (this.uniforms as any).dashScale.value = value; }

	get dashSize() { return (this.uniforms as any).dashSize.value; }
	set dashSize(value: number) { (this.uniforms as any).dashSize.value = value; }

	get dashOffset() { return (this.uniforms as any).dashOffset.value; }
	set dashOffset(value: number) { (this.uniforms as any).dashOffset.value = value; }

	get gapSize() { return (this.uniforms as any).gapSize.value; }
	set gapSize(value: number) { (this.uniforms as any).gapSize.value = value; }

	get opacity() { return (this.uniforms as any).opacity.value; }
	set opacity(value: number) {
		if (!this.uniforms) return;
		(this.uniforms as any).opacity.value = value;
	}

	get resolution() { return (this.uniforms as any).resolution.value; }
	set resolution(value: { x: number; y: number }) { (this.uniforms as any).resolution.value.copy(value); }

	get alphaToCoverage() { return "USE_ALPHA_TO_COVERAGE" in this.defines!; }
	set alphaToCoverage(value: boolean) {
		if (!this.defines) return;
		if ((value === true) !== this.alphaToCoverage) this.needsUpdate = true;
		if (value === true) this.defines.USE_ALPHA_TO_COVERAGE = "";
		else delete this.defines.USE_ALPHA_TO_COVERAGE;
	}
}
```

- [ ] **Step 3: Create `LineSegments2.ts`**

Forked from `LineSegments2.js`, unmodified except import paths pointing at the two files above (raycasting/`computeLineDistances` logic is untouched — this app doesn't raycast against the toolpath or use dashing, but there's no reason to strip working code the fork doesn't need to change).

Create `packages/ui/src/gcode/lineMaterial/LineSegments2.ts`:

```ts
/**
 * Forked from three@0.185.1's examples/jsm/lines/LineSegments2.js. Only
 * change from upstream: imports point at this directory's forked
 * LineSegmentsGeometry.ts/LineMaterial.ts instead of the stock modules.
 */
import { Box3, InstancedInterleavedBuffer, InterleavedBufferAttribute, Line3, MathUtils, Matrix4, Mesh, Sphere, Vector3, Vector4 } from "three";
import { LineSegmentsGeometry } from "./LineSegmentsGeometry.ts";
import { LineMaterial } from "./LineMaterial.ts";

const _viewport = new Vector4();
const _start = new Vector3();
const _end = new Vector3();
const _start4 = new Vector4();
const _end4 = new Vector4();
const _ssOrigin = new Vector4();
const _ssOrigin3 = new Vector3();
const _mvMatrix = new Matrix4();
const _line = new Line3();
const _closestPoint = new Vector3();
const _box = new Box3();
const _sphere = new Sphere();
const _clipToWorldVector = new Vector4();

let _ray: any, _lineWidth: number;

function getWorldSpaceHalfWidth(camera: any, distance: number, resolution: any): number {
	_clipToWorldVector.set(0, 0, -distance, 1.0).applyMatrix4(camera.projectionMatrix);
	_clipToWorldVector.multiplyScalar(1.0 / _clipToWorldVector.w);
	_clipToWorldVector.x = _lineWidth / resolution.width;
	_clipToWorldVector.y = _lineWidth / resolution.height;
	_clipToWorldVector.applyMatrix4(camera.projectionMatrixInverse);
	_clipToWorldVector.multiplyScalar(1.0 / _clipToWorldVector.w);
	return Math.abs(Math.max(_clipToWorldVector.x, _clipToWorldVector.y));
}

function raycastWorldUnits(lineSegments: any, intersects: any[]): void {
	const matrixWorld = lineSegments.matrixWorld;
	const geometry = lineSegments.geometry;
	const instanceStart = geometry.attributes.instanceStart;
	const instanceEnd = geometry.attributes.instanceEnd;
	const segmentCount = Math.min(geometry.instanceCount, instanceStart.count);

	for (let i = 0; i < segmentCount; i++) {
		_line.start.fromBufferAttribute(instanceStart, i);
		_line.end.fromBufferAttribute(instanceEnd, i);
		_line.applyMatrix4(matrixWorld);

		const pointOnLine = new Vector3();
		const point = new Vector3();
		_ray.distanceSqToSegment(_line.start, _line.end, point, pointOnLine);
		const isInside = point.distanceTo(pointOnLine) < _lineWidth * 0.5;

		if (isInside) {
			intersects.push({ point, pointOnLine, distance: _ray.origin.distanceTo(point), object: lineSegments, face: null, faceIndex: i, uv: null, uv1: null });
		}
	}
}

function raycastScreenSpace(lineSegments: any, camera: any, intersects: any[]): void {
	const projectionMatrix = camera.projectionMatrix;
	const material = lineSegments.material;
	const resolution = material.resolution;
	const matrixWorld = lineSegments.matrixWorld;
	const geometry = lineSegments.geometry;
	const instanceStart = geometry.attributes.instanceStart;
	const instanceEnd = geometry.attributes.instanceEnd;
	const segmentCount = Math.min(geometry.instanceCount, instanceStart.count);
	const near = -camera.near;

	_ray.at(1, _ssOrigin);
	_ssOrigin.w = 1;
	_ssOrigin.applyMatrix4(camera.matrixWorldInverse);
	_ssOrigin.applyMatrix4(projectionMatrix);
	_ssOrigin.multiplyScalar(1 / _ssOrigin.w);
	_ssOrigin.x *= resolution.x / 2;
	_ssOrigin.y *= resolution.y / 2;
	_ssOrigin.z = 0;
	_ssOrigin3.copy(_ssOrigin);
	_mvMatrix.multiplyMatrices(camera.matrixWorldInverse, matrixWorld);

	for (let i = 0; i < segmentCount; i++) {
		_start4.fromBufferAttribute(instanceStart, i);
		_end4.fromBufferAttribute(instanceEnd, i);
		_start4.w = 1;
		_end4.w = 1;
		_start4.applyMatrix4(_mvMatrix);
		_end4.applyMatrix4(_mvMatrix);

		const isBehindCameraNear = _start4.z > near && _end4.z > near;
		if (isBehindCameraNear) continue;

		if (_start4.z > near) {
			const deltaDist = _start4.z - _end4.z;
			const t = (_start4.z - near) / deltaDist;
			_start4.lerp(_end4, t);
		} else if (_end4.z > near) {
			const deltaDist = _end4.z - _start4.z;
			const t = (_end4.z - near) / deltaDist;
			_end4.lerp(_start4, t);
		}

		_start4.applyMatrix4(projectionMatrix);
		_end4.applyMatrix4(projectionMatrix);
		_start4.multiplyScalar(1 / _start4.w);
		_end4.multiplyScalar(1 / _end4.w);
		_start4.x *= resolution.x / 2;
		_start4.y *= resolution.y / 2;
		_end4.x *= resolution.x / 2;
		_end4.y *= resolution.y / 2;

		_line.start.copy(_start4 as any);
		_line.start.z = 0;
		_line.end.copy(_end4 as any);
		_line.end.z = 0;

		const param = _line.closestPointToPointParameter(_ssOrigin3, true);
		_line.at(param, _closestPoint);

		const zPos = MathUtils.lerp(_start4.z, _end4.z, param);
		const isInClipSpace = zPos >= -1 && zPos <= 1;
		const isInside = _ssOrigin3.distanceTo(_closestPoint) < _lineWidth * 0.5;

		if (isInClipSpace && isInside) {
			_line.start.fromBufferAttribute(instanceStart, i);
			_line.end.fromBufferAttribute(instanceEnd, i);
			_line.start.applyMatrix4(matrixWorld);
			_line.end.applyMatrix4(matrixWorld);

			const pointOnLine = new Vector3();
			const point = new Vector3();
			_ray.distanceSqToSegment(_line.start, _line.end, point, pointOnLine);

			intersects.push({ point, pointOnLine, distance: _ray.origin.distanceTo(point), object: lineSegments, face: null, faceIndex: i, uv: null, uv1: null });
		}
	}
}

export class LineSegments2 extends Mesh {
	isLineSegments2 = true;

	constructor(geometry: LineSegmentsGeometry = new LineSegmentsGeometry(), material: LineMaterial = new LineMaterial({ color: Math.random() * 0xffffff })) {
		super(geometry, material);
		this.type = "LineSegments2";
	}

	computeLineDistances(): this {
		const geometry = this.geometry as any;
		const instanceStart = geometry.attributes.instanceStart;
		const instanceEnd = geometry.attributes.instanceEnd;
		const lineDistances = new Float32Array(2 * instanceStart.count);

		for (let i = 0, j = 0, l = instanceStart.count; i < l; i++, j += 2) {
			_start.fromBufferAttribute(instanceStart, i);
			_end.fromBufferAttribute(instanceEnd, i);
			lineDistances[j] = j === 0 ? 0 : lineDistances[j - 1]!;
			lineDistances[j + 1] = lineDistances[j]! + _start.distanceTo(_end);
		}

		const instanceDistanceBuffer = new InstancedInterleavedBuffer(lineDistances, 2, 1);
		geometry.setAttribute("instanceDistanceStart", new InterleavedBufferAttribute(instanceDistanceBuffer, 1, 0));
		geometry.setAttribute("instanceDistanceEnd", new InterleavedBufferAttribute(instanceDistanceBuffer, 1, 1));

		return this;
	}

	raycast(raycaster: any, intersects: any[]): void {
		const worldUnits = (this.material as any).worldUnits;
		const camera = raycaster.camera;

		if (camera === null && !worldUnits) return;
		if (worldUnits === false && ((this.material as any).resolution.x === 0 || (this.material as any).resolution.y === 0)) return;

		const threshold = raycaster.params.Line2 !== undefined ? raycaster.params.Line2.threshold || 0 : 0;
		_ray = raycaster.ray;

		const matrixWorld = this.matrixWorld;
		const geometry = this.geometry as any;
		const material = this.material as any;

		_lineWidth = material.linewidth + threshold;

		if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
		_sphere.copy(geometry.boundingSphere).applyMatrix4(matrixWorld);

		let sphereMargin: number;
		if (worldUnits) {
			sphereMargin = _lineWidth * 0.5;
		} else {
			const distanceToSphere = Math.max(camera.near, _sphere.distanceToPoint(_ray.origin));
			sphereMargin = getWorldSpaceHalfWidth(camera, distanceToSphere, material.resolution);
		}
		_sphere.radius += sphereMargin;
		if (_ray.intersectsSphere(_sphere) === false) return;

		if (geometry.boundingBox === null) geometry.computeBoundingBox();
		_box.copy(geometry.boundingBox).applyMatrix4(matrixWorld);

		let boxMargin: number;
		if (worldUnits) {
			boxMargin = _lineWidth * 0.5;
		} else {
			const distanceToBox = Math.max(camera.near, _box.distanceToPoint(_ray.origin));
			boxMargin = getWorldSpaceHalfWidth(camera, distanceToBox, material.resolution);
		}
		_box.expandByScalar(boxMargin);
		if (_ray.intersectsBox(_box) === false) return;

		if (worldUnits) raycastWorldUnits(this, intersects);
		else raycastScreenSpace(this, camera, intersects);
	}

	onBeforeRender(renderer: any): void {
		const uniforms = (this.material as any).uniforms;
		if (uniforms && uniforms.resolution) {
			renderer.getViewport(_viewport);
			uniforms.resolution.value.set(_viewport.z, _viewport.w);
		}
	}
}
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b`
Expected: same 2 known pre-existing errors, nothing new. If TypeScript complains about implicit `any` anywhere in these three files, that's unexpected given this project's non-strict `tsconfig.app.json` (no `noImplicitAny`) — if it happens, check whether `noImplicitAny` or `strict` got enabled elsewhere; do not silently add per-line `// @ts-expect-error` suppressions to route around a real config change.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/lineMaterial/
git commit -m "feat(ui): vendor+fork LineMaterial/LineSegmentsGeometry/LineSegments2 for RGBA and per-segment width"
```

---

## Task 8: Rewrite `scene.ts` and `GcodeViewer.tsx` — forked material + color-mode UI

**Why one task, not two:** `scene.ts`'s `setGeometry` signature must change (adds a `widths` parameter) to use the forked material, and `GcodeViewer.tsx` is `scene.ts`'s only caller. Landing the `scene.ts` change alone would leave the build with a real typecheck error (`GcodeViewer.tsx` still calling the old 2-argument `setGeometry`) until a second task fixed it — every task in this plan is required to leave the typecheck baseline unchanged (see Global Constraints), so splitting these into two tasks would mean Task-N's own gate fails by construction. They land together.

**Files:**
- Modify: `packages/ui/src/gcode/scene.ts`
- Modify: `packages/ui/src/gcode/GcodeViewer.tsx`
- Modify: `packages/ui/src/app.css`

**Interfaces:**
- Consumes: `LineSegments2`, `LineSegmentsGeometry`, `LineMaterial` (Task 7), `computeSegmentWidths` (Task 3), extended `ParsedToolpath` (Task 4), `computeHueColors`/`colorModeAvailable`/`ColorMode` (Task 5), `computeSegmentAlpha`/`combineRGBA`/`RenderMode` (Task 6), `Move.extruders` (Task 1).
- Produces:
  ```ts
  export interface SceneHandle {
      setGeometry(positions: Float32Array, colors: Float32Array, widths: Float32Array): void;
      updateColors(colors: Float32Array): void;
      resize(width: number, height: number): void;
      destroy(): void;
  }
  export function createScene(canvas: HTMLCanvasElement, width: number, height: number): SceneHandle;
  ```

`scene.ts` has no automated test — WebGL, verified live in this task's own live-verification step (same carve-out as the original gcode-viewer plan's `scene.ts`).

- [ ] **Step 1: Replace the full contents of `scene.ts`**

Replace `packages/ui/src/gcode/scene.ts`:

```ts
/**
 * Three.js wiring for the G-code toolpath. Imported dynamically (see
 * GcodeViewer.tsx) so the whole Three.js bundle stays out of the initial
 * load — it only ships once Activity's G-code card actually mounts, same
 * lazy-load pattern as src/editor/setup.ts for CodeMirror.
 *
 * Uses the forked LineSegments2/LineSegmentsGeometry/LineMaterial (see
 * ./lineMaterial/) instead of stock THREE.LineSegments — stock Three.js
 * supports neither real per-vertex alpha nor per-segment width, both
 * required here (see docs/superpowers/specs/
 * 2026-07-19-gcode-viewer-colorize-thick-lines-design.md).
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineSegments2 } from "./lineMaterial/LineSegments2.ts";
import { LineSegmentsGeometry } from "./lineMaterial/LineSegmentsGeometry.ts";
import { LineMaterial } from "./lineMaterial/LineMaterial.ts";

export interface SceneHandle {
	/** (Re)builds the mesh from scratch — called once per parsed file. */
	setGeometry(positions: Float32Array, colors: Float32Array, widths: Float32Array): void;
	/** Rewrites only the color attribute — called on every live position tick. */
	updateColors(colors: Float32Array): void;
	resize(width: number, height: number): void;
	destroy(): void;
}

export function createScene(canvas: HTMLCanvasElement, width: number, height: number): SceneHandle {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setSize(width, height, false);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0a1420);

	const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
	camera.position.set(100, 100, 150);
	camera.up.set(0, 0, 1); // gcode's Z is "up" for a build plate, unlike Three's default Y-up

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;

	// One shared material across file loads — vertexColors/worldUnits/
	// linewidth never change per-load, only the per-segment geometry
	// attributes (color, width) do, via a fresh LineSegmentsGeometry each
	// time. LineSegments2's own onBeforeRender keeps the material's
	// resolution uniform in sync with the renderer's viewport on every
	// frame automatically — no manual wiring needed beyond
	// renderer.setSize() in resize() below.
	const material = new LineMaterial({
		vertexColors: true,
		transparent: true,
		worldUnits: true,
		linewidth: 1, // neutral multiplier — real mm width comes from the per-segment instanceWidthScale attribute
	});

	let mesh: LineSegments2 | null = null;
	let raf = 0;
	const animate = (): void => {
		controls.update();
		renderer.render(scene, camera);
		raf = requestAnimationFrame(animate);
	};
	raf = requestAnimationFrame(animate);

	const disposeMesh = (): void => {
		if (mesh === null) return;
		scene.remove(mesh);
		mesh.geometry.dispose();
		mesh = null;
	};

	return {
		setGeometry(positions, colors, widths) {
			disposeMesh();
			const geometry = new LineSegmentsGeometry();
			geometry.setPositions(positions);
			geometry.setColors(colors);
			geometry.setWidths(widths);
			mesh = new LineSegments2(geometry, material);
			scene.add(mesh);
		},
		updateColors(colors) {
			if (mesh === null) return;
			(mesh.geometry as LineSegmentsGeometry).setColors(colors);
		},
		resize(w, h) {
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		},
		destroy() {
			cancelAnimationFrame(raf);
			controls.dispose();
			disposeMesh();
			material.dispose();
			renderer.dispose();
		},
	};
}
```

Note: at this point, before Step 2 below, `GcodeViewer.tsx` still calls the
OLD two-argument `scene.setGeometry(positions, colors)` — do not run a
standalone typecheck between Step 1 and Step 2; proceed directly to
rewriting `GcodeViewer.tsx` so the two files land in a mutually consistent
state before anything is verified.

- [ ] **Step 2: Replace the full contents of `GcodeViewer.tsx`**

Replace `packages/ui/src/gcode/GcodeViewer.tsx`:

```tsx
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";
import { findSegmentIndex } from "./findSegmentIndex.ts";
import { computeSegmentAlpha, combineRGBA, type RenderMode } from "./renderModes.ts";
import { computeHueColors, colorModeAvailable, type ColorMode } from "./hueColors.ts";
import { computeSegmentWidths } from "./segmentWidth.ts";
import type { ParsedToolpath } from "./parseGcode.ts";
import type { SceneHandle } from "./scene.ts";
import type { WorkerResponse } from "./parseGcode.worker.ts";

type Status = "empty" | "loading" | "ready" | "error";

const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;

const REVEAL_MODES: readonly RenderMode[] = ["progressive", "static", "layer-focus"];
const REVEAL_MODE_LABEL: Record<RenderMode, string> = {
	progressive: "Progressive",
	static: "Static",
	"layer-focus": "Layer",
};

const COLOR_MODES: readonly ColorMode[] = ["feature-type", "speed", "layer-time"];
const COLOR_MODE_LABEL: Record<ColorMode, string> = {
	"feature-type": "Feature",
	speed: "Speed",
	"layer-time": "Layer time",
};

/** Live 3D toolpath of the active job — downloaded and parsed once per
 *  file, then only recolored (never re-fetched or re-parsed) as
 *  job.filePosition advances. Color mode (feature-type/speed/layer-time)
 *  picks each segment's hue; reveal mode (progressive/static/layer-focus)
 *  picks its alpha — the two are independent axes, combined every tick.
 *  See docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md. */
export function GcodeViewer(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	let canvasEl!: HTMLCanvasElement;
	let hostEl!: HTMLDivElement;
	let scene: SceneHandle | null = null;
	let worker: Worker | null = null;
	let toolpath: ParsedToolpath | null = null;
	let generation = 0;

	const [status, setStatus] = createSignal<Status>("empty");
	const [message, setMessage] = createSignal("");
	const [revealMode, setRevealMode] = createSignal<RenderMode>("progressive");
	const [colorMode, setColorMode] = createSignal<ColorMode>("feature-type");
	const [lastPath, setLastPath] = createSignal<string | null>(null);

	const activeFileName = (): string | null => {
		const f = app.om.om.job.file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f.fileName : null;
	};

	const filamentDiameter = (): number => app.om.om.move.extruders[0]?.filamentDiameter || DEFAULT_FILAMENT_DIAMETER_MM;

	const recolor = (): void => {
		if (toolpath === null || scene === null) return;
		const fp = app.om.om.job.filePosition;
		const liveIndex = fp === null ? -1 : findSegmentIndex(toolpath.byteOffset, fp);
		const hue = computeHueColors(toolpath, colorMode());
		const alpha = computeSegmentAlpha(toolpath.segmentCount, toolpath.layerIndex, liveIndex, revealMode());
		scene.updateColors(combineRGBA(hue, alpha));
	};

	const load = async (path: string): Promise<void> => {
		const gen = ++generation;
		setStatus("loading");
		setMessage("");
		toolpath = null;
		try {
			const [text, sceneMod] = await Promise.all([app.connector.download(path), import("./scene.ts")]);
			if (gen !== generation) return;
			scene ??= sceneMod.createScene(canvasEl, hostEl.clientWidth, hostEl.clientHeight);

			worker?.terminate();
			worker = new Worker(new URL("./parseGcode.worker.ts", import.meta.url), { type: "module" });
			worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
				if (gen !== generation) return;
				const res = event.data;
				if (!res.ok) {
					setMessage(res.error);
					setStatus("error");
					return;
				}
				toolpath = res.toolpath;
				const widths = computeSegmentWidths(
					toolpath.positions, toolpath.deltaE, toolpath.extruding,
					toolpath.layerIndex, toolpath.layerHeights, filamentDiameter(),
				);
				const hue = computeHueColors(toolpath, colorMode());
				const alpha = computeSegmentAlpha(toolpath.segmentCount, toolpath.layerIndex, -1, revealMode());
				scene!.setGeometry(toolpath.positions, combineRGBA(hue, alpha), widths);
				setStatus("ready");
				recolor();
			};
			worker.postMessage(text);
		} catch (err) {
			if (gen !== generation) return;
			setMessage(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	};

	const retry = (): void => {
		const p = lastPath();
		if (p !== null) void load(p);
	};

	createEffect(() => {
		const name = activeFileName();
		if (name === null) {
			setStatus("empty");
			setLastPath(null);
			return;
		}
		if (name !== lastPath()) {
			setLastPath(name);
			void load(name);
		}
	});

	// Live sync: recolor (never re-parse) on every filePosition/mode change.
	createEffect(() => {
		app.om.om.job.filePosition;
		revealMode();
		colorMode();
		recolor();
	});

	// Panels are user-resizable (drag grip, see Panel.tsx) with no resize
	// event of their own — watch the host element directly, same pattern
	// Panel.tsx uses for its own scroll-nub-state tracking.
	onMount(() => {
		const resizeObserver = new ResizeObserver(() => {
			scene?.resize(hostEl.clientWidth, hostEl.clientHeight);
		});
		resizeObserver.observe(hostEl);
		onCleanup(() => resizeObserver.disconnect());
	});

	onCleanup(() => {
		worker?.terminate();
		scene?.destroy();
	});

	return (
		<Card id="gcode-viewer" canvas={props.canvas} ariaLabel="G-code toolpath" title="Toolpath" tip="job.file · job.filePosition">
			<div class="gcode-viewer" ref={hostEl}>
				<div class="gcode-viewer-modes gcode-viewer-modes-color" role="group" aria-label="Color mode">
					<For each={COLOR_MODES}>
						{m => (
							<button
								type="button"
								class="mode-btn"
								classList={{ active: colorMode() === m }}
								disabled={status() === "ready" && !colorModeAvailable(toolpath!, m)}
								onClick={() => setColorMode(m)}
							>
								{COLOR_MODE_LABEL[m]}
							</button>
						)}
					</For>
				</div>
				<div class="gcode-viewer-modes gcode-viewer-modes-reveal" role="group" aria-label="Reveal mode">
					<For each={REVEAL_MODES}>
						{m => (
							<button
								type="button"
								class="mode-btn"
								classList={{ active: revealMode() === m }}
								onClick={() => setRevealMode(m)}
							>
								{REVEAL_MODE_LABEL[m]}
							</button>
						)}
					</For>
				</div>
				<canvas ref={canvasEl} class="gcode-canvas" />
				<Show when={status() === "empty"}><div class="gcode-overlay">No active job</div></Show>
				<Show when={status() === "loading"}><div class="gcode-overlay">Loading toolpath…</div></Show>
				<Show when={status() === "error"}>
					<div class="gcode-overlay err">
						{message()} <button class="link-btn" onClick={retry}>Retry</button>
					</div>
				</Show>
			</div>
		</Card>
	);
}
```

Note on the `disabled={status() === "ready" && !colorModeAvailable(toolpath!, m)}` check:
`toolpath` is a plain `let` variable, not a Solid signal — reading it alone
creates no reactive dependency, so the expression must also read `status()`
(a real signal) to force Solid to re-evaluate `disabled` when a load
completes. By the time `status()` becomes `"ready"`, `toolpath` is always
already assigned (the state machine sets `toolpath = res.toolpath` before
`setStatus("ready")`), so `toolpath!` is safe. Without the `status()` read,
this expression would be computed once at mount (with `toolpath` still
`null`) and never update again — the "Layer time" button would never
actually disable, even when the file has no `M73`/`;LAYER_CHANGE` data.

- [ ] **Step 3: Add CSS for the second mode-toggle row**

Edit `packages/ui/src/app.css`. Find the existing `.gcode-viewer-modes` rule (added when the original gcode viewer shipped) and replace it with:

```css
.gcode-viewer-modes {
	position: absolute; z-index: 1;
	display: flex; gap: 4px;
}
.gcode-viewer-modes-color { top: 8px; left: 8px; }
.gcode-viewer-modes-reveal { top: 8px; right: 8px; }
.gcode-viewer-modes .mode-btn {
	font-size: 11px; padding: 4px 8px; border-radius: var(--radius);
	border: 1px solid var(--hairline); background: var(--mask-700); color: var(--silk-dim);
}
.gcode-viewer-modes .mode-btn.active { color: var(--silk); border-color: var(--copper); }
.gcode-viewer-modes .mode-btn:disabled { opacity: 0.35; cursor: not-allowed; }
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b`
Expected: same 2 known pre-existing errors, nothing new — `scene.ts` and `GcodeViewer.tsx` land in this same task specifically so this is the first point either file's typecheck is verified.

- [ ] **Step 5: Full test suite**

Run: `cd packages/ui && pnpm test`
Expected: all tests pass — the pre-existing suite plus every new test file from Tasks 2, 3, 4, 5, 6.

- [ ] **Step 6: Live verification**

With the mock backend (or a real board, if you've verified you're pointed at Mock — this project's write-guard blocks writes to the real board unless armed, and a prior session accidentally targeted the real printer this way; double-check the backend toggle before starting any print) running a simulated print with a real gcode file, open Activity in the browser. Expected, in order:

1. Toolpath renders with visibly non-1px-wide lines whose thickness varies along the path (thin travel moves, thicker/varying extrusion beads) — confirms `worldUnits`/per-segment width are both working.
2. Default color mode ("Feature") shows visibly different colors for different regions of the print (perimeters vs. infill, etc.) if the file has `;TYPE:` tags; if the mock's bundled gcode has none, every segment should render in the "Unknown" gray rather than erroring.
3. Click "Speed" — colors shift to a blue-to-red gradient reflecting feedrate.
4. Click "Layer time" — if the file has no `M73`/`;LAYER_CHANGE` data (likely, since it's an opt-in slicer setting), this button should be visibly disabled (grayed out, unclickable) rather than silently doing nothing.
5. With Progressive reveal mode: unprinted segments are genuinely see-through (you can see the background/other segments behind them), not just a flat darker color — confirms real alpha, not the old dim-shade scheme.
6. Switch reveal mode to Static — everything goes fully opaque immediately, still colored per the active color mode.
7. Resize the card (drag its resize grip) — the scene fills the new size without distortion, same as the original feature's verified behavior.
8. Check the browser console for shader compile errors — none expected; if any appear, they pinpoint exactly which GLSL edit in Task 7 has a syntax error (check varying declarations match exactly between vertex and fragment shader, a common fork mistake).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/gcode/scene.ts packages/ui/src/gcode/GcodeViewer.tsx packages/ui/src/app.css
git commit -m "feat(ui): wire the forked line material + color-mode UI into the gcode viewer"
```

---

## Self-Review Notes

**Spec coverage:** OM extension (Task 1), all three color modes (Tasks 2, 4, 5), real per-vertex alpha via the forked material (Tasks 6, 7), real per-segment world-space width (Tasks 3, 7, 8), the color-mode/reveal-mode independent-axes UI (Task 8), graceful fallback for missing `;TYPE:`/`M73` data (Tasks 4, 5, and Task 8's disabled-button behavior). File structure matches the spec's "Architecture / file structure" section exactly, including the decision to skip vendoring `Line2.js` (not needed — this app renders disconnected segments via `LineSegments2`, not a connected polyline).

**Placeholder scan:** caught and fixed one during this review — Task 7's `LineSegments2.ts` originally had a broken placeholder value for `_box` (a raycasting helper this app never actually calls, since the toolpath isn't raycast against). Fixed directly to `new Box3()` (with `Box3` imported from `"three"`), matching upstream, rather than left as a "fix this later" note. Also caught and fixed a real Solid reactivity bug in Task 8's original draft — a `disabled` check that read a plain (non-signal) `toolpath` variable would have been evaluated once at mount and never updated, so the "Layer time" button would never actually disable; fixed by also reading `status()` to create a real reactive dependency. Also merged what were originally two separate tasks (`scene.ts` alone, then `GcodeViewer.tsx`) into one Task 8, since the first would have left the typecheck baseline broken until the second landed — violating every other task's own "no new typecheck errors" gate.

**Type consistency:** `ParsedToolpath` (Task 4) is used identically by Task 5 (`hueColors.ts`'s `featureType`/`layerIndex`/`layerTimeMinutes`/`speed` reads) and Task 8 (`GcodeViewer.tsx`'s `computeSegmentWidths` call passing `positions`/`deltaE`/`extruding`/`layerIndex`/`layerHeights`). `SceneHandle.setGeometry`'s 3-argument signature is defined and consumed within the same Task 8, so there's no cross-task drift risk on that interface. `ColorMode`/`RenderMode` string unions are consistent across `hueColors.ts`, `renderModes.ts`, and `GcodeViewer.tsx`'s `COLOR_MODES`/`REVEAL_MODES` arrays. `combineRGBA`'s expected input shapes (6 floats/segment RGB, 2 floats/segment alpha) match exactly what `computeHueColors`/`computeSegmentAlpha` produce.
