# Activity View + Live GCode Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Activity" view that combines the existing Position and Job-progress cards with a new live 3D G-code toolpath viewer, so there's one place to watch a print happen.

**Architecture:** Position and Active-job cards are extracted from Machine.tsx/Jobs.tsx into standalone components reused by both their original view and the new Activity view. The G-code viewer downloads the active job's file once (existing `connector.download()`), parses it in a Web Worker into a flat `Float32Array` toolpath, and renders it with a lazy-loaded Three.js scene (mirroring the existing CodeMirror lazy-load pattern in `src/editor/`). Live sync (marker position, progressive reveal, layer-focus) is driven entirely by the already-polled `job.filePosition` — the file is never re-downloaded or re-parsed for ordinary progress updates, only when the active job's filename changes.

**Tech Stack:** SolidJS + TypeScript, Three.js (new dependency, pre-authorized by CLAUDE.md's "lazy-loaded only if/when gcode/heightmap 3D happens"), Web Worker (Vite's native `new URL(..., import.meta.url)` worker syntax), node:test for unit tests.

## Global Constraints

- Never destructure Solid props — use `props.x` or `splitProps` (CLAUDE.md).
- Use `<Show>`/`<For>`/`<Switch>`, not early returns or `.map` in JSX (CLAUDE.md).
- `three` is the one new dependency this plan adds — pre-approved by CLAUDE.md's stack section for exactly this feature; still install via `pnpm --filter @dwc-ng/ui add three` (frozen-lockfile-respecting, subject to `pnpm-workspace.yaml`'s `minimumReleaseAge: 4320`) rather than hand-editing package.json.
- `tsconfig.app.json`'s `lib` is `["ES2023", "DOM"]` — no `"WebWorker"` lib. Do not add it (it conflicts with `DOM`'s `postMessage`/`self` typings elsewhere in the app). The worker file must type its own `self` via a local cast instead (see Task 8).
- `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- Gcode is ASCII in practice (RepRapFirmware/slicer output never emits multi-byte characters); the parser treats one JS string UTF-16 code unit as one byte offset. This is a deliberate, documented simplifying assumption, not a bug.
- No Solid component-render test infrastructure exists anywhere in this codebase today (no jsdom, no `@solidjs/testing-library` — confirmed by reading `packages/ui/test/`). Every existing view is verified live in the browser, never via a mounted-component unit test. Tasks below follow that same existing pattern for UI-composition work; only pure, DOM-free logic (the parser, the segment-index lookup, the render-mode color computation) gets `node:test` unit tests.
- Run `node ../../node_modules/typescript/bin/tsc -b` and `pnpm test` from `packages/ui` after each task; the pre-existing baseline is 2 known typecheck errors (`writeGuard.ts:48`, `editor/setup.ts:11`) and all tests green — no new errors, no regressions.

---

## Task 1: Route + nav + empty Activity view scaffold

**Files:**
- Modify: `packages/ui/src/shell/router.ts:10` (`ROUTES` array)
- Modify: `packages/ui/src/shell/Shell.tsx:15-22` (`NAV` array), `:122-130` (view `<Switch>`)
- Create: `packages/ui/src/views/activity.panelDefaults.ts`
- Create: `packages/ui/src/views/Activity.tsx`

**Interfaces:**
- Consumes: `createPanelCanvas` (`../shell/panelCanvas.ts`), `PanelCanvas` (`../shell/PanelCanvas.tsx`), `ConsolePanel`/`CameraPanel` (`../shell/ConsolePanel.tsx`/`../shell/CameraPanel.tsx`) — all existing, used exactly as every other view already uses them.
- Produces: the `"activity"` route string, consumed by later tasks (Task 4, Task 10) to know Activity.tsx exists and is reachable.

- [ ] **Step 1: Add the route**

Edit `packages/ui/src/shell/router.ts:10`:

```ts
export const ROUTES = ["machine", "control", "jobs", "macros", "system", "settings", "activity"] as const;
```

- [ ] **Step 2: Create the panel defaults (console + camera only for now)**

Create `packages/ui/src/views/activity.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const ACTIVITY_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "console", col: 0, row: 0, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 10, colSpan: 8, rowSpan: 10 },
];
```

(Task 4 adds `position`/`job` entries; Task 10 adds `gcode-viewer`. Keeping this
step's defaults minimal means this task's deliverable — the view exists and
routes correctly — doesn't depend on later tasks' card extractions.)

- [ ] **Step 3: Create the empty Activity view**

Create `packages/ui/src/views/Activity.tsx`:

```tsx
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { ACTIVITY_PANEL_DEFAULTS } from "./activity.panelDefaults.ts";

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS);

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
```

- [ ] **Step 4: Wire the nav entry and route match**

Edit `packages/ui/src/shell/Shell.tsx`. Add the import near the other view imports (after `Settings`):

```ts
import Activity from "../views/Activity.tsx";
```

Add to the `NAV` array (`Shell.tsx:15-22`):

```ts
const NAV: Array<{ route: Route; label: string }> = [
	{ route: "machine", label: "Machine" },
	{ route: "control", label: "Control" },
	{ route: "jobs", label: "Jobs" },
	{ route: "macros", label: "Macros" },
	{ route: "system", label: "System" },
	{ route: "settings", label: "Settings" },
	{ route: "activity", label: "Activity" },
];
```

Add to the view `<Switch>` (`Shell.tsx:122-130`), after the `"settings"` match:

```tsx
<Match when={route() === "settings"}><Settings /></Match>
<Match when={route() === "activity"}><Activity /></Match>
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b`
Expected: only the 2 known pre-existing errors (`writeGuard.ts:48`, `editor/setup.ts:11`), nothing new.

- [ ] **Step 6: Live verification**

Start the dev server (`pnpm dev` from `packages/ui`, mock backend), open the app in a
browser, click "Activity" in the nav. Expected: the view loads with just a
Console and (if pinned) Camera panel, no console errors, `#/activity` in the
URL, and clicking between Activity and the other 6 nav items works both ways.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/shell/router.ts packages/ui/src/shell/Shell.tsx packages/ui/src/views/activity.panelDefaults.ts packages/ui/src/views/Activity.tsx
git commit -m "feat(ui): add empty Activity view + nav route"
```

---

## Task 2: Extract PositionCard component

**Files:**
- Create: `packages/ui/src/cards/PositionCard.tsx`
- Modify: `packages/ui/src/views/Machine.tsx:60-109` (replace inline Position card with the import)

**Interfaces:**
- Consumes: `Card` (`../shell/Card.tsx`), `PanelCanvasController` (`../shell/panelCanvas.ts`), `useApp` (`../shell/context.ts`), `Axis` (`../om/types.ts`) — all existing.
- Produces: `PositionCard(props: { canvas: PanelCanvasController })` — a component rendering the `id="position"` card, importable by both `Machine.tsx` (Task 2) and `Activity.tsx` (Task 4).

- [ ] **Step 1: Create the extracted component**

Create `packages/ui/src/cards/PositionCard.tsx` — this is `Machine.tsx`'s existing
Position card (lines 60-109 today) moved verbatim into its own component, reading
`visibleAxes`/`axis.homed`/etc. directly off `useApp()` instead of receiving them
as props (no behavior change — `Machine.tsx` computed these purely from
`app.om.om.move.axes`, which `PositionCard` can read itself):

```tsx
import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

/** The 7-axis DRO card — used on Machine and Activity. */
export function PositionCard(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));

	return (
		<Card id="position" canvas={props.canvas} ariaLabel="Position" title="Position" tip="move.axes" orientationToggle>
			<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
				<Show
					when={props.canvas.orientationFor("position") === "horizontal"}
					fallback={
						<For each={visibleAxes()}>
							{axis => (
								<div class="dro-row" classList={{ unhomed: !axis.homed }}>
									<span class="dro-axis">
										{axis.letter}
										<Show when={app.config.config.axisRoles[axis.letter]}>
											{role => <span class="dro-role">{role()}</span>}
										</Show>
									</span>
									<span class="dro-val">
										{(axis.machinePosition ?? 0).toFixed(2)}<small>mm</small>
									</span>
									<span class="homed-tag" classList={{ yes: axis.homed, no: !axis.homed }}>
										{axis.homed ? "homed" : "unhomed"}
									</span>
								</div>
							)}
						</For>
					}
				>
					<div class="dro-h-row">
						<For each={visibleAxes()}>
							{axis => (
								<div class="dro-h-cell" classList={{ unhomed: !axis.homed }}>
									<span class="dro-h-axis">
										{axis.letter}
										<Show when={app.config.config.axisRoles[axis.letter]}>
											{role => <span class="dro-role">{role()}</span>}
										</Show>
									</span>
									<span class="dro-h-val">
										{(axis.machinePosition ?? 0).toFixed(2)}<small>mm</small>
									</span>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Show>
		</Card>
	);
}
```

- [ ] **Step 2: Use it from Machine.tsx**

Edit `packages/ui/src/views/Machine.tsx`. Add the import:

```ts
import { PositionCard } from "../cards/PositionCard.tsx";
```

Replace the whole Position `<Card id="position" ...>...</Card>` block
(`Machine.tsx:65-109`) with:

```tsx
<PositionCard canvas={canvas} />
```

`visibleAxes` (currently `Machine.tsx:21`) stays in `Machine.tsx` only if
something else in that file still reads it — check with a search; if the
Position card was its only consumer, remove the now-unused memo (`noUnusedLocals`
in `tsconfig.app.json` will fail the typecheck otherwise, which is the
verification for this).

- [ ] **Step 3: Typecheck and existing tests**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b && pnpm test`
Expected: same 2 known pre-existing errors, no new ones; all tests still pass
(this is a pure refactor — no test file references Position-card internals
directly, so a green suite here is the regression check).

- [ ] **Step 4: Live verification**

Reload Machine in the browser. Expected: Position card renders identically —
same 7 axes, same horizontal/vertical toggle behavior, same values — as
before the extraction.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/cards/PositionCard.tsx packages/ui/src/views/Machine.tsx
git commit -m "refactor(ui): extract PositionCard for reuse on Activity"
```

---

## Task 3: Extract ActiveJobCard component

**Files:**
- Create: `packages/ui/src/cards/ActiveJobCard.tsx`
- Modify: `packages/ui/src/views/Jobs.tsx:98-148` (replace inline Active-job card with the import)

**Interfaces:**
- Consumes: `Card` (`../shell/Card.tsx`), `PanelCanvasController`, `useApp` — same as Task 2.
- Produces: `ActiveJobCard(props: { canvas: PanelCanvasController })` — renders the
  `id="active-job"` card (including its own `<Show when={isActive}>` gate — see
  Step 1), importable by `Jobs.tsx` and `Activity.tsx` (Task 4).

- [ ] **Step 1: Create the extracted component**

Create `packages/ui/src/cards/ActiveJobCard.tsx` — `Jobs.tsx`'s existing
`isActive`/`jobFile`/`progress` memos (today at `Jobs.tsx:80-90`) and the
`<Show when={isActive()}><Card id="active-job">...` block (today at
`Jobs.tsx:103-148`) move together into this component, since the Active-job
card's visibility gate is intrinsic to what it displays, not something a
parent view should have to duplicate:

```tsx
import { Show, Switch, Match, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

/** RRF statuses where a job is on the machine and controllable. */
const ACTIVE_STATUSES = new Set(["processing", "paused", "pausing", "resuming", "cancelling", "simulating"]);

/** The active-print progress card — used on Jobs and Activity. Renders
 *  nothing when no job is active (Jobs.tsx's panelCanvas isActive callback
 *  for "active-job" should key off the same condition — see callers). */
export function ActiveJobCard(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	const job = () => app.om.om.job;
	const jobFile = createMemo(() => {
		const f = job().file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f : null;
	});
	const isActive = createMemo(() => ACTIVE_STATUSES.has(app.om.om.state.status) || jobFile() !== null);
	const progress = createMemo(() => {
		const j = job();
		const f = jobFile();
		if (f === null || j.filePosition === null || f.size === 0) return null;
		return Math.min(100, (j.filePosition / f.size) * 100);
	});

	return (
		<Show when={isActive()}>
			<Card id="active-job" canvas={props.canvas} ariaLabel="Active job" class="job-active" title="Printing" tip="job · state">
				<Show when={jobFile()} fallback={<p class="job-empty">{app.om.om.state.status}…</p>}>
					{file => (
						<>
							<div class="job-active-head">
								<span class="fname">{baseName(file().fileName)}</span>
								<span class={`chip chip-${app.om.om.state.status === "paused" ? "warn" : "busy"}`}>
									<span class="dot" />{app.om.om.state.status}
								</span>
							</div>
							<Show when={progress() !== null}>
								<div class="progress" role="progressbar" aria-valuenow={Math.round(progress()!)}>
									<div class="progress-fill" style={{ width: `${progress()!}%` }} />
									<span class="progress-label">{progress()!.toFixed(1)}%</span>
								</div>
							</Show>
							<div class="job-facts">
								<Show when={job().layer !== null}>
									<Fact label="Layer">{job().layer} / {file().numLayers}</Fact>
								</Show>
								<Show when={job().duration !== null}>
									<Fact label="Elapsed">{fmtDuration(job().duration!)}</Fact>
								</Show>
								<Show when={job().timesLeft.file !== null}>
									<Fact label="Remaining">{fmtDuration(job().timesLeft.file!)}</Fact>
								</Show>
							</div>
							<div class="btn-row">
								<Switch>
									<Match when={app.om.om.state.status === "paused"}>
										<button class="btn job-toggle" onClick={() => void app.connector.sendCode("M24")}>Resume</button>
									</Match>
									<Match when={true}>
										<button class="btn job-toggle" onClick={() => void app.connector.sendCode("M25")}>Pause</button>
									</Match>
								</Switch>
								<button class="btn btn-danger" onClick={() => void app.connector.sendCode("M0")}>Cancel</button>
							</div>
						</>
					)}
				</Show>
			</Card>
		</Show>
	);
}

function Fact(props: { label: string; children: unknown }) {
	return (
		<span class="fact"><span class="fact-label">{props.label}</span><span class="fact-val">{props.children as never}</span></span>
	);
}

function baseName(path: string | null | undefined): string {
	if (!path) return "";
	const i = path.lastIndexOf("/");
	return i >= 0 ? path.slice(i + 1) : path;
}

function fmtDuration(seconds: number): string {
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s % 60}s`;
	return `${s}s`;
}
```

Note: `isActive` is exported implicitly only via the card's own visibility —
`Jobs.tsx`'s `createPanelCanvas(..., id => id === "active-job" ? isActive() : ...)`
callback (its `isActive`, currently local to `Jobs.tsx`) still needs its own
copy of the same "is a job active" logic for the *collision system* (a
not-currently-rendered panel must still be excluded from collision checks —
see `panelCanvas.ts`'s `isActive` param doc). Step 2 keeps that local
`isActive`/`jobFile` pair in `Jobs.tsx` for exactly that purpose; it's
intentionally the same predicate duplicated in two places for two different
reasons (one drives what renders, the other drives what collides), not a
DRY violation worth engineering around for two three-line memos.

- [ ] **Step 2: Use it from Jobs.tsx**

Edit `packages/ui/src/views/Jobs.tsx`. Add the import:

```ts
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
```

Replace the whole `<Show when={isActive()}><Card id="active-job" ...>...</Show>`
block (`Jobs.tsx:103-148`) with:

```tsx
<ActiveJobCard canvas={canvas} />
```

Keep `Jobs.tsx`'s own `jobFile`/`isActive` memos (`Jobs.tsx:80-84`) — they're
still used by the `createPanelCanvas(..., id => ...)` collision callback
(`Jobs.tsx:25-29`) and by `startPrint`'s disabled-state check
(`Jobs.tsx:220`). Remove `progress` (`Jobs.tsx:85-90`) if nothing in
`Jobs.tsx` reads it anymore after the card body moves out — the typecheck in
Step 3 (`noUnusedLocals`) is the check.

- [ ] **Step 3: Typecheck and existing tests**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b && pnpm test`
Expected: same 2 known pre-existing errors, no new ones; all tests pass.

- [ ] **Step 4: Live verification**

With the mock backend running a simulated print (or any scenario where
`state.status` is `processing`), reload Jobs in the browser. Expected: the
"Printing" card renders identically to before — filename, progress bar,
layer/elapsed/remaining facts, Pause/Cancel buttons all present and working.
Also confirm it still disappears when idle (no active job).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/cards/ActiveJobCard.tsx packages/ui/src/views/Jobs.tsx
git commit -m "refactor(ui): extract ActiveJobCard for reuse on Activity"
```

---

## Task 4: Wire Position + Active-job cards into Activity

**Files:**
- Modify: `packages/ui/src/views/Activity.tsx` (add the two cards)
- Modify: `packages/ui/src/views/activity.panelDefaults.ts` (add their panel rects)

**Interfaces:**
- Consumes: `PositionCard` (Task 2), `ActiveJobCard` (Task 3).

- [ ] **Step 1: Add panel defaults for the two cards**

Edit `packages/ui/src/views/activity.panelDefaults.ts` — insert `position` and
`job` (note: `ActiveJobCard` renders a `Card id="active-job"`, so the id here
must be `"active-job"`, not `"job"`, matching the actual rendered card):

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const ACTIVITY_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "active-job", col: 12, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "console", col: 0, row: 15, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 25, colSpan: 8, rowSpan: 10 },
];
```

- [ ] **Step 2: Render them in Activity.tsx**

Edit `packages/ui/src/views/Activity.tsx`:

```tsx
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { PositionCard } from "../cards/PositionCard.tsx";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
import { ACTIVITY_PANEL_DEFAULTS } from "./activity.panelDefaults.ts";

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS);

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<PositionCard canvas={canvas} />
				<ActiveJobCard canvas={canvas} />
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b`
Expected: same 2 known pre-existing errors, nothing new.

- [ ] **Step 4: Live verification**

Reload Activity in the browser with a job active on the mock backend.
Expected: Position and Printing cards both render with live data, independent
drag/resize/orientation-toggle state from Machine's and Jobs' own copies
(move one on Activity, confirm Machine's Position panel is unaffected), and
the Active-job card disappears when the mock goes idle.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/views/Activity.tsx packages/ui/src/views/activity.panelDefaults.ts
git commit -m "feat(ui): show Position + Active-job cards on Activity"
```

---

## Task 5: G-code parser (`parseGcode.ts`)

**Files:**
- Create: `packages/ui/src/gcode/parseGcode.ts`
- Test: `packages/ui/test/parse-gcode.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ParsedToolpath {
      /** [x0,y0,z0, x1,y1,z1, ...] — 2 vertices (6 floats) per segment, laid
       *  out for THREE.LineSegments (each consecutive pair is one segment,
       *  segments are not connected to each other). */
      positions: Float32Array;
      /** One entry per segment: which layer it belongs to. */
      layerIndex: Uint16Array;
      /** One entry per segment: cumulative source byte offset through the
       *  end of the line that produced it. Monotonically non-decreasing. */
      byteOffset: Float64Array;
      /** One entry per segment: 1 if extruding (E increased), 0 if travel. */
      extruding: Uint8Array;
      segmentCount: number;
      layerCount: number;
  }
  export function parseGcode(text: string): ParsedToolpath;
  ```
  Consumed by Task 6 (`findSegmentIndex`, reads `byteOffset`), Task 7
  (`computeSegmentColors`, reads `layerIndex`/`segmentCount`), Task 8 (the
  Worker wraps this function directly).

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/parse-gcode.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGcode } from "../src/gcode/parseGcode.ts";

test("parses linear G1 moves into one segment per move", () => {
	const gcode = "G1 X10 Y0 Z0.2 E1\nG1 X10 Y10 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.segmentCount, 2);
	assert.equal(result.positions.length, 2 * 6);
	// segment 0: (0,0,0) -> (10,0,0.2)
	assert.deepEqual(Array.from(result.positions.slice(0, 6)), [0, 0, 0, 10, 0, 0.2]);
	// segment 1: (10,0,0.2) -> (10,10,0.2)
	assert.deepEqual(Array.from(result.positions.slice(6, 12)), [10, 0, 0.2, 10, 10, 0.2]);
});

test("marks moves with increasing E as extruding, others as travel", () => {
	const gcode = "G0 X5 Y5\nG1 X10 Y10 E1\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.extruding), [0, 1]);
});

test("increments layer on a Z change between extruding moves, ignores travel-only Z hops", () => {
	const gcode = [
		"G1 X0 Y0 Z0.2 E1",   // layer 0 (first extrude sets the baseline, no increment)
		"G0 Z5",              // travel Z hop — must NOT bump the layer
		"G0 Z0.2",            // travel back down — must NOT bump the layer
		"G1 X10 Y0 E2",       // still layer 0 (same Z as the last extrude)
		"G1 X10 Y0 Z0.4 E3",  // layer 1 (new Z on an extruding move)
	].join("\n");
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.layerIndex), [0, 0, 0, 0, 1]);
	assert.equal(result.layerCount, 2);
});

test("treats G2/G3 arcs as a chord to their endpoint, ignoring I/J", () => {
	const gcode = "G1 X0 Y0 E1\nG2 X10 Y0 I5 J5 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.segmentCount, 2);
	assert.deepEqual(Array.from(result.positions.slice(6, 12)), [0, 0, 0, 10, 0, 0]);
});

test("respects G91 relative positioning and M83 relative extrusion", () => {
	const gcode = "G91\nM83\nG1 X10 Y0 E1\nG1 X0 Y10 E1\n";
	const result = parseGcode(gcode);
	assert.deepEqual(Array.from(result.positions.slice(0, 6)), [0, 0, 0, 10, 0, 0]);
	assert.deepEqual(Array.from(result.positions.slice(6, 12)), [10, 0, 0, 10, 10, 0]);
	assert.deepEqual(Array.from(result.extruding), [1, 1]);
});

test("byteOffset is monotonically non-decreasing and tracks cumulative line length", () => {
	const gcode = "G1 X1 E1\nG1 X2 E2\nG1 X3 E3\n";
	const result = parseGcode(gcode);
	for (let i = 1; i < result.byteOffset.length; i++) {
		assert.ok(result.byteOffset[i]! >= result.byteOffset[i - 1]!);
	}
	assert.equal(result.byteOffset[0], "G1 X1 E1".length + 1);
});

test("strips ; and (...) comments without producing segments for comment-only lines", () => {
	const gcode = "; header comment\nG1 X10 E1 ; move to 10\n(a paren comment)\nG1 X20 E2\n";
	const result = parseGcode(gcode);
	assert.equal(result.segmentCount, 2);
});

test("empty input produces an empty, valid toolpath", () => {
	const result = parseGcode("");
	assert.equal(result.segmentCount, 0);
	assert.equal(result.layerCount, 0);
	assert.equal(result.positions.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && node --test test/parse-gcode.test.ts`
Expected: FAIL — `Cannot find module '../src/gcode/parseGcode.ts'`.

- [ ] **Step 3: Implement the parser**

Create `packages/ui/src/gcode/parseGcode.ts`:

```ts
/**
 * G-code -> flat toolpath, for the Activity view's 3D viewer. Scope is a
 * visual preview, not a verifier: G0/G1 linear moves are parsed exactly;
 * G2/G3 arcs are approximated as a single chord to their endpoint (I/J
 * ignored) rather than tessellated. Gcode is ASCII in practice, so one JS
 * string UTF-16 code unit is treated as one byte for the offsets that map
 * to RRF's job.filePosition (also a byte count).
 */

export interface ParsedToolpath {
	positions: Float32Array;
	layerIndex: Uint16Array;
	byteOffset: Float64Array;
	extruding: Uint8Array;
	segmentCount: number;
	layerCount: number;
}

const CMD_RE = /^([A-Za-z])(\d+)/;
const PARAM_RE = /([XYZE])(-?\d*\.?\d+)/gi;
const MOVE_COMMANDS = new Set(["G0", "G1", "G2", "G3"]);

export function parseGcode(text: string): ParsedToolpath {
	const positions: number[] = [];
	const layerIndex: number[] = [];
	const byteOffset: number[] = [];
	const extruding: number[] = [];

	let x = 0, y = 0, z = 0, e = 0;
	let absolute = true;
	let eAbsolute = true;
	let currentLayer = 0;
	let lastExtrudeZ: number | null = null;
	let offset = 0;

	const lines = text.split("\n");
	for (const rawLine of lines) {
		offset += rawLine.length + 1; // +1 for the \n this split consumed

		const line = rawLine.replace(/;.*$/, "").replace(/\([^)]*\)/g, "").trim();
		if (line === "") continue;

		const cmdMatch = CMD_RE.exec(line);
		if (!cmdMatch) continue;
		const cmd = `${cmdMatch[1]!.toUpperCase()}${Number(cmdMatch[2])}`;

		if (cmd === "G90") { absolute = true; continue; }
		if (cmd === "G91") { absolute = false; continue; }
		if (cmd === "M82") { eAbsolute = true; continue; }
		if (cmd === "M83") { eAbsolute = false; continue; }
		if (!MOVE_COMMANDS.has(cmd)) continue;

		const params: Record<string, number> = {};
		PARAM_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = PARAM_RE.exec(line)) !== null) {
			params[m[1]!.toUpperCase()] = Number(m[2]);
		}

		const newX = params.X !== undefined ? (absolute ? params.X : x + params.X) : x;
		const newY = params.Y !== undefined ? (absolute ? params.Y : y + params.Y) : y;
		const newZ = params.Z !== undefined ? (absolute ? params.Z : z + params.Z) : z;
		const newE = params.E !== undefined ? (eAbsolute ? params.E : e + params.E) : e;
		const isExtruding = newE > e;

		positions.push(x, y, z, newX, newY, newZ);
		extruding.push(isExtruding ? 1 : 0);
		byteOffset.push(offset);

		if (isExtruding) {
			if (lastExtrudeZ !== null && newZ !== lastExtrudeZ) currentLayer += 1;
			lastExtrudeZ = newZ;
		}
		layerIndex.push(currentLayer);

		x = newX; y = newY; z = newZ; e = newE;
	}

	return {
		positions: new Float32Array(positions),
		layerIndex: new Uint16Array(layerIndex),
		byteOffset: new Float64Array(byteOffset),
		extruding: new Uint8Array(extruding),
		segmentCount: layerIndex.length,
		layerCount: layerIndex.length > 0 ? currentLayer + 1 : 0,
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/parse-gcode.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/parseGcode.ts packages/ui/test/parse-gcode.test.ts
git commit -m "feat(ui): add gcode toolpath parser for the Activity viewer"
```

---

## Task 6: Live-position lookup (`findSegmentIndex.ts`)

**Files:**
- Create: `packages/ui/src/gcode/findSegmentIndex.ts`
- Test: `packages/ui/test/find-segment-index.test.ts`

**Interfaces:**
- Consumes: nothing beyond a plain `Float64Array` (doesn't import `parseGcode.ts`
  — kept independent so it's testable with hand-built arrays).
- Produces: `findSegmentIndex(byteOffset: Float64Array, filePosition: number): number`
  — consumed by Task 10 (`GcodeViewer.tsx`) with a `ParsedToolpath`'s
  `byteOffset` and the live `job.filePosition`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/find-segment-index.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSegmentIndex } from "../src/gcode/findSegmentIndex.ts";

test("returns -1 for an empty toolpath", () => {
	assert.equal(findSegmentIndex(new Float64Array([]), 100), -1);
});

test("returns -1 when filePosition is before the first segment", () => {
	assert.equal(findSegmentIndex(new Float64Array([10, 20, 30]), 5), -1);
});

test("returns the last segment whose offset is <= filePosition", () => {
	const offsets = new Float64Array([10, 20, 30, 40]);
	assert.equal(findSegmentIndex(offsets, 25), 1);
	assert.equal(findSegmentIndex(offsets, 20), 1);
	assert.equal(findSegmentIndex(offsets, 39), 2);
});

test("returns the last index when filePosition is past the end", () => {
	const offsets = new Float64Array([10, 20, 30]);
	assert.equal(findSegmentIndex(offsets, 1000), 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && node --test test/find-segment-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ui/src/gcode/findSegmentIndex.ts`:

```ts
/**
 * Binary search for the live playback position: the last segment whose
 * (monotonically non-decreasing) byte offset is <= filePosition. Everything
 * at or before this index is "already printed"; -1 means nothing has
 * printed yet (filePosition is before the first segment).
 */
export function findSegmentIndex(byteOffset: Float64Array, filePosition: number): number {
	let lo = 0;
	let hi = byteOffset.length - 1;
	let result = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (byteOffset[mid]! <= filePosition) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/find-segment-index.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/findSegmentIndex.ts packages/ui/test/find-segment-index.test.ts
git commit -m "feat(ui): add live-position segment lookup for the gcode viewer"
```

---

## Task 7: Render-mode color computation (`renderModes.ts`)

**Files:**
- Create: `packages/ui/src/gcode/renderModes.ts`
- Test: `packages/ui/test/render-modes.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain arrays (no `parseGcode.ts`/`findSegmentIndex.ts`
  import — testable standalone).
- Produces:
  ```ts
  export type RenderMode = "progressive" | "static" | "layer-focus";
  export function computeSegmentColors(
      segmentCount: number,
      layerIndex: Uint16Array,
      liveSegmentIndex: number,
      mode: RenderMode,
  ): Float32Array;
  ```
  Consumed by Task 10 (`GcodeViewer.tsx`), which feeds the result to Task 9's
  `SceneHandle.setGeometry`/`updateColors`.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/render-modes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSegmentColors } from "../src/gcode/renderModes.ts";

const BRIGHT = [0.85, 0.55, 0.25];
const DIM = [0.18, 0.2, 0.24];

test("static mode: every segment is bright regardless of live index", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1]);
	const colors = computeSegmentColors(4, layerIndex, -1, "static");
	for (let seg = 0; seg < 4; seg++) {
		assert.deepEqual(Array.from(colors.slice(seg * 6, seg * 6 + 3)), BRIGHT);
	}
});

test("progressive mode: segments up to and including liveSegmentIndex are bright, rest dim", () => {
	const layerIndex = new Uint16Array([0, 0, 0, 0]);
	const colors = computeSegmentColors(4, layerIndex, 1, "progressive");
	assert.deepEqual(Array.from(colors.slice(0, 3)), BRIGHT);   // segment 0
	assert.deepEqual(Array.from(colors.slice(6, 9)), BRIGHT);   // segment 1 (== liveSegmentIndex)
	assert.deepEqual(Array.from(colors.slice(12, 15)), DIM);    // segment 2
	assert.deepEqual(Array.from(colors.slice(18, 21)), DIM);    // segment 3
});

test("progressive mode with liveSegmentIndex -1: everything dim (nothing printed yet)", () => {
	const layerIndex = new Uint16Array([0, 0]);
	const colors = computeSegmentColors(2, layerIndex, -1, "progressive");
	assert.deepEqual(Array.from(colors.slice(0, 3)), DIM);
	assert.deepEqual(Array.from(colors.slice(6, 9)), DIM);
});

test("layer-focus mode: only segments sharing the live segment's layer are bright", () => {
	const layerIndex = new Uint16Array([0, 0, 1, 1, 2]);
	const colors = computeSegmentColors(5, layerIndex, 2, "layer-focus"); // liveSegmentIndex=2 -> layer 1
	assert.deepEqual(Array.from(colors.slice(0, 3)), DIM);    // layer 0
	assert.deepEqual(Array.from(colors.slice(6, 9)), DIM);    // layer 0
	assert.deepEqual(Array.from(colors.slice(12, 15)), BRIGHT); // layer 1
	assert.deepEqual(Array.from(colors.slice(18, 21)), BRIGHT); // layer 1
	assert.deepEqual(Array.from(colors.slice(24, 27)), DIM);  // layer 2
});

test("each segment's two vertices share the same color", () => {
	const layerIndex = new Uint16Array([0, 1]);
	const colors = computeSegmentColors(2, layerIndex, 0, "progressive");
	assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(colors.slice(3, 6)));
	assert.deepEqual(Array.from(colors.slice(6, 9)), Array.from(colors.slice(9, 12)));
});

test("returned array length is segmentCount * 6 (2 vertices * 3 channels)", () => {
	const colors = computeSegmentColors(3, new Uint16Array([0, 0, 0]), -1, "static");
	assert.equal(colors.length, 18);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && node --test test/render-modes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/ui/src/gcode/renderModes.ts`:

```ts
/**
 * Per-mode vertex-color computation for the toolpath LineSegments mesh.
 * "Dim" is a darker shade rather than alpha transparency — avoids
 * transparent-material depth-sorting complexity for what's a preview, not a
 * physically-accurate render. Recomputing colors is O(segmentCount) and
 * runs on every live filePosition tick; it never touches geometry/position
 * data, only the color attribute (see scene.ts's updateColors).
 */

export type RenderMode = "progressive" | "static" | "layer-focus";

const BRIGHT: readonly [number, number, number] = [0.85, 0.55, 0.25];
const DIM: readonly [number, number, number] = [0.18, 0.2, 0.24];

export function computeSegmentColors(
	segmentCount: number,
	layerIndex: Uint16Array,
	liveSegmentIndex: number,
	mode: RenderMode,
): Float32Array {
	const colors = new Float32Array(segmentCount * 6);
	const liveLayer = liveSegmentIndex >= 0 && liveSegmentIndex < layerIndex.length
		? layerIndex[liveSegmentIndex]!
		: -1;

	for (let i = 0; i < segmentCount; i++) {
		let bright: boolean;
		if (mode === "static") bright = true;
		else if (mode === "layer-focus") bright = layerIndex[i] === liveLayer;
		else bright = i <= liveSegmentIndex; // progressive

		const [r, g, b] = bright ? BRIGHT : DIM;
		const base = i * 6;
		colors[base] = r; colors[base + 1] = g; colors[base + 2] = b;
		colors[base + 3] = r; colors[base + 4] = g; colors[base + 5] = b;
	}
	return colors;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/ui && node --test test/render-modes.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/gcode/renderModes.ts packages/ui/test/render-modes.test.ts
git commit -m "feat(ui): add per-mode color computation for the gcode viewer"
```

---

## Task 8: Parse worker (`parseGcode.worker.ts`)

**Files:**
- Create: `packages/ui/src/gcode/parseGcode.worker.ts`

**Interfaces:**
- Consumes: `parseGcode`, `type ParsedToolpath` (`./parseGcode.ts`, Task 5).
- Produces:
  ```ts
  export type WorkerResponse =
      | { ok: true; toolpath: ParsedToolpath }
      | { ok: false; error: string };
  ```
  Consumed by Task 10 (`GcodeViewer.tsx`), which constructs this file as a
  `new Worker(new URL("./parseGcode.worker.ts", import.meta.url), { type: "module" })`
  and reads `event.data` as `WorkerResponse`.

This file has no automated test: it's a thin transport wrapper (message in,
`parseGcode` call, message out) around already-unit-tested logic (Task 5),
and it only runs inside a real browser Worker context that `node:test`
doesn't provide — the same carve-out this codebase already uses for
browser-only glue (see Global Constraints). It's verified live as part of
Task 10's live-verification step.

- [ ] **Step 1: Implement**

Create `packages/ui/src/gcode/parseGcode.worker.ts`:

```ts
/**
 * Worker entry point: receives raw gcode text, parses it off the main
 * thread, and posts back the result via transferable buffers (not
 * structured-cloned copies). tsconfig.app.json's lib is ["ES2023", "DOM"]
 * (no "WebWorker") because mixing WebWorker and DOM libs in one program
 * conflicts elsewhere in the app — so `self` is typed here via a local
 * cast instead of the ambient WebWorker globals.
 */
import { parseGcode, type ParsedToolpath } from "./parseGcode.ts";

export type WorkerResponse =
	| { ok: true; toolpath: ParsedToolpath }
	| { ok: false; error: string };

interface WorkerSelf {
	onmessage: ((event: MessageEvent<string>) => void) | null;
	postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}

const ctx = self as unknown as WorkerSelf;

ctx.onmessage = (event: MessageEvent<string>) => {
	try {
		const toolpath = parseGcode(event.data);
		const transfer: Transferable[] = [
			toolpath.positions.buffer,
			toolpath.layerIndex.buffer,
			toolpath.byteOffset.buffer,
			toolpath.extruding.buffer,
		];
		ctx.postMessage({ ok: true, toolpath }, transfer);
	} catch (err) {
		ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }, []);
	}
};
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b`
Expected: same 2 known pre-existing errors, nothing new. (This file compiles
standalone with the existing `DOM` lib — `MessageEvent`/`Transferable` are
DOM-global types already available; only `self`'s own type needed the cast.)

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/gcode/parseGcode.worker.ts
git commit -m "feat(ui): add gcode parse worker"
```

---

## Task 9: Three.js scene (`scene.ts`)

**Files:**
- Modify: `packages/ui/package.json` (add `three` dependency)
- Create: `packages/ui/src/gcode/scene.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SceneHandle {
      setGeometry(positions: Float32Array, colors: Float32Array): void;
      updateColors(colors: Float32Array): void;
      resize(width: number, height: number): void;
      destroy(): void;
  }
  export function createScene(canvas: HTMLCanvasElement, width: number, height: number): SceneHandle;
  ```
  Consumed by Task 10 (`GcodeViewer.tsx`), imported the same way
  `src/editor/setup.ts` is imported by `FileEditor.tsx` — dynamically
  (`await import("./scene.ts")`), so the Three.js bundle never loads until
  Activity's G-code card actually needs it.

- [ ] **Step 1: Add the dependency**

Run: `cd packages/ui && pnpm add three`
Expected: `three` appears in `packages/ui/package.json`'s `dependencies` and
the root lockfile updates; `onlyBuiltDependencies`/`minimumReleaseAge` in
`pnpm-workspace.yaml` apply automatically (no native build step is expected
for `three`, a pure-JS/WebGL package).

- [ ] **Step 2: Implement the scene module**

Create `packages/ui/src/gcode/scene.ts`:

```ts
/**
 * Three.js wiring for the G-code toolpath. Imported dynamically (see
 * GcodeViewer.tsx) so the whole Three.js bundle stays out of the initial
 * load — it only ships once Activity's G-code card actually mounts, same
 * lazy-load pattern as src/editor/setup.ts for CodeMirror.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface SceneHandle {
	/** (Re)builds the mesh from scratch — called once per parsed file. */
	setGeometry(positions: Float32Array, colors: Float32Array): void;
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

	let mesh: THREE.LineSegments | null = null;
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
		(mesh.material as THREE.Material).dispose();
		mesh = null;
	};

	return {
		setGeometry(positions, colors) {
			disposeMesh();
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
			geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
			const material = new THREE.LineBasicMaterial({ vertexColors: true });
			mesh = new THREE.LineSegments(geometry, material);
			scene.add(mesh);
		},
		updateColors(colors) {
			if (mesh === null) return;
			mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
			renderer.dispose();
		},
	};
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b`
Expected: same 2 known pre-existing errors, nothing new. If TypeScript
reports missing types for `"three"` or `"three/examples/jsm/controls/OrbitControls.js"`,
run `pnpm add -D @types/three` and re-check — modern `three` releases ship
their own types, so this is only needed if the installed version predates
that (confirm which is the case from the typecheck output itself, not
guessed).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json pnpm-lock.yaml packages/ui/src/gcode/scene.ts
git commit -m "feat(ui): add Three.js toolpath scene"
```

---

## Task 10: `GcodeViewer.tsx` + wire into Activity

**Files:**
- Create: `packages/ui/src/gcode/GcodeViewer.tsx`
- Modify: `packages/ui/src/views/Activity.tsx` (add the card)
- Modify: `packages/ui/src/views/activity.panelDefaults.ts` (add its panel rect)
- Modify: `packages/ui/src/app.css` (new classes for the viewer's overlay/mode-toggle chrome)

**Interfaces:**
- Consumes: `parseGcode`'s `ParsedToolpath` type (Task 5, type-only),
  `findSegmentIndex` (Task 6), `computeSegmentColors`/`RenderMode` (Task 7),
  `WorkerResponse` type (Task 8, type-only), `SceneHandle` type + `createScene`
  (Task 9, dynamically imported), `useApp` (`../shell/context.ts`), `Card`
  (`../shell/Card.tsx`).

- [ ] **Step 1: Implement GcodeViewer.tsx**

Create `packages/ui/src/gcode/GcodeViewer.tsx`:

```tsx
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";
import { findSegmentIndex } from "./findSegmentIndex.ts";
import { computeSegmentColors, type RenderMode } from "./renderModes.ts";
import type { ParsedToolpath } from "./parseGcode.ts";
import type { SceneHandle } from "./scene.ts";
import type { WorkerResponse } from "./parseGcode.worker.ts";

type Status = "empty" | "loading" | "ready" | "error";

const MODES: readonly RenderMode[] = ["progressive", "static", "layer-focus"];
const MODE_LABEL: Record<RenderMode, string> = {
	progressive: "Progressive",
	static: "Static",
	"layer-focus": "Layer",
};

/** Live 3D toolpath of the active job — downloaded and parsed once per
 *  file, then only recolored (never re-fetched or re-parsed) as
 *  job.filePosition advances. See docs/superpowers/specs/
 *  2026-07-18-activity-view-gcode-viewer-design.md. */
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
	const [mode, setMode] = createSignal<RenderMode>("progressive");
	const [lastPath, setLastPath] = createSignal<string | null>(null);

	const activeFileName = (): string | null => {
		const f = app.om.om.job.file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f.fileName : null;
	};

	const recolor = (): void => {
		if (toolpath === null || scene === null) return;
		const fp = app.om.om.job.filePosition;
		const liveIndex = fp === null ? -1 : findSegmentIndex(toolpath.byteOffset, fp);
		scene.updateColors(computeSegmentColors(toolpath.segmentCount, toolpath.layerIndex, liveIndex, mode()));
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
				scene!.setGeometry(toolpath.positions, computeSegmentColors(toolpath.segmentCount, toolpath.layerIndex, -1, mode()));
				setStatus("ready");
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
		mode();
		recolor();
	});

	onCleanup(() => {
		worker?.terminate();
		scene?.destroy();
	});

	return (
		<Card id="gcode-viewer" canvas={props.canvas} ariaLabel="G-code toolpath" title="Toolpath" tip="job.file · job.filePosition">
			<div class="gcode-viewer" ref={hostEl}>
				<div class="gcode-viewer-modes" role="group" aria-label="Render mode">
					<For each={MODES}>
						{m => (
							<button
								type="button"
								class="mode-btn"
								classList={{ active: mode() === m }}
								onClick={() => setMode(m)}
							>
								{MODE_LABEL[m]}
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

- [ ] **Step 2: Add CSS**

Add to `packages/ui/src/app.css` (near the other card-specific rules):

```css
.gcode-viewer { position: relative; width: 100%; height: 100%; min-height: 240px; }
.gcode-canvas { display: block; width: 100%; height: 100%; }
.gcode-viewer-modes {
	position: absolute; top: 8px; left: 8px; z-index: 1;
	display: flex; gap: 4px;
}
.gcode-viewer-modes .mode-btn {
	font-size: 11px; padding: 4px 8px; border-radius: var(--radius);
	border: 1px solid var(--hairline); background: var(--mask-700); color: var(--silk-dim);
}
.gcode-viewer-modes .mode-btn.active { color: var(--silk); border-color: var(--copper); }
.gcode-overlay {
	position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
	color: var(--silk-dim); font-size: 13px; text-align: center; padding: 12px;
}
.gcode-overlay.err { color: var(--fault); }
```

- [ ] **Step 3: Add the panel default and wire it into Activity.tsx**

Edit `packages/ui/src/views/activity.panelDefaults.ts` — add `gcode-viewer`,
sized generously since a 3D scene needs real screen space:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

export const ACTIVITY_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "active-job", col: 12, row: 0, colSpan: 12, rowSpan: 15 },
	{ id: "gcode-viewer", col: 0, row: 15, colSpan: 24, rowSpan: 24 },
	{ id: "console", col: 0, row: 39, colSpan: 24, rowSpan: 10 },
	{ id: "camera", col: 0, row: 49, colSpan: 8, rowSpan: 10 },
];
```

Edit `packages/ui/src/views/Activity.tsx`:

```tsx
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { PositionCard } from "../cards/PositionCard.tsx";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
import { GcodeViewer } from "../gcode/GcodeViewer.tsx";
import { ACTIVITY_PANEL_DEFAULTS } from "./activity.panelDefaults.ts";

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS);

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<PositionCard canvas={canvas} />
				<ActiveJobCard canvas={canvas} />
				<GcodeViewer canvas={canvas} />
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/ui && node ../../node_modules/typescript/bin/tsc -b`
Expected: same 2 known pre-existing errors, nothing new.

- [ ] **Step 5: Full test suite**

Run: `cd packages/ui && pnpm test`
Expected: all tests pass — the pre-existing suite plus the 18 new tests from
Tasks 5-7 (8 + 4 + 6).

- [ ] **Step 6: Live verification**

With the mock backend running a simulated print job that has a real gcode
file on `0:/gcodes`, open Activity in the browser. Expected, in order:

1. Before a job starts: the toolpath card shows "No active job", no canvas/scene.
2. Start the mock print: card shows "Loading toolpath…" briefly, then a 3D
   line-rendering of the file's toolpath appears, camera orbitable via
   drag/scroll (OrbitControls).
3. As the mock advances `filePosition`, the "Progressive" mode's already-
   printed segments stay bright while the rest stay dim — confirm this
   updates smoothly on each poll tick, with no visible re-parse/flash
   (Network tab: only ONE `rr_download` for the file, not one per tick).
4. Click "Static" — the whole path goes bright immediately (no re-fetch,
   no reparse — confirm via Network tab again).
5. Click "Layer" — only the current layer's segments are bright.
6. Resize the card (drag its resize grip) — the scene fills the new size
   without distortion (this exercises `scene.resize`, called by the same
   `ResizeObserver` pattern `Panel.tsx` already uses for scroll-nub state —
   if this isn't already wired, add a `ResizeObserver` on `hostEl` inside
   `GcodeViewer`'s `createEffect`/`onMount` that calls `scene?.resize(...)`,
   matching `Panel.tsx`'s existing `resizeObserver.observe(bodyEl)` pattern).
7. Rename/delete the active file mid-print (or otherwise force a download
   failure) — card shows an inline error with a working Retry button, and
   the rest of Activity's cards are unaffected.
8. Reload the whole page mid-print — the card correctly re-downloads and
   re-parses once (this is a fresh mount, not a `filePosition` tick, so a
   fresh download is correct here).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/gcode/GcodeViewer.tsx packages/ui/src/views/Activity.tsx packages/ui/src/views/activity.panelDefaults.ts packages/ui/src/app.css
git commit -m "feat(ui): wire the live gcode toolpath viewer into Activity"
```

---

## Self-Review Notes

**Spec coverage:** Nav+routing (Task 1), reused Position/Job cards (Tasks
2-4), one-time download + Worker parse (Tasks 5, 8), live sync via
`filePosition` never re-fetching (Tasks 6, 10), 3 render modes (Task 7, 10),
Three.js lazy-loaded (Task 9, 10), empty/error states (Task 10), file
structure (matches spec's "File structure" section exactly). One deliberate
deviation from the spec, corrected here: the spec's Testing section
proposed "Activity.tsx gets a thin render test" — the codebase has no
Solid component-render test infrastructure at all (no `@solidjs/testing-library`,
no jsdom; confirmed by reading every file in `packages/ui/test/`), so this
plan verifies view-composition tasks live in-browser instead, consistent
with how every other view in this app has always been verified. Adding a
component-testing framework would itself be a new-dependency decision
outside this spec's scope.

**Placeholder scan:** none — every step has exact file paths, complete code,
and exact commands with expected output.

**Type consistency:** `ParsedToolpath` (Task 5) is used identically by
Task 6 (`byteOffset`), Task 7 (`layerIndex`/`segmentCount`), Task 8 (wraps
the whole object), and Task 10 (`toolpath.positions`/`.byteOffset`/
`.layerIndex`/`.segmentCount`) — no renamed fields across tasks.
`RenderMode`/`computeSegmentColors` (Task 7) signature matches its Task 10
call site exactly (`segmentCount, layerIndex, liveSegmentIndex, mode`).
`SceneHandle`/`createScene` (Task 9) matches Task 10's usage
(`createScene(canvasEl, w, h)`, `.setGeometry`, `.updateColors`, `.destroy`).
`WorkerResponse` (Task 8) matches Task 10's `event.data` handling
(`res.ok` discriminant).
