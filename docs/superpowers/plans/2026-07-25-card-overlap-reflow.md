# Card overlap reflow — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** On load, adopt any card span the composition has grown, then push
displaced neighbours right or down by whichever is fewer grid cells.

**Architecture:** Two pure functions in `shell/panelCanvas.ts`, composed inside
`mergeCanvas` — the sole load-time reconciliation point. Reflow is gated on an
actual growth so the no-redesign path is byte-identical to today.

**Spec:** `docs/superpowers/specs/2026-07-25-card-overlap-reflow-design.md`

## Global constraints

- Pure logic only in `panelCanvas.ts`: no DOM, no Solid, no storage access in
  the new functions (module doc, `panelCanvas.ts:1-12`).
- Distance in **grid cells**, not pixels (spec D2).
- Grow-only adoption, no baseline tracking (spec D1).
- Typecheck with `npx tsc -b --force`. `npx tsc --noEmit` checks ZERO files here.
- Tests: `node:test` + `node:assert/strict`, `.ts` extension imports.
- Never gzip for DSF/SBC. Deploy needs `DWC_BASE=/ng/` + `DWC_TRANSPORT=dsf`.

---

### Task 1: `growToDefaults`

**Files:** Modify `packages/ui/src/shell/panelCanvas.ts`; test
`packages/ui/test/panel-canvas.test.ts`

**Produces:** `growToDefaults(stored: unknown, defaults: PanelDefault[]) ->
{ state: CanvasState; grew: boolean }`

- [ ] **Step 1: Write failing tests**

```ts
test("growToDefaults adopts the larger span per axis and never moves a card", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 103 }];
	const stored = { a: rect(3, 95, 12, 95) };
	const { state, grew } = growToDefaults(stored, defaults);
	assert.deepEqual(state.a, rect(3, 95, 12, 103), "rowSpan grown, col/row untouched");
	assert.equal(grew, true);
});

test("growToDefaults keeps a user-enlarged span and reports no growth", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 12, rowSpan: 40 }];
	const { state, grew } = growToDefaults({ a: rect(0, 0, 24, 90) }, defaults);
	assert.deepEqual(state.a, rect(0, 0, 24, 90), "bigger stored spans win");
	assert.equal(grew, false, "nothing grew, so no reflow may be triggered");
});

test("growToDefaults grows axes independently", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 20, rowSpan: 10 }];
	const { state } = growToDefaults({ a: rect(0, 0, 8, 50) }, defaults);
	assert.deepEqual(state.a, rect(0, 0, 20, 50), "colSpan from default, rowSpan from stored");
});

test("growToDefaults defaults unknown/invalid stored entries and drops stale ids", () => {
	const defaults = [{ id: "a", col: 1, row: 2, colSpan: 4, rowSpan: 4 }, { id: "b", col: 9, row: 0, colSpan: 4, rowSpan: 4 }];
	const { state, grew } = growToDefaults({ a: "junk", ghost: rect(0, 0, 1, 1) }, defaults);
	assert.deepEqual(Object.keys(state).sort(), ["a", "b"]);
	assert.deepEqual(state.a, rect(1, 2, 4, 4));
	assert.equal(grew, false, "falling back to a default is not a growth");
});

test("growToDefaults clamps a span grown past the grid", () => {
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: GRID_COLS, rowSpan: 4 }];
	const { state } = growToDefaults({ a: rect(40, 0, 4, 4) }, defaults);
	assert.equal(state.a!.col + state.a!.colSpan <= GRID_COLS, true, "clampRect pulls col back into bounds");
});
```

- [ ] **Step 2:** `cd packages/ui && node --test test/panel-canvas.test.ts` → FAIL, not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Adopt any span the composition has GROWN since this browser last stored a
 * layout, per axis, without moving anything. Grow-only (spec D1): position and
 * any span the user enlarged past the coded default are kept, so an ordinary
 * load changes nothing.
 *
 * `grew` reports whether any span actually increased — the gate that decides
 * whether a reflow is allowed to run at all. It is false for a card falling
 * back to its coded default (never stored, or stored corrupt): that is
 * placement, not growth, and must not disturb the rest of the canvas.
 */
export function growToDefaults(
	stored: unknown,
	defaults: PanelDefault[],
): { state: CanvasState; grew: boolean } {
	const fallback = defaultCanvas(defaults);
	const record = typeof stored === "object" && stored !== null
		? stored as Record<string, unknown>
		: {};
	const state: CanvasState = {};
	let grew = false;
	for (const d of defaults) {
		const entry = record[d.id];
		if (!isPanelRect(entry)) {
			state[d.id] = fallback[d.id]!;
			continue;
		}
		const coded = fallback[d.id]!;
		const colSpan = Math.max(entry.colSpan, coded.colSpan);
		const rowSpan = Math.max(entry.rowSpan, coded.rowSpan);
		const next = clampRect({ col: entry.col, row: entry.row, colSpan, rowSpan });
		const before = clampRect(entry);
		if (next.colSpan > before.colSpan || next.rowSpan > before.rowSpan) grew = true;
		state[d.id] = next;
	}
	return { state, grew };
}
```

- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5:** commit `feat(canvas): adopt grown card spans on load`.

---

### Task 2: `reflow`

**Files:** Modify `packages/ui/src/shell/panelCanvas.ts`; same test file.

**Consumes:** `CanvasState`, `rectsOverlap`, `GRID_COLS`.
**Produces:** `reflow(state: CanvasState) -> CanvasState`

- [ ] **Step 1: Write failing tests**

```ts
test("reflow pushes a flush neighbour DOWN when down is fewer cells (the 2026-07-24 case)", () => {
	// position grew 95 -> 103; the card below sat flush at row 190.
	// down = (95+103)-190 = 8 cells; right = (0+24)-0 = 24 cells. Down wins.
	const out = reflow({ pos: rect(0, 95, 24, 103), below: rect(0, 190, 24, 40) });
	assert.deepEqual(out.pos, rect(0, 95, 24, 103), "the grown card never moves");
	assert.deepEqual(out.below, rect(0, 198, 24, 40), "pushed down by exactly the penetration");
});

test("reflow pushes a side neighbour RIGHT when right is fewer cells", () => {
	// a grew 8 -> 12 wide; right = (0+12)-8 = 4 cells, down = (0+40)-0 = 40.
	const out = reflow({ a: rect(0, 0, 12, 40), b: rect(8, 0, 6, 40) });
	assert.deepEqual(out.a, rect(0, 0, 12, 40));
	assert.deepEqual(out.b, rect(12, 0, 6, 40), "slid right to a's edge");
});

test("reflow falls back to DOWN when the push right would leave the grid", () => {
	const out = reflow({ a: rect(0, 0, GRID_COLS, 20), b: rect(0, 10, GRID_COLS, 20) });
	assert.deepEqual(out.b, rect(0, 20, GRID_COLS, 20), "no room right of a full-width card");
	assert.equal(hasCollisions(out), false);
});

test("reflow cascades into a third card", () => {
	const out = reflow({ a: rect(0, 0, 24, 60), b: rect(0, 40, 24, 40), c: rect(0, 80, 24, 40) });
	assert.equal(hasCollisions(out), false, "every displacement resolved, not just the first");
	assert.equal(out.b!.row >= 60, true);
	assert.equal(out.c!.row >= out.b!.row + 40 || out.c!.col !== out.b!.col, true);
});

test("reflow leaves an already-clean layout exactly as it found it", () => {
	const clean = { a: rect(0, 0, 24, 40), b: rect(24, 0, 24, 40), c: rect(0, 40, 48, 20) };
	assert.deepEqual(reflow(clean), clean);
});

test("reflow is idempotent and always terminates collision-free", () => {
	const messy = { a: rect(0, 0, 20, 50), b: rect(5, 10, 20, 50), c: rect(10, 20, 20, 50), d: rect(2, 5, 30, 30) };
	const once = reflow(messy);
	assert.equal(hasCollisions(once), false, "RED CHECK: fails loudly if reflow is a no-op");
	assert.deepEqual(reflow(once), once, "running it on its own output changes nothing");
});

test("reflow is deterministic regardless of key insertion order", () => {
	const a = rect(0, 0, 20, 50), b = rect(5, 10, 20, 50), c = rect(10, 20, 20, 50);
	assert.deepEqual(reflow({ a, b, c }), reflow({ c, b, a } as Record<string, typeof a>));
});
```

- [ ] **Step 2:** run → FAIL, not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Resolve every overlap by pushing cards RIGHT or DOWN, never up or left.
 *
 * Cards are placed in reading order (row, then col, then id for determinism),
 * so the topmost-leftmost card never moves and a card that grew keeps its spot
 * while its neighbours yield. The axis is chosen by whichever penetration is
 * fewer GRID CELLS (spec D2) — ties go right, the bounded axis, keeping the
 * layout compact while the unbounded axis stays available.
 *
 * Terminates: each push strictly increases col or row; col is bounded by
 * GRID_COLS and forces the down branch once right no longer fits, and a row
 * below every placed rect is always free. Idempotent: its own output is
 * collision-free, so nothing enters the push loop a second time.
 */
export function reflow(state: CanvasState): CanvasState {
	const order = Object.keys(state).sort((x, y) => {
		const a = state[x]!, b = state[y]!;
		return a.row - b.row || a.col - b.col || (x < y ? -1 : x > y ? 1 : 0);
	});
	const out: CanvasState = {};
	const placed: PanelRect[] = [];
	for (const id of order) {
		let candidate: PanelRect = { ...state[id]! };
		for (;;) {
			const hit = placed.find(p => rectsOverlap(candidate, p));
			if (hit === undefined) break;
			const rightCells = hit.col + hit.colSpan - candidate.col;
			const downCells = hit.row + hit.rowSpan - candidate.row;
			const fitsRight = candidate.col + rightCells + candidate.colSpan <= GRID_COLS;
			candidate = fitsRight && rightCells <= downCells
				? { ...candidate, col: candidate.col + rightCells }
				: { ...candidate, row: candidate.row + downCells };
		}
		out[id] = candidate;
		placed.push(candidate);
	}
	return out;
}
```

- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(canvas): reflow overlapping cards right or down`.

---

### Task 3: Wire into `mergeCanvas` and persist once

**Files:** Modify `packages/ui/src/shell/panelCanvas.ts` (`mergeCanvas`,
`createPanelCanvas` init); same test file.

- [ ] **Step 1: Write failing tests**

```ts
test("mergeCanvas reflows ONLY when a span actually grew", () => {
	const defaults = [
		{ id: "a", col: 0, row: 0, colSpan: 24, rowSpan: 103 },
		{ id: "b", col: 0, row: 95, colSpan: 24, rowSpan: 40 },
	];
	const grown = mergeCanvas({ a: rect(0, 0, 24, 95), b: rect(0, 95, 24, 40) }, defaults);
	assert.deepEqual(grown.a, rect(0, 0, 24, 103), "coded growth adopted");
	assert.deepEqual(grown.b, rect(0, 103, 24, 40), "displaced neighbour pushed down");
	assert.equal(hasCollisions(grown), false);
});

test("mergeCanvas still KEEPS a legal overlap when nothing grew (hidden-card guard)", () => {
	// Same fixture as the audit-residual test: spans match their defaults, so
	// grew is false and the hidden-card overlap must survive untouched.
	const defaults = [{ id: "a", col: 0, row: 0, colSpan: 4, rowSpan: 4 }, { id: "b", col: 10, row: 0, colSpan: 4, rowSpan: 4 }];
	const stored = { a: rect(0, 0, 4, 4), b: rect(1, 1, 4, 4) };
	assert.deepEqual(mergeCanvas(stored, defaults), stored);
});
```

- [ ] **Step 2:** run → FAIL on the first (no reflow yet).

- [ ] **Step 3: Implement.** Replace `mergeCanvas`'s body with a call to
`growToDefaults`, then `return grew ? reflow(state) : state;`. Keep the existing
doc comment and extend it with the gate's rationale. In `createPanelCanvas`,
persist the reconciled layout to storage once at init when it differs from what
was stored, WITHOUT calling `onLayoutChange` (a repair is not a user edit):

```ts
const [state, setState] = createSignal(mergeCanvas(parseStoredCanvas(readStorage(storageKey)), defaults));
// A redesign repair settles once instead of being recomputed every load. Not
// persist(): that fires onLayoutChange -> markLayoutDirty, and a repair is not
// a user edit (nor is a config mutation safe during signal init).
writeStorage(storageKey, serializeCanvas(state()));
```

- [ ] **Step 4:** run the full ui suite → PASS, including the pre-existing
`mergeCanvas KEEPS a stored layout whose rects overlap` test at line 158.

- [ ] **Step 5:** `npx tsc -b --force` from the repo root → clean.
- [ ] **Step 6:** commit `feat(canvas): grow and reflow cards on load`.

---

### Task 4: Ship

- [ ] **Step 1:** full suites — `packages/ui` and `packages/mock-duet`.
- [ ] **Step 2:** build with PowerShell (NOT Bash — MSYS rewrites `/ng/` into
`/Program Files/Git/ng/` and the build still exits 0):
  `$env:DWC_BASE='/ng/'; $env:DWC_TRANSPORT='dsf'; pnpm --filter @dwc-ng/ui build`
- [ ] **Step 3:** verify the emitted `index.html` references `/ng/assets/...`
  by grepping it — exit code 0 is not evidence.
- [ ] **Step 4:** deploy to `http://duet3.nydick.net`, uncompressed (DSF).
- [ ] **Step 5:** verify the SERVED bytes contain the new code, not just that
  the upload reported success.
- [ ] **Step 6:** update `USER_AUDIT.md` line 19 to ✅ with the fix cited;
  commit; push via `gh` credential helper over HTTPS.

## Self-review

- **Spec coverage:** D1 → Task 1. D2 → Task 2. Gate → Task 3. Persistence →
  Task 3 Step 3. Scope (adoptLayout/ensureSlot/resetSlot untouched) → no task
  touches them. All 9 spec tests → Tasks 1-3.
- **Placeholders:** none; every step carries its code or exact command.
- **Type consistency:** `growToDefaults` returns `{ state, grew }` in Task 1 and
  is destructured as `{ state, grew }` in Task 3. `reflow(CanvasState) ->
  CanvasState` matches its Task 3 call site. `isPanelRect`, `defaultCanvas`,
  `clampRect`, `rectsOverlap`, `writeStorage`, `serializeCanvas` all already
  exist in the module.
