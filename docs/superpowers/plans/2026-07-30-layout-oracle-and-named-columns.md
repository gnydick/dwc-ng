# Layout Oracle and Named Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a layout audit that names which card, which axis and which number is wrong, then remove the two regression classes that codegen would have removed for free — positional selectors and duplicated column widths.

**Architecture:** A dependency-free audit module measures every card in `CARD_DEFS` in a foreground browser and asserts two invariants: a card's reported minimum must not change when the card's own size changes (Invariant A), and no descendant may move when the container resizes along the other axis (Invariant B). The Card Lab calls it and renders the results. Then `nth-child` column widths become named role classes, and the two tool cards' widths collapse to one shared declaration.

**Tech Stack:** SolidJS, TypeScript, Vite, node:test with Node native type stripping, hand-rolled CSS.

## Global Constraints

- **Never add a dependency.** No Playwright, no jsdom, no test-DOM library. If a task appears to need one, stop and ask.
- **The build is a stricter gate than the tests.** `tsc -b` runs with `noUnusedLocals`, so dead code fails `pnpm build` while `pnpm test` stays green. Every task ends with BOTH green.
- **`jsdom` has no layout engine** and would return zeros from `getBoundingClientRect`. All geometry assertions run in a real browser, never in `node:test`.
- **`ResizeObserver` does not fire in automated or background browser tabs.** Verified 2026-07-30: a fresh observer on an uncontained element missed even its mandatory initial callback. The audit must not depend on it.
- **Work only in the worktree** `N:\ideaprojects\dwc-ng-layout`, branch `layout-archetypes`. Never run `pnpm ship` from here — `main` is what deploys.
- **Solid rules:** never destructure props; use `<Show>` / `<For>` / `<Switch>`, not early returns or `.map` in JSX; signals read inside tracking scopes only.
- **`reference/` is read-only.** Never copy, port or paraphrase code from it.
- Test command: `pnpm --filter @dwc-ng/ui test` (runs `node --conditions=browser --test "test/*.test.ts"`).
- Build command: `pnpm --filter @dwc-ng/ui build`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/src/dev/layoutAudit.ts` | **Create.** Pure measurement + invariant checks over one card element. No Solid, no DOM ownership, no imports from the Card Lab. |
| `packages/ui/src/dev/LayoutAuditPanel.tsx` | **Create.** Solid component that runs the audit across all cards and renders the report. |
| `packages/ui/src/dev/CardLab.tsx` | **Modify.** Add a pill that mounts `LayoutAuditPanel`. |
| `packages/ui/src/app.css` | **Modify.** Audit panel styling; `nth-child` → role classes; shared tool-column tokens. |
| `packages/ui/src/cards/ToolsHeatersCard.tsx` | **Modify.** Add role classes to `<th>`/`<td>`. |
| `packages/ui/test/layout-audit.test.ts` | **Create.** Unit tests for the pure logic in `layoutAudit.ts` (no DOM). |
| `packages/ui/test/heat-table-columns.test.ts` | **Modify.** Re-point from `nth-child` indices to role classes. |

`layoutAudit.ts` is deliberately split from the panel so its arithmetic is unit-testable in `node:test` while the DOM parts stay in the browser.

---

## Task 1: The audit's pure logic

**Files:**
- Create: `packages/ui/src/dev/layoutAudit.ts`
- Test: `packages/ui/test/layout-audit.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface AxisProbe { size: number; reported: number }`
  - `export interface AxisVerdict { axis: "row" | "col"; stable: boolean; reported: number[]; spread: number }`
  - `export function judgeAxis(axis: "row" | "col", probes: readonly AxisProbe[]): AxisVerdict`
  - `export interface DriftSample { id: string; main: number; cross: number }`
  - `export function judgeDrift(a: readonly DriftSample[], b: readonly DriftSample[]): { stable: boolean; moved: string[] }`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/layout-audit.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeAxis, judgeDrift } from "../src/dev/layoutAudit.ts";

/**
 * Invariant A. A card's reported minimum along an axis must not depend on its
 * own used size along that axis. CSS defines min-content as the size at a
 * ZERO-sized containing block, so the actual container is not an input by
 * construction; a reported minimum that moves with the card is Chromium's
 * "hysteresis" defect. Observed as rowStop 180 against a span of 180.
 */
test("judgeAxis: a minimum that never moves is stable", () => {
	const v = judgeAxis("row", [
		{ size: 720, reported: 88 },
		{ size: 400, reported: 88 },
		{ size: 200, reported: 88 },
	]);
	assert.equal(v.stable, true);
	assert.equal(v.spread, 0);
});

test("judgeAxis: a minimum that tracks the card is the toolpath defect", () => {
	// Exactly the shape measured on 2026-07-30: reported == current span.
	const v = judgeAxis("row", [
		{ size: 720, reported: 180 },
		{ size: 400, reported: 100 },
		{ size: 200, reported: 50 },
	]);
	assert.equal(v.stable, false);
	assert.equal(v.spread, 130);
});

test("judgeAxis: one pixel of jitter is not a violation", () => {
	// Sub-pixel rounding at fractional row units must not cry wolf.
	const v = judgeAxis("row", [
		{ size: 720, reported: 88 },
		{ size: 400, reported: 89 },
	]);
	assert.equal(v.stable, true);
	assert.equal(v.spread, 1);
});

test("judgeAxis: fewer than two probes cannot judge anything", () => {
	assert.equal(judgeAxis("row", [{ size: 720, reported: 88 }]).stable, true);
	assert.equal(judgeAxis("row", []).stable, true);
});

/**
 * Invariant B, per-archetype policy: no descendant changes position when the
 * container resizes along the OTHER axis. Killing flex-wrap is what makes this
 * hold; a wrapping row is what breaks it.
 */
test("judgeDrift: identical positions are stable", () => {
	const a = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 10, cross: 60 }];
	assert.deepEqual(judgeDrift(a, a), { stable: true, moved: [] });
});

test("judgeDrift: a child that wrapped to a new line is reported by id", () => {
	const before = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 10, cross: 60 }];
	const after = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 44, cross: 20 }];
	const v = judgeDrift(before, after);
	assert.equal(v.stable, false);
	assert.deepEqual(v.moved, ["1"]);
});

test("judgeDrift: a differing child count is a violation, not a crash", () => {
	const before = [{ id: "0", main: 10, cross: 20 }];
	const after = [{ id: "0", main: 10, cross: 20 }, { id: "1", main: 10, cross: 60 }];
	assert.equal(judgeDrift(before, after).stable, false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd N:/ideaprojects/dwc-ng-layout
pnpm --filter @dwc-ng/ui test
```

Expected: FAIL — `Cannot find module '../src/dev/layoutAudit.ts'`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/dev/layoutAudit.ts`:

```ts
/**
 * The layout oracle's arithmetic — deliberately free of the DOM so it can be
 * unit-tested in node:test, which has no layout engine.
 *
 * The DOM half lives in LayoutAuditPanel.tsx. The split exists because the two
 * halves fail differently: this file's bugs are logic bugs a unit test catches,
 * the panel's bugs are geometry bugs only a real browser can see.
 */

/** One measurement: the card was SIZE along an axis and reported REPORTED. */
export interface AxisProbe {
	size: number;
	reported: number;
}

export interface AxisVerdict {
	axis: "row" | "col";
	stable: boolean;
	reported: number[];
	spread: number;
}

/**
 * Sub-pixel tolerance. Row units are fractional at tight density pitches
 * (--row-unit is 2.8px at 0.40), so a ceil() over a fractional divisor can
 * legitimately differ by one between probes. Two or more is a real dependency.
 */
export const AXIS_TOLERANCE = 1;

/**
 * INVARIANT A: a card's reported minimum along an axis must be independent of
 * its own used size along that axis.
 *
 * CSS Sizing 3 defines min-content as the size the box would have "if its
 * containing block was zero-sized in that axis" — the actual container is not
 * an input by construction. A minimum that moves with the card means the
 * measurement is reading post-layout geometry, which is a different quantity;
 * Chromium calls the resulting ratchet "hysteresis".
 */
export function judgeAxis(axis: "row" | "col", probes: readonly AxisProbe[]): AxisVerdict {
	const reported = probes.map(p => p.reported);
	// One probe cannot show dependence, and zero certainly cannot. Returning
	// "stable" is honest: nothing was tested. The panel reports the probe count
	// alongside, so an untested axis is visible rather than silently passing.
	if (reported.length < 2) return { axis, stable: true, reported, spread: 0 };
	const spread = Math.max(...reported) - Math.min(...reported);
	return { axis, stable: spread <= AXIS_TOLERANCE, reported, spread };
}

/** A descendant's position relative to the card body, at one container size. */
export interface DriftSample {
	id: string;
	main: number;
	cross: number;
}

/**
 * INVARIANT B: no descendant changes position when the container resizes along
 * the OTHER axis.
 *
 * NOT a discovered property — there is no prior art naming it and no
 * component-level analogue to Cumulative Layout Shift, which is page-level and
 * time-windowed. It is this project's positional-stability requirement,
 * expressed as something checkable. It is FALSE BY CONSTRUCTION for a slot
 * containing wrapping text, so cards that legitimately reflow must be excluded
 * by name rather than by fudging the comparison.
 */
export function judgeDrift(
	a: readonly DriftSample[],
	b: readonly DriftSample[],
): { stable: boolean; moved: string[] } {
	// A differing count means children appeared or vanished with size, which is
	// a stronger violation than movement — report it rather than zipping the
	// shorter list and silently ignoring the tail.
	if (a.length !== b.length) return { stable: false, moved: ["<child count changed>"] };
	const moved: string[] = [];
	for (let i = 0; i < a.length; i++) {
		const before = a[i]!;
		const after = b[i]!;
		if (Math.abs(before.main - after.main) > AXIS_TOLERANCE
			|| Math.abs(before.cross - after.cross) > AXIS_TOLERANCE) {
			moved.push(before.id);
		}
	}
	return { stable: moved.length === 0, moved };
}
```

- [ ] **Step 4: Run the tests and the build**

```bash
pnpm --filter @dwc-ng/ui test
pnpm --filter @dwc-ng/ui build
```

Expected: all tests PASS; build exits 0.

- [ ] **Step 5: Commit**

```bash
cd N:/ideaprojects/dwc-ng-layout
git add packages/ui/src/dev/layoutAudit.ts packages/ui/test/layout-audit.test.ts
git commit -m "feat(audit): the layout oracle's arithmetic, DOM-free

judgeAxis encodes Invariant A - a card's reported minimum along an axis must
not depend on its own used size along that axis. CSS defines min-content as the
size at a ZERO-sized containing block, so the container is not an input by
construction; a minimum that tracks the card means post-layout geometry is being
read instead, which Chromium calls hysteresis. The failing fixture is the exact
shape measured on the toolpath card: reported 180 at span 180, 100 at 100.

judgeDrift encodes Invariant B, which is explicitly NOT prior art - no named
property exists and CLS is page-level - so it is recorded as this project's
positional-stability requirement made checkable.

Split from the DOM half so the arithmetic is testable in node:test, which has
no layout engine."
```

---

## Task 2: Measure one card in the browser

**Files:**
- Create: `packages/ui/src/dev/LayoutAuditPanel.tsx`
- Modify: `packages/ui/src/app.css` (append the audit panel block at end of file)

**Interfaces:**
- Consumes: `judgeAxis`, `judgeDrift`, `AxisProbe`, `DriftSample`, `AxisVerdict` from `src/dev/layoutAudit.ts`; `contentRowSpan`, `contentColSpan`, `headerColSpan`, `rowUnitPx`, `COL_UNIT_PX` from `src/shell/panelCanvas.ts`; `allCardIds`, `cardTitleOf`, `CARD_DEFS`, `type CardId` from `src/compose/defs.ts`.
- Produces: `export function LayoutAuditPanel(props: { cardEl: () => HTMLElement | null; id: () => string })`, and `export interface CardReport { id: string; title: string; rowStop: number; colStop: number; headerWall: number; axisRow: AxisVerdict; axisCol: AxisVerdict; drift: { stable: boolean; moved: string[] } }`.

- [ ] **Step 1: Write the panel**

Create `packages/ui/src/dev/LayoutAuditPanel.tsx`:

```tsx
import { For, Show, createSignal } from "solid-js";
import {
	judgeAxis, judgeDrift, type AxisProbe, type AxisVerdict, type DriftSample,
} from "./layoutAudit.ts";
import { contentRowSpan, contentColSpan, headerColSpan, rowUnitPx, COL_UNIT_PX } from "../shell/panelCanvas.ts";

export interface CardReport {
	id: string;
	title: string;
	rowStop: number;
	colStop: number;
	headerWall: number;
	axisRow: AxisVerdict;
	axisCol: AxisVerdict;
	drift: { stable: boolean; moved: string[] };
}

/**
 * Probe sizes, in px. Three points across a realistic range: a card as placed,
 * half that, and near its floor. Two would suffice to detect dependence; three
 * makes a monotonic ratchet visible in the reported column rather than just a
 * pass/fail.
 */
const ROW_PROBES = [720, 400, 200];
const COL_PROBES = [1200, 700, 360];

/**
 * Measure with the card FORCED to a size, then put it back.
 *
 * Forcing is the whole point: Invariant A says the answer must not change, so
 * the only way to test it is to change the thing it must not depend on. The
 * card is restored synchronously in a finally, so a throw mid-probe cannot
 * leave the bench card stuck at 200px.
 */
function probeAt<T>(el: HTMLElement, axis: "row" | "col", px: number, read: () => T): T {
	const prop = axis === "row" ? "height" : "width";
	const previous = el.style.getPropertyValue(prop);
	try {
		el.style.setProperty(prop, `${px}px`);
		// Reading a layout property flushes pending style and layout, so the
		// measurement below sees the forced size. No ResizeObserver involved:
		// observers do not fire in automated or background tabs at all.
		void el.getBoundingClientRect();
		return read();
	} finally {
		if (previous === "") el.style.removeProperty(prop);
		else el.style.setProperty(prop, previous);
	}
}

/** Every in-flow descendant of the body, with its offset from the body's box. */
function sampleChildren(cardEl: HTMLElement, axis: "row" | "col"): DriftSample[] {
	const body = cardEl.querySelector<HTMLElement>(".panel-body");
	if (!body) return [];
	const origin = body.getBoundingClientRect();
	return Array.from(body.querySelectorAll<HTMLElement>("*"))
		.filter(el => {
			const s = getComputedStyle(el);
			return s.position !== "absolute" && s.position !== "fixed" && el.getBoundingClientRect().width > 0;
		})
		.map((el, i) => {
			const r = el.getBoundingClientRect();
			// main = the axis being resized; cross = the one that must not move.
			return axis === "col"
				? { id: `${i}:${el.className || el.tagName}`, main: Math.round(r.x - origin.x), cross: Math.round(r.y - origin.y) }
				: { id: `${i}:${el.className || el.tagName}`, main: Math.round(r.y - origin.y), cross: Math.round(r.x - origin.x) };
		});
}

/** Audit ONE mounted card element. The panel drives this per card. */
export function auditCard(id: string, title: string, cardEl: HTMLElement): CardReport {
	const gutterRow = parseFloat(getComputedStyle(cardEl).marginBottom) || 0;
	const gutterCol = parseFloat(getComputedStyle(cardEl).marginRight) || 0;

	const rowProbes: AxisProbe[] = ROW_PROBES.map(px => ({
		size: px,
		reported: probeAt(cardEl, "row", px, () => contentRowSpan(cardEl, gutterRow)),
	}));
	const colProbes: AxisProbe[] = COL_PROBES.map(px => ({
		size: px,
		reported: probeAt(cardEl, "col", px, () => contentColSpan(cardEl, gutterCol)),
	}));

	// Invariant B: resize along the COLUMN axis, assert nothing moved in the
	// row direction. Two widths is enough — a wrap either happens or it does not.
	const wide = probeAt(cardEl, "col", COL_PROBES[0]!, () => sampleChildren(cardEl, "col"));
	const narrow = probeAt(cardEl, "col", COL_PROBES[1]!, () => sampleChildren(cardEl, "col"));

	return {
		id,
		title,
		rowStop: contentRowSpan(cardEl, gutterRow),
		colStop: contentColSpan(cardEl, gutterCol),
		headerWall: headerColSpan(cardEl, gutterCol),
		axisRow: judgeAxis("row", rowProbes),
		axisCol: judgeAxis("col", colProbes),
		drift: judgeDrift(
			wide.map(s => ({ ...s, main: 0 })),
			narrow.map(s => ({ ...s, main: 0 })),
		),
	};
}

/**
 * The report, rendered in the vocabulary an operator edits in: which card,
 * which axis, which number. "Extruders — row minimum moved 88 -> 180" is
 * actionable; "the line-box strut inflated the cell" is not.
 */
export function LayoutAuditPanel(props: { cardEl: () => HTMLElement | null; id: () => string; title: () => string }) {
	const [report, setReport] = createSignal<CardReport | null>(null);
	const run = (): void => {
		const el = props.cardEl();
		if (el === null) return;
		setReport(auditCard(props.id(), props.title(), el));
	};
	return (
		<div class="layout-audit">
			<div class="layout-audit-bar">
				<button class="lab-pill" onClick={run}>Run layout audit</button>
				<span class="lab-note">
					row unit {rowUnitPx()}px · col unit {COL_UNIT_PX}px
				</span>
			</div>
			<Show when={report()}>
				{r => (
					<dl class="layout-audit-grid">
						<dt>Row stop</dt>
						<dd>{r().rowStop} rows</dd>
						<dt>Col stop</dt>
						<dd>{r().colStop} cols (header wall {r().headerWall})</dd>
						<dt>Invariant A · row</dt>
						<dd classList={{ bad: !r().axisRow.stable }}>
							{r().axisRow.stable ? "stable" : `MOVED ${r().axisRow.reported.join(" → ")}`}
						</dd>
						<dt>Invariant A · col</dt>
						<dd classList={{ bad: !r().axisCol.stable }}>
							{r().axisCol.stable ? "stable" : `MOVED ${r().axisCol.reported.join(" → ")}`}
						</dd>
						<dt>Invariant B · drift</dt>
						<dd classList={{ bad: !r().drift.stable }}>
							<Show when={r().drift.stable} fallback={<For each={r().drift.moved}>{m => <span>{m} </span>}</For>}>
								no child moved
							</Show>
						</dd>
					</dl>
				)}
			</Show>
		</div>
	);
}
```

- [ ] **Step 2: Add the styling**

Append to `packages/ui/src/app.css`:

```css
/* ---------- layout audit (dev only) ---------- */
.layout-audit { margin-top: var(--sp-flow); border-top: 1px solid var(--hairline); padding-top: var(--sp-flow); }
.layout-audit-bar { display: flex; align-items: center; gap: var(--ctl-gap); }
.layout-audit-grid {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: var(--sp-cell) var(--ctl-gap);
	margin: var(--sp-flow) 0 0;
	font: 400 12.5px/1.4 var(--font-body);
}
.layout-audit-grid dt { color: var(--silk-dim); }
.layout-audit-grid dd { margin: 0; color: var(--silk); font-variant-numeric: tabular-nums; }
.layout-audit-grid dd.bad { color: var(--fault); font-weight: 600; }
```

- [ ] **Step 3: Verify the build**

```bash
pnpm --filter @dwc-ng/ui build
```

Expected: exits 0. If `tsc` reports an unused import, delete it — `noUnusedLocals` is on.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/dev/LayoutAuditPanel.tsx packages/ui/src/app.css
git commit -m "feat(audit): measure one card's invariants in a real browser

Forces the card to three sizes per axis and re-reads contentRowSpan /
contentColSpan at each. Forcing is the point: Invariant A says the reported
minimum must not change, so the only way to test it is to change the thing it
must not depend on. The card is restored in a finally so a throw cannot leave
the bench card stuck at 200px.

No ResizeObserver anywhere - observers do not fire in automated or background
tabs at all (verified 2026-07-30: a fresh observer on an uncontained element
missed even its mandatory initial callback). Layout is flushed by reading a
geometry property instead.

The report names the card, the axis and the numbers, because that is the whole
point: 'row minimum moved 88 -> 180' is actionable by someone who does not know
CSS; 'the line-box strut inflated the cell' is not."
```

---

## Task 3: Run the audit across every card from the Card Lab

**Files:**
- Modify: `packages/ui/src/dev/CardLab.tsx`
- Modify: `packages/ui/src/dev/LayoutAuditPanel.tsx`

**Interfaces:**
- Consumes: `auditCard`, `type CardReport` from `./LayoutAuditPanel.tsx`.
- Produces: `export function LayoutAuditAll(props: { onFeature: (id: string) => void })` — mounts each card in turn, audits it, and renders the table. This is the artefact that produces the empirical floor table.

- [ ] **Step 1: Add the sweep component**

Append to `packages/ui/src/dev/LayoutAuditPanel.tsx`:

```tsx
/**
 * The floor table. Sweeps every registry card, audits it, and lists the
 * results worst-first.
 *
 * Produced BEFORE any card is converted, deliberately: it is the empirical
 * record of what each card's floors actually are today, so that a mismatch
 * after conversion is attributable to the conversion rather than to a number
 * nobody ever checked.
 *
 * Cards are audited one at a time against the bench element, because the lab
 * mounts exactly one card. The caller features each id, waits a frame for the
 * mount, then audits whatever is on the bench.
 */
export function LayoutAuditAll(props: {
	ids: () => readonly string[];
	titleOf: (id: string) => string;
	feature: (id: string) => void;
	benchEl: () => HTMLElement | null;
}) {
	const [rows, setRows] = createSignal<CardReport[]>([]);
	const [busy, setBusy] = createSignal(false);

	const sweep = async (): Promise<void> => {
		setBusy(true);
		setRows([]);
		const out: CardReport[] = [];
		for (const id of props.ids()) {
			props.feature(id);
			// Two frames: one for Solid to render the newly featured card, one
			// for the browser to lay it out before anything is measured.
			await new Promise(requestAnimationFrame);
			await new Promise(requestAnimationFrame);
			const el = props.benchEl();
			if (el === null) continue;
			out.push(auditCard(id, props.titleOf(id), el));
		}
		// Worst first: a violation is what the operator came here to find.
		const rank = (r: CardReport): number =>
			(r.axisRow.stable ? 0 : 4) + (r.axisCol.stable ? 0 : 2) + (r.drift.stable ? 0 : 1);
		setRows([...out].sort((a, b) => rank(b) - rank(a)));
		setBusy(false);
	};

	return (
		<div class="layout-audit">
			<div class="layout-audit-bar">
				<button class="lab-pill" disabled={busy()} onClick={() => void sweep()}>
					{busy() ? "Auditing…" : "Audit every card"}
				</button>
				<span class="lab-note">{rows().length} audited</span>
			</div>
			<Show when={rows().length > 0}>
				<table class="layout-audit-table">
					<thead>
						<tr>
							<th scope="col">Card</th>
							<th scope="col">Rows</th>
							<th scope="col">Cols</th>
							<th scope="col">A · row</th>
							<th scope="col">A · col</th>
							<th scope="col">B · drift</th>
						</tr>
					</thead>
					<tbody>
						<For each={rows()}>
							{r => (
								<tr>
									<td>{r.title}</td>
									<td>{r.rowStop}</td>
									<td>{r.colStop}</td>
									<td classList={{ bad: !r.axisRow.stable }}>
										{r.axisRow.stable ? "ok" : r.axisRow.reported.join("→")}
									</td>
									<td classList={{ bad: !r.axisCol.stable }}>
										{r.axisCol.stable ? "ok" : r.axisCol.reported.join("→")}
									</td>
									<td classList={{ bad: !r.drift.stable }}>
										{r.drift.stable ? "ok" : `${r.drift.moved.length} moved`}
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</Show>
		</div>
	);
}
```

- [ ] **Step 2: Add its styling**

Append to `packages/ui/src/app.css`:

```css
.layout-audit-table { width: 100%; border-collapse: collapse; margin-top: var(--sp-flow); font: 400 12px/1.4 var(--font-body); }
.layout-audit-table th {
	font: 600 10.5px/1 var(--font-display); letter-spacing: 0.14em; text-transform: uppercase;
	color: var(--silk-dim); text-align: left; padding: 0 var(--ctl-gap) var(--sp-cell) 0;
}
.layout-audit-table td { padding: var(--sp-cell) var(--ctl-gap) var(--sp-cell) 0; border-top: 1px solid var(--hairline); font-variant-numeric: tabular-nums; }
.layout-audit-table td.bad { color: var(--fault); font-weight: 600; }
```

- [ ] **Step 3: Wire it into the Card Lab**

In `packages/ui/src/dev/CardLab.tsx`:

1. Add to the imports at the top:

```tsx
import { LayoutAuditAll } from "./LayoutAuditPanel.tsx";
```

2. Add a bench ref. Immediately before `return (` in the component body, add:

```tsx
	// The bench element the audit measures. One card is mounted at a time, so
	// one ref suffices; the sweep features each id and re-reads this.
	let benchEl: HTMLDivElement | undefined;
	const [auditOpen, setAuditOpen] = createSignal(false);
```

3. Add `createSignal` to the existing `solid-js` import if it is not already there.

4. Wrap the existing `<PanelCanvas class="lab-canvas">` element in a ref'd div by replacing the line `<PanelCanvas class="lab-canvas">` with:

```tsx
				<div ref={benchEl}>
				<PanelCanvas class="lab-canvas">
```

and its matching `</PanelCanvas>` with:

```tsx
				</PanelCanvas>
				</div>
```

5. Immediately after the closing `</div>` of the `layout-toolbar` block, add:

```tsx
			<div class="lab-bar">
				<span class="lab-cap">Audit</span>
				<button class="lab-pill" aria-pressed={auditOpen()} onClick={() => setAuditOpen(v => !v)}>
					{auditOpen() ? "Hide layout audit" : "Show layout audit"}
				</button>
			</div>
			<Show when={auditOpen()}>
				<LayoutAuditAll
					ids={() => allCardIds()}
					titleOf={id => cardTitleOf(id as CardId)}
					feature={id => setFeatured(id as CardId)}
					benchEl={() => benchEl?.querySelector<HTMLElement>("[data-panel-id]") ?? null}
				/>
			</Show>
```

- [ ] **Step 4: Verify the build and run the sweep**

```bash
pnpm --filter @dwc-ng/ui build
pnpm --filter @dwc-ng/ui dev
```

Open `http://localhost:5173/#/cards` **in a foreground tab**, click *Show layout audit*, then *Audit every card*.

Expected: a table of every card. Record the output — this is the empirical floor table the spec calls for. Cards known to have been fixed (toolpath, console, jobs, macros) should read `ok` on Invariant A; any card reading `MOVED` is a live instance of the toolpath defect.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/dev/CardLab.tsx packages/ui/src/dev/LayoutAuditPanel.tsx packages/ui/src/app.css
git commit -m "feat(audit): sweep every registry card and rank violations first

Produces the empirical floor table BEFORE any card is converted, which is the
point of sequencing the oracle first: a mismatch found after a conversion is
then attributable to the conversion rather than to a number nobody had ever
checked.

Sweeps by featuring each id in turn and waiting two frames - one for Solid to
render, one for the browser to lay out - because the lab mounts exactly one
card at a time. Sorted worst-first: a violation is what you came here to find."
```

---

## Task 4: Name the heater table's columns

**Files:**
- Modify: `packages/ui/src/cards/ToolsHeatersCard.tsx`
- Modify: `packages/ui/src/app.css:707-745` and `packages/ui/src/app.css:1290-1310`
- Modify: `packages/ui/test/heat-table-columns.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the CSS class names `col-heater`, `col-active`, `col-standby`, `col-current`, `col-set` on both `<th>` and `<td>` of the heater table.

- [ ] **Step 1: Write the failing test**

In `packages/ui/test/heat-table-columns.test.ts`, replace the test named
`"the narrow-viewport block names no column the table does not have"` with:

```ts
/**
 * THE regression this whole file exists for. A media query written for the
 * FIVE-column table kept its nth-child indices when Filament was inserted as
 * column 2, so every index slid one to the left: Filament took the width meant
 * for Active (under the picker's own min-width, so it overflowed) and Current
 * took the width meant for Set. The card's minimum went UP under rules meant to
 * shrink it, and it was the one card that would not narrow in portrait.
 *
 * A positional selector cannot be made safe - it is correct only for as long as
 * nobody inserts a column. A named role class travels WITH its column, so
 * inserting one shifts nothing.
 */
test("no load-bearing width is carried by a positional selector", () => {
	const positional = /(th|td):nth-(child|of-type)\(\d+\)[^{]*\{([^}]*)\}/g;
	const offenders: string[] = [];
	for (const [whole, , , body] of appCss.matchAll(positional)) {
		if (/(^|[;{\s])(width|min-width|max-width|flex-basis):/.test(body!)) {
			offenders.push(whole.slice(0, 70));
		}
	}
	assert.deepEqual(offenders, [], "these rules set a width from a position, not from a role");
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @dwc-ng/ui test
```

Expected: FAIL, listing the `.heat-table th:nth-child(N)` rules.

- [ ] **Step 3: Add role classes to the markup**

In `packages/ui/src/cards/ToolsHeatersCard.tsx`, in the `<thead>` block near line 141:

```tsx
								<th scope="col" class="col-heater">Heater</th>
								<Show when={controls()}>
									<th scope="col" class="col-active">Active</th>
									<th scope="col" class="col-standby">Standby</th>
								</Show>
								<th scope="col" class="col-current">Current</th>
								<Show when={controls()}><th scope="col" class="col-set">Set</th></Show>
```

In the tool row (`<tbody>`), the first cell:

```tsx
												<td class="col-heater">
```

In the `no heater` fallback:

```tsx
													fallback={<td colspan={controls() ? 3 : 1} class="heat-set col-current">no heater</td>}
```

In `HeaterCells`, add the class to each `<td>` in order: the Active cell gets
`class="col-active"`, the Standby cell `class="col-standby"`, the Current cell
`class="col-current"`, and the Set cell `class="col-set"`.

- [ ] **Step 4: Re-point the CSS**

In `packages/ui/src/app.css`, replace lines 718–745 (the base column block) with:

```css
/* Columns by ROLE, not by position. The width travels with the column, so
   inserting or removing one shifts nothing — which is the entire content of
   regression class (f). Sum: 152 + 70 + 56 + 58 + 156 = 492. */
.heat-table .col-heater { width: 152px; }
.heat-table .col-active { width: 70px; padding-left: 14px; }
.heat-table .col-standby { width: 56px; }
.heat-table .col-current { width: 58px; padding-right: 14px; }
.heat-table .col-set { width: 156px; }
/* The Tools card renders the same table without the control columns, so
   Current is the second cell rather than the fourth. Under role classes that
   fact needs no restatement of any OTHER column's width — which is what the
   positional version got wrong. 152 + 58 = 210. */
.heat-table.info-only { min-width: 210px; }
```

Delete the now-dead `.heat-table.info-only th:nth-child(2)` rule that followed it.

In the `@media (max-width: 900px)` block, replace the two `nth-child` rules with:

```css
	.heat-table .col-current { width: 50px; padding-right: 6px; }
	.heat-table.info-only { min-width: 202px; }
```

- [ ] **Step 5: Update the column-sum test**

In `packages/ui/test/heat-table-columns.test.ts`, replace the `columnWidths`
helper with one that reads role classes:

```ts
/** role -> declared px width, for `.heat-table` column rules. */
function columnWidths(css: string): Map<string, number> {
	const widths = new Map<string, number>();
	const rule = /\.heat-table \.col-([a-z]+)\s*\{([^}]*)\}/g;
	for (const [, role, body] of css.matchAll(rule)) {
		const width = /(?:^|[;{\s])width:\s*(\d+)px/.exec(body!);
		assert.ok(width, `.heat-table .col-${role} declares no px width`);
		widths.set(role!, Number(width[1]));
	}
	return widths;
}
```

and replace the `COLUMN_COUNT` derivation and the "every column has a declared
width" test with:

```ts
const COLUMN_ROLES = ["heater", "active", "standby", "current", "set"] as const;

test("every column the component renders has a role class with a width", () => {
	// Welded to the markup: a <th> without a col- class, or a col- class the
	// markup never uses, fails here rather than silently inheriting a width.
	const inMarkup = [...cardTsx.matchAll(/<th scope="col" class="col-([a-z]+)"/g)].map(m => m[1]!);
	assert.deepEqual([...inMarkup].sort(), [...COLUMN_ROLES].sort());
	const widths = columnWidths(base);
	for (const role of COLUMN_ROLES) assert.ok(widths.has(role), `no width for col-${role}`);
});
```

Update the two sum tests to use `[...widths.values()]` unchanged — they already
sum the map's values.

- [ ] **Step 6: Run tests and build**

```bash
pnpm --filter @dwc-ng/ui test
pnpm --filter @dwc-ng/ui build
```

Expected: all PASS, build exits 0.

- [ ] **Step 7: Verify in the browser**

`pnpm --filter @dwc-ng/ui dev`, open `#/cards`, feature *Tools & heaters* and
*Tools*, and run the audit. Column widths must be unchanged from the floor
table recorded in Task 3.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/cards/ToolsHeatersCard.tsx packages/ui/src/app.css packages/ui/test/heat-table-columns.test.ts
git commit -m "fix(tools): columns carry their width by ROLE, not by position

A media query written for the five-column table kept its nth-child indices when
Filament was inserted as column 2, so every index slid one left: Filament took
the width meant for Active - under the picker's own min-width, so it overflowed
its cell - and Current, 44px of text, took the 196px meant for Set. The card's
minimum went UP under rules meant to shrink it, and it was the one card that
would not narrow in portrait.

A positional selector cannot be made safe; it is correct only until someone
inserts a column. A role class travels with its column, so insertion shifts
nothing. The test now forbids ANY nth-child selector from carrying a width,
which closes the class rather than this instance of it."
```

---

## Task 5: One declaration for both tool cards

**Files:**
- Modify: `packages/ui/src/app.css` (the role-class block from Task 4, and `:root`)
- Modify: `packages/ui/test/heat-table-columns.test.ts`

**Interfaces:**
- Consumes: the `col-*` role classes from Task 4.
- Produces: the tokens `--tool-col-heater`, `--tool-col-active`, `--tool-col-standby`, `--tool-col-current`, `--tool-col-set` on `:root`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/heat-table-columns.test.ts`:

```ts
/**
 * Regression class (e). Tools and Tools & heaters are the same table with
 * columns removed, but their widths were two sets of numbers that happened to
 * match - and they stopped matching at a different density, where one card's
 * rows were driven by --ctl-h and the other's by a control that had opted out
 * of it. Agreement has to be structural: ONE declaration, subtracted from.
 */
test("tool column widths come from tokens, not from literals", () => {
	const widths = columnWidths(base);
	assert.ok(widths.size > 0, "no column rules found");
	const literal = /\.heat-table \.col-([a-z]+)\s*\{[^}]*width:\s*\d+px/g;
	const offenders = [...base.matchAll(literal)].map(m => m[1]!);
	assert.deepEqual(offenders, [], "these columns hard-code a width instead of naming a token");
});

test("every tool column token has exactly one BASE declaration", () => {
	// Scoped to the BASE cascade, not the whole file. A viewport or density
	// block may legitimately OVERRIDE a token — that is what naming it is for —
	// but there must be exactly one place the default is set, or "one
	// declaration" is a claim rather than a fact.
	for (const role of COLUMN_ROLES) {
		const decl = new RegExp(`--tool-col-${role}:\s*\d+px`, "g");
		const hits = [...base.matchAll(decl)];
		assert.equal(hits.length, 1, `--tool-col-${role} declared ${hits.length} times in the base cascade, expected 1`);
	}
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @dwc-ng/ui test
```

Expected: FAIL — the columns hard-code widths and no tokens exist.

- [ ] **Step 3: Introduce the tokens**

In `packages/ui/src/app.css`, immediately above the `:root { --heat-table-w: 492px; }`
line, add:

```css
/* ONE declaration of the tool table's columns. Both tool cards render the same
   table; Tools simply omits the control columns. Before this the two carried
   separate numbers that agreed by coincidence, and stopped agreeing at a
   different density. Subtraction cannot disagree. */
:root {
	--tool-col-heater: 152px;
	--tool-col-active: 70px;
	--tool-col-standby: 56px;
	--tool-col-current: 58px;
	--tool-col-set: 156px;
}
```

Change the role rules to reference them:

```css
.heat-table .col-heater { width: var(--tool-col-heater); }
.heat-table .col-active { width: var(--tool-col-active); padding-left: 14px; }
.heat-table .col-standby { width: var(--tool-col-standby); }
.heat-table .col-current { width: var(--tool-col-current); padding-right: 14px; }
.heat-table .col-set { width: var(--tool-col-set); }
```

In the `@media (max-width: 900px)` block, override the token rather than the rule:

```css
	/* Only Current has measured slack at this width; the setpoint fields are at
	   their inputs and Set is at its three keys. Overriding the TOKEN keeps one
	   declaration site — the rule above never changes. */
	.heat-table { --tool-col-current: 50px; }
	.heat-table .col-current { padding-right: 6px; }
```

- [ ] **Step 4: Update the sum tests to resolve tokens**

Replace `columnWidths` with a version that resolves a token reference:

```ts
/** role -> declared px width, resolving var(--tool-col-*) against :root. */
function columnWidths(css: string): Map<string, number> {
	const tokens = new Map<string, number>();
	for (const [, role, px] of css.matchAll(/--tool-col-([a-z]+):\s*(\d+)px/g)) {
		// LAST wins, matching the cascade — the narrow block overrides.
		tokens.set(role!, Number(px));
	}
	const widths = new Map<string, number>();
	const rule = /\.heat-table \.col-([a-z]+)\s*\{([^}]*)\}/g;
	for (const [, role, body] of css.matchAll(rule)) {
		const direct = /(?:^|[;{\s])width:\s*(\d+)px/.exec(body!);
		if (direct) { widths.set(role!, Number(direct[1])); continue; }
		const ref = /width:\s*var\(--tool-col-([a-z]+)\)/.exec(body!);
		assert.ok(ref, `.heat-table .col-${role} declares no width`);
		const resolved = tokens.get(ref[1]!);
		assert.ok(resolved !== undefined, `--tool-col-${ref[1]} is never declared`);
		widths.set(role!, resolved);
	}
	return widths;
}
```

- [ ] **Step 5: Run tests and build**

```bash
pnpm --filter @dwc-ng/ui test
pnpm --filter @dwc-ng/ui build
```

Expected: all PASS, build exits 0.

- [ ] **Step 6: Verify no visual change across all four densities**

`pnpm --filter @dwc-ng/ui dev`, open `#/cards` in a foreground tab, feature
*Tools & heaters*, then *Tools*. At each density pitch (1.27 / 0.80 / 0.50 /
0.40), confirm both cards report the same row pitch and that the column widths
match the Task 3 floor table. Run the audit at each pitch.

Expected: identical row pitch on both cards at every pitch — this is the
crossover that regression (e) produced, and it must not reappear.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/app.css packages/ui/test/heat-table-columns.test.ts
git commit -m "refactor(tools): both tool cards subtract from one column declaration

Tools and Tools & heaters render the same table, one of them with the control
columns omitted - but their widths were two sets of numbers that agreed by
coincidence. They stopped agreeing at a different density, which is how the
crossover was found: Extruders was taller at 1.27 and shorter at 0.50.

Columns now name tokens declared once on :root, and the narrow-viewport block
overrides the TOKEN rather than restating the rule, so there is exactly one
declaration site per column. Subtraction cannot disagree.

The test forbids a literal width on any col- rule and asserts each token is
declared exactly once, so a future column cannot quietly acquire a second
definition."
```

---

## Task 6: Record the floor table

**Files:**
- Create: `docs/superpowers/specs/2026-07-30-floor-table.md`

**Interfaces:**
- Consumes: the audit output from Task 3, re-run after Tasks 4 and 5.
- Produces: the empirical baseline that stage 4 (not in this plan) will check conversions against.

- [ ] **Step 1: Re-run the sweep**

```bash
pnpm --filter @dwc-ng/ui dev
```

Open `#/cards` in a **foreground** tab, *Show layout audit*, *Audit every card*.
Repeat at each of the four density pitches.

- [ ] **Step 2: Write the table**

Create `docs/superpowers/specs/2026-07-30-floor-table.md` with a heading per
density pitch and, under each, a markdown table of the audit's columns: Card,
Rows, Cols, A·row, A·col, B·drift. Copy the numbers verbatim from the panel.

Add a short preamble stating: the date, the browser and version, the viewport
size, and that these are the floors BEFORE any card was converted to a
declaration.

- [ ] **Step 3: List every violation as an open item**

Below the tables, add a section `## Violations at baseline` listing each card
that reported anything other than `ok`, with the axis and the reported
sequence. State for each whether it is expected (a card that legitimately
reflows, e.g. a fill slot containing wrapping text — Invariant B is false by
construction for those) or a genuine defect to fix.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-30-floor-table.md
git commit -m "docs: the empirical floor table at baseline

Every registry card's measured floors and invariant verdicts, at all four
density pitches, recorded BEFORE any card is converted to a declaration. This
is the artefact stage 1 exists to produce: a later mismatch is attributable to
the conversion rather than to a number nobody had ever checked.

Violations are listed individually and each is marked expected or defect -
Invariant B is false by construction for a fill slot containing wrapping text,
so an unexplained 'ok' there would be more suspicious than a violation."
```

---

## Self-Review

**Spec coverage.** Stage 1 → Tasks 1–3 and 6 (audit module, browser
measurement, sweep, floor table). Stage 2 → Task 4. Stage 3 → Task 5. The
spec's `heightForWidth` escape hatch, the archetype vocabulary and the
declaration format are all stage 4+ and correctly absent.

**Deliberate omissions, with reasons.** The audit is not wired to CI: that
needs a headless browser, which needs a dependency, which needs explicit
approval. The inspector's editable-numbers stage is not here either — read-only
first, because the model's limits should be visible while they are still cheap
to change.

**Type consistency.** `AxisProbe`, `AxisVerdict`, `DriftSample` and
`CardReport` are defined once and used with the same field names throughout.
`judgeAxis` takes `(axis, probes)` in Tasks 1 and 2 alike. `COLUMN_ROLES` is
introduced in Task 4 and reused in Task 5.
