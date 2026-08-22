# Global Unit Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the density pitch with a stepped UI scale on one global unit `--u`, so every layout-space length in the UI is `n × u` and a card's floor in stored grid cells is the same at every scale — cards never need resizing after a scale change.

**Architecture:** `:root { --u: 4px }` with one `[data-scale]` override block per non-default step. Both grid axes draw in `var(--u)`; stored geometry stays in the frozen 4-cell format with no migration. A build-failing lint forbids any `px` length outside an exempt-property list and a visible `px-ok:` allowlist, with a ratchet baseline that counts down to zero across the migration tasks so every commit stays green. Decorations exempt from scale (borders, hairlines) are rewritten into zero-layout forms (`box-shadow: inset`, positioned pseudo-elements).

**Tech Stack:** SolidJS + TypeScript + Vite, hand-rolled CSS, `node:test` (`pnpm test` → `node --conditions=browser --test "test/*.test.ts"` in `packages/ui`), headless Edge over CDP for browser checks.

**Spec:** `docs/superpowers/specs/2026-08-21-global-unit-scaling-design.md`

## Global Constraints

- Stored format frozen: `ROW_UNIT_PX = 4`, `COL_UNIT_PX = 4` keep their values and meaning; `v: 4` canvas format unchanged; no layout migration.
- Scale 1.0 must render **byte-identically** to today: `--u: 4px`, no `[data-scale="100"]` block.
- Steps: ids `075 · 0875 · 100 · 1125 · 125 · 150` → `--u` = `3 · 3.5 · 4 · 4.5 · 5 · 6px`.
- Exempt properties (px allowed): `border-radius`, `box-shadow`, `outline`, `outline-offset`, `text-shadow`, `filter`, `backdrop-filter`. Also allowed: `@media` preludes, the `--u` definitions in `index.css`, and lines carrying `/* px-ok: <reason> */`.
- Anything exempt from scale must occupy **zero layout space**. `border: Npx` is forbidden everywhere.
- Per-device preference: `localStorage["dwc-ng.scale"]`; never the config overlay. Old `dwc-ng.density-pitch` maps `127→100, 080→0875, 050→075, 040→075`.
- Never destructure props; `<Show>/<For>`; no `.map` in JSX (CLAUDE.md Solid rules).
- No new dependencies.
- Files are mixed CRLF/LF: use the Edit tool (or `newline=''` writers); never rewrite a file through a text-mode Python/Node script that normalises line endings.
- Typecheck with `npx tsc -b --force` (plain `tsc --noEmit` checks zero files here).
- Commit per task; `pnpm test` green at every commit.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019py6ASM1evRytH35hoSh1n
  ```

---

## File map

| File | Responsibility after this plan |
|---|---|
| `packages/ui/test/unit-lengths.test.ts` | **Create.** The px lint + ratchet baseline. The single enforcement point for the invariant. |
| `packages/ui/src/shell/scale.ts` | **Create.** Scale steps, signal, `setScale`, `applyStoredScale`, legacy pitch mapping. |
| `packages/ui/test/scale.test.ts` | **Create.** Port of `density.test.ts` to the scale model. |
| `packages/ui/src/shell/density.ts`, `packages/ui/test/density.test.ts` | **Delete** (Task 2). |
| `packages/ui/src/shell/Shell.tsx:7,200-230` | `DensityToggle` → `ScaleToggle`. |
| `packages/ui/src/main.tsx:33-40` | `applyStoredPitch` → `applyStoredScale`. |
| `packages/ui/src/index.css:110-227` | `--u` + `[data-scale]` blocks; every token in `u`; pitch blocks and `--fs-bump` deleted. |
| `packages/ui/src/shell/panelCanvas.ts:53-107,720-746` | `rowUnitPx` → `unitPx`, both axes; `contentColSpan`/`headerColSpan` divide by `unitPx()`. |
| `packages/ui/src/shell/PanelCanvas.tsx` | Both grid tracks `var(--u)`. |
| `packages/ui/src/dev/LayoutAuditPanel.tsx:8,182` | Reads `unitPx()`. |
| `packages/ui/src/app.css` | All 813 px lengths → `u`; borders/hairlines → zero-layout forms. |
| `packages/ui/src/dev/paletteLab.css` | 17 px lengths → `u`. |
| `packages/ui/src/editor/setup.ts:46,62` | CodeMirror font size / gutter border in `u` / zero-layout. |
| `packages/ui/src/dev/layoutAudit.ts`, `LayoutAuditPanel.tsx` | Scale sweep: floors equal at 075 and 150. |

---

### Task 1: The px lint with a ratchet baseline

**Files:**
- Create: `packages/ui/test/unit-lengths.test.ts`

**Interfaces:**
- Produces: a test that fails when the count of non-exempt `px` tokens in `packages/ui/src/**/*.{css,ts,tsx}` exceeds `BASELINE`, and prints the count plus every `px-ok:` marker. Later tasks lower `BASELINE`; Task 9 sets it to 0 and removes the constant.

- [ ] **Step 1: Write the test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE invariant behind "cards never need resizing after a scale change":
 * every length that occupies layout space is n × var(--u). A pixel literal in
 * a layout-space property is a fixed term in some card's floor, and that floor
 * then drifts with scale. So px is a build error here, not a style nit.
 *
 * Exempt: properties that never occupy layout space. Anything else that must
 * stay in screen px (pointer physics, breakpoints) says so on the line with
 * `px-ok: <reason>`, and every such line is printed so the allowlist is
 * visible, not silent.
 *
 * BASELINE is the debt ratchet: it is the number of violations on the day the
 * lint landed, and each migration task lowers it. It may never go up.
 */
const BASELINE = 1000; // set to the measured count in Step 3

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const EXEMPT_PROPS = [
	"border-radius",
	"box-shadow",
	"outline",
	"outline-offset",
	"text-shadow",
	"filter",
	"backdrop-filter",
];

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(css|ts|tsx)$/.test(name)) out.push(p);
	}
	return out;
}

const stripBlockComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));

export interface Hit { file: string; line: number; text: string }

/** Every `<number>px` token that is not exempt. Pure over file text so it can be unit-tested. */
export function findPxHits(file: string, raw: string): { hits: Hit[]; allowed: Hit[] } {
	const hits: Hit[] = [];
	const allowed: Hit[] = [];
	const isCss = file.endsWith(".css");
	const lines = raw.split("\n");
	// Comments are blanked line-preservingly so reported line numbers are real.
	const scan = stripBlockComments(raw).split("\n");
	for (let i = 0; i < scan.length; i++) {
		const line = scan[i]!;
		if (!/\d(\.\d+)?px\b/.test(line)) continue;
		const original = lines[i]!;
		if (/px-ok:/.test(original)) { allowed.push({ file, line: i + 1, text: original.trim() }); continue; }
		if (/^\s*@media\b/.test(line)) continue;
		if (file.endsWith("index.css") && /^\s*--u:\s*[\d.]+px;/.test(line)) continue;
		if (isCss) {
			const prop = /^\s*(?:--[\w-]+|[a-z-]+)\s*:/.exec(line)?.[0].replace(/[:\s]/g, "");
			if (prop && EXEMPT_PROPS.includes(prop)) continue;
		} else {
			// TS/TSX: the property name is the nearest `name:` or `"name":` before the px.
			const before = line.slice(0, line.search(/\d(\.\d+)?px\b/));
			const prop = /([a-zA-Z-]+)"?\s*:\s*[^:]*$/.exec(before)?.[1]
				?.replace(/([A-Z])/g, c => "-" + c.toLowerCase());
			if (prop && EXEMPT_PROPS.includes(prop)) continue;
		}
		hits.push({ file, line: i + 1, text: original.trim() });
	}
	return { hits, allowed };
}

test("findPxHits: exempt properties, px-ok markers and @media preludes are not hits", () => {
	const css = [
		"a { border-radius: 6px; }",
		"b { box-shadow: inset 0 0 0 1px red; }",
		"@media (max-width: 600px) {",
		"  c { width: 1px; }",
		"}",
		"d { width: 4px; } /* px-ok: test */",
		"e { padding: 3px; }",
	].join("\n");
	const r = findPxHits("x.css", css);
	assert.deepEqual(r.hits.map(h => h.line), [4, 7]); // the `c` rule inside @media is a hit; the prelude line is not
	assert.equal(r.allowed.length, 1);
});

test("findPxHits: a blanked comment keeps line numbers", () => {
	const r = findPxHits("x.css", "/* 1px\n2px */\nf { gap: 8px; }");
	assert.deepEqual(r.hits.map(h => h.line), [3]);
});

test(`layout-space px literals do not exceed the ratchet baseline (${BASELINE})`, () => {
	const hits: Hit[] = [];
	const allowed: Hit[] = [];
	for (const f of walk(SRC)) {
		const r = findPxHits(f, readFileSync(f, "utf8"));
		hits.push(...r.hits);
		allowed.push(...r.allowed);
	}
	console.log(`px hits: ${hits.length} (baseline ${BASELINE}); px-ok allowlist: ${allowed.length}`);
	for (const a of allowed) console.log(`  px-ok  ${a.file}:${a.line}  ${a.text}`);
	const sample = hits.slice(0, 25).map(h => `  ${h.file}:${h.line}  ${h.text}`).join("\n");
	assert.ok(hits.length <= BASELINE,
		`${hits.length} layout-space px literals, baseline is ${BASELINE}. First ones:\n${sample}`);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @dwc-ng/ui test -- test/unit-lengths.test.ts` (or from `packages/ui`: `node --conditions=browser --test test/unit-lengths.test.ts`)
Expected: the two `findPxHits` tests PASS; the ratchet test PASSES (baseline 1000) and prints `px hits: N`.

- [ ] **Step 3: Set the baseline to the measured N**

Edit `const BASELINE = 1000;` → the printed `N`. Re-run; expected PASS with `N (baseline N)`.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/test/unit-lengths.test.ts
git commit -m "test(ui): px-literal lint with a ratchet baseline — the scale invariant's one enforcement point"
```

---

### Task 2: `shell/scale.ts` replaces `shell/density.ts`

**Files:**
- Create: `packages/ui/src/shell/scale.ts`
- Create: `packages/ui/test/scale.test.ts`
- Delete: `packages/ui/src/shell/density.ts`, `packages/ui/test/density.test.ts`
- Modify: `packages/ui/src/shell/Shell.tsx:7,200-230`, `packages/ui/src/main.tsx:33-40`
- Modify: `packages/ui/src/index.css:133-227` (add `--u` + `[data-scale]` blocks; the pitch blocks are removed in Task 4 — in this task they are left in place so nothing changes visually yet)

**Interfaces:**
- Produces: `SCALES: Scale[]`, `DEFAULT_SCALE = "100"`, `parseScale(raw: string | null): string`, `scale(): string` (signal), `setScale(id: string): void`, `applyStoredScale(): void`, `legacyPitchToScale(pitch: string | null): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ui/test/scale.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCALES, DEFAULT_SCALE, parseScale, legacyPitchToScale } from "../src/shell/scale.ts";

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const indexCss = stripComments(readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8"));
const appCss = stripComments(readFileSync(fileURLToPath(new URL("../src/app.css", import.meta.url)), "utf8"));

const unitOf = (id: string): number => {
	if (id === DEFAULT_SCALE) return Number(/:root\s*\{[^}]*--u:\s*([\d.]+)px/.exec(indexCss)![1]);
	const start = indexCss.indexOf(`[data-scale="${id}"]`);
	assert.ok(start >= 0, `no [data-scale="${id}"] block`);
	return Number(/--u:\s*([\d.]+)px/.exec(indexCss.slice(start, indexCss.indexOf("}", start)))![1]);
};

test("parseScale tolerates missing or unknown storage", () => {
	assert.equal(parseScale(null), DEFAULT_SCALE);
	assert.equal(parseScale(""), DEFAULT_SCALE);
	assert.equal(parseScale("1.25"), DEFAULT_SCALE); // the label, not the id
	assert.equal(parseScale("__proto__"), DEFAULT_SCALE);
});

test("parseScale accepts every shipped id, and ids are unique", () => {
	for (const s of SCALES) assert.equal(parseScale(s.id), s.id);
	assert.equal(new Set(SCALES.map(s => s.id)).size, SCALES.length);
});

test("the default scale is the ABSENCE of a CSS override", () => {
	assert.ok(SCALES.some(s => s.id === DEFAULT_SCALE));
	assert.ok(!indexCss.includes(`[data-scale="${DEFAULT_SCALE}"]`));
});

test("every non-default scale declares --u, and :root's --u equals the stored unit", async () => {
	const { ROW_UNIT_PX, COL_UNIT_PX } = await import("../src/shell/panelCanvas.ts");
	assert.equal(unitOf(DEFAULT_SCALE), ROW_UNIT_PX);
	assert.equal(ROW_UNIT_PX, COL_UNIT_PX);
	for (const s of SCALES) if (s.id !== DEFAULT_SCALE) assert.ok(unitOf(s.id) > 0);
});

test("--u is strictly increasing in step order", () => {
	const units = SCALES.map(s => unitOf(s.id));
	for (let i = 1; i < units.length; i++) assert.ok(units[i]! > units[i - 1]!, `${SCALES[i]!.id} not larger than ${SCALES[i - 1]!.id}`);
});

test("--u equals factor × the default unit for every step", () => {
	const base = unitOf(DEFAULT_SCALE);
	for (const s of SCALES) assert.equal(unitOf(s.id), s.factor * base, s.id);
});

test("a scale override block sets ONLY --u", () => {
	for (const s of SCALES) {
		if (s.id === DEFAULT_SCALE) continue;
		const start = indexCss.indexOf(`[data-scale="${s.id}"]`);
		const block = indexCss.slice(start, indexCss.indexOf("}", start));
		const decls = [...block.matchAll(/(--[a-z-]+):/g)].map(m => m[1]);
		assert.deepEqual(decls, ["--u"], `${s.id} sets ${decls.join(",")}`);
	}
});

test("legacy density pitches map onto scale steps, unknown → null", () => {
	assert.equal(legacyPitchToScale("127"), "100");
	assert.equal(legacyPitchToScale("080"), "0875");
	assert.equal(legacyPitchToScale("050"), "075");
	assert.equal(legacyPitchToScale("040"), "075");
	assert.equal(legacyPitchToScale(null), null);
	assert.equal(legacyPitchToScale("bogus"), null);
});

test("the scale control, the resize grip and the e-stop do not scale", () => {
	for (const selector of [".scale-opt {", ".panel-resize-grip {", ".estop {"]) {
		const start = appCss.indexOf(selector);
		assert.ok(start >= 0, `${selector} not found in app.css`);
		const block = appCss.slice(start, appCss.indexOf("}", start));
		assert.ok(!block.includes("var(--u)") && !block.includes("var(--sp-") && !block.includes("var(--ctl-h)"),
			`${selector} must not scale — it is how you escape a scale you dislike`);
	}
});

test("the row-granularity migration uses the frozen stored unit, never the drawn one", () => {
	const src = readFileSync(fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");
	const start = src.indexOf("function migrateRowGranularity");
	assert.ok(start > 0);
	const body = src.slice(start, src.indexOf("\n}", start));
	assert.ok(body.includes("ROW_UNIT_PX"));
	assert.ok(!body.includes("unitPx(") && !body.includes("rowUnitPx("));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --conditions=browser --test test/scale.test.ts` (from `packages/ui`)
Expected: FAIL — cannot resolve `../src/shell/scale.ts`.

- [ ] **Step 3: Write `scale.ts`**

```ts
// packages/ui/src/shell/scale.ts
/**
 * UI scale — how large the whole interface draws, as a multiplier on the one
 * unit (--u) every layout-space length in the UI is written in.
 *
 * Readability, not zoom: type, controls, spacing and the grid itself all
 * follow --u; decorations that do not help you read (borders, hairlines,
 * radii, shadows) stay at their pixel size and occupy no layout space, so a
 * card's floor in stored grid cells is the same number at every step. That is
 * what lets a layout saved on the shop monitor fit on the phone untouched.
 *
 * A per-device preference, not machine configuration, so it persists to
 * localStorage and never touches the config overlay (same reasoning as
 * shell/navState.ts). The mechanism is one attribute on <html>; index.css
 * holds --u on :root and one override block per non-default step, so:
 *
 *   - "100" is the ABSENCE of an override. The default unit is written down
 *     once, on :root, and cannot drift from the step that claims to be it.
 *   - Deleting this feature leaves the UI rendering byte-identically.
 */
import { createSignal } from "solid-js";

export interface Scale {
	id: string;
	/** Multiplier on the default unit. Must match the CSS block (tested). */
	factor: number;
	/** Shown on the control. */
	label: string;
}

/** Smallest first. The stylesheet is the authority on what a step IS; this
 *  list is the authority on which exist. An id with no CSS block renders as
 *  the default — it cannot render as something broken. */
export const SCALES: Scale[] = [
	{ id: "075", factor: 0.75, label: "75" },
	{ id: "0875", factor: 0.875, label: "88" },
	{ id: "100", factor: 1, label: "100" },
	{ id: "1125", factor: 1.125, label: "113" },
	{ id: "125", factor: 1.25, label: "125" },
	{ id: "150", factor: 1.5, label: "150" },
];

export const DEFAULT_SCALE = "100";

const KEY = "dwc-ng.scale";
/** The retired density preference. Read once, mapped, then ignored. */
const LEGACY_KEY = "dwc-ng.density-pitch";

export function parseScale(raw: string | null): string {
	return SCALES.some(s => s.id === raw) ? raw! : DEFAULT_SCALE;
}

/** 1.27 was the default pitch; the tighter pitches all removed air, and the
 *  nearest readable equivalents under a uniform scale are the small steps. */
export function legacyPitchToScale(pitch: string | null): string | null {
	switch (pitch) {
		case "127": return "100";
		case "080": return "0875";
		case "050": return "075";
		case "040": return "075";
		default: return null;
	}
}

function load(): string {
	if (typeof localStorage === "undefined") return DEFAULT_SCALE;
	try {
		const stored = localStorage.getItem(KEY);
		if (stored !== null) return parseScale(stored);
		const mapped = legacyPitchToScale(localStorage.getItem(LEGACY_KEY));
		return mapped ?? DEFAULT_SCALE;
	} catch {
		return DEFAULT_SCALE;
	}
}

const [scale, setScaleSignal] = createSignal<string>(load());
export { scale };

/** Attribute, signal and storage written from one place, so the document
 *  cannot disagree with the control. */
export function setScale(id: string): void {
	const next = parseScale(id);
	setScaleSignal(next);
	if (typeof document !== "undefined") {
		if (next === DEFAULT_SCALE) document.documentElement.removeAttribute("data-scale");
		else document.documentElement.setAttribute("data-scale", next);
	}
	try {
		localStorage.setItem(KEY, next);
	} catch {
		// Private mode / quota: the choice just won't survive a reload.
	}
}

/** Apply the stored scale at boot. Idempotent. */
export function applyStoredScale(): void {
	setScale(scale());
}
```

- [ ] **Step 4: Add the CSS blocks to `index.css`**

Immediately after the `--row-unit: 4px;` line at `index.css:171` (inside `:root`), add:

```css
	/* THE unit. Every layout-space length in the UI is n × this (see
	   test/unit-lengths.test.ts, which fails the build on a px literal
	   anywhere else). 4px because it is also the stored grid cell
	   (shell/panelCanvas.ts ROW_UNIT_PX / COL_UNIT_PX): at scale 1 one drawn
	   cell is one stored cell and the canvas renders exactly as it always has. */
	--u: 4px;
```

After the closing `}` of the `[data-pitch="040"]` block (`index.css:227`), add:

```css
/* ---------- UI scale ----------
   Readability, not zoom (shell/scale.ts). Each step sets ONLY --u; every
   other length is derived. There is deliberately no [data-scale="100"] block:
   the default is the absence of an override. */
:root[data-scale="075"]  { --u: 3px; }
:root[data-scale="0875"] { --u: 3.5px; }
:root[data-scale="1125"] { --u: 4.5px; }
:root[data-scale="125"]  { --u: 5px; }
:root[data-scale="150"]  { --u: 6px; }
```

- [ ] **Step 5: Replace `DensityToggle` in `Shell.tsx`**

Change the import at line 7 to `import { SCALES, scale, setScale } from "./scale.ts";` and replace the whole `DensityToggle` function (lines 200-230) with:

```tsx
/**
 * How large the UI draws (see shell/scale.ts). A per-device display
 * preference — it changes one custom property on <html> and nothing else, so
 * it sends no code, touches no config overlay, and cannot mark anything
 * unsaved. Card geometry is stored in unit cells, so every card follows the
 * unit and no layout needs re-dragging at any step.
 */
function ScaleToggle() {
	return (
		<div class="scale-toggle" role="group" aria-label="UI scale" title="UI scale — a display preference for this browser">
			<For each={SCALES}>
				{s => (
					<button
						type="button"
						class="scale-opt"
						classList={{ active: scale() === s.id }}
						aria-pressed={scale() === s.id}
						title={`${s.label}%`}
						onClick={() => setScale(s.id)}
					>
						{s.label}
					</button>
				)}
			</For>
		</div>
	);
}
```

Replace the `<DensityToggle />` usage (grep `DensityToggle` in `Shell.tsx`) with `<ScaleToggle />`. In `app.css`, rename the selectors `.pitch-toggle` → `.scale-toggle` and `.pitch-opt` → `.scale-opt` (grep for `pitch-` in `app.css`; there should be no other users).

- [ ] **Step 6: `main.tsx`**

Line 33: `import { applyStoredScale } from './shell/scale.ts'`; line 40: `applyStoredScale()`; update the comment at 37-39 to say "the scale attribute" instead of "the density attribute". Then `git rm packages/ui/src/shell/density.ts packages/ui/test/density.test.ts`.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm test` and `npx tsc -b --force`
Expected: `scale.test.ts` all PASS; no reference to `density.ts` remains (`grep -rn "density.ts\|PITCHES\|setPitch" packages/ui/src packages/ui/test` → nothing). The ratchet test still passes (no px added — the `--u` lines are exempt).

- [ ] **Step 8: Verify byte-identity in the browser**

Start `pnpm dev` (and `pnpm mock` if no board). In headless Edge over CDP, load the Machine screen with `localStorage` cleared, screenshot; then with `localStorage["dwc-ng.scale"]="100"`, screenshot. Expected: identical. Then set `"150"` — expected: nothing changes yet (no token reads `--u` until Task 4). Save the baseline screenshots of Machine, Control, Jobs, System at scale absent into the scratchpad; Tasks 4-8 diff against them.

- [ ] **Step 9: Commit**

```bash
git add -A packages/ui/src/shell/scale.ts packages/ui/test/scale.test.ts packages/ui/src/shell/Shell.tsx packages/ui/src/main.tsx packages/ui/src/index.css packages/ui/src/app.css
git commit -m "feat(ui): stepped UI scale on one unit, replacing the density pitch control"
```

---

### Task 3: Both grid axes draw in `--u`

**Files:**
- Modify: `packages/ui/src/shell/panelCanvas.ts:53-107` (`rowUnitPx` → `unitPx`), `:729`, `:745`, `:1532`, `:1700`
- Modify: `packages/ui/src/shell/PanelCanvas.tsx`
- Modify: `packages/ui/src/dev/LayoutAuditPanel.tsx:8,182`
- Modify: `packages/ui/src/index.css` (`--row-unit` removed from `:root` and from the three pitch blocks)
- Test: `packages/ui/test/panel-canvas.test.ts` (add one), `packages/ui/test/scale.test.ts` (already checks `:root --u == ROW_UNIT_PX`)

**Interfaces:**
- Produces: `export function unitPx(): number` — the drawn size of one stored cell on BOTH axes; falls back to `ROW_UNIT_PX` when `--u` is unreadable. `rowUnitPx` no longer exists.

- [ ] **Step 1: Write the failing test** (append to `panel-canvas.test.ts`)

```ts
test("contentColSpan and headerColSpan convert through unitPx(), not the stored constant", () => {
	const src = readFileSync(fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");
	for (const fn of ["function contentColSpan", "function headerColSpan", "function contentRowSpan"]) {
		const start = src.indexOf(fn);
		assert.ok(start > 0, `${fn} not found`);
		const body = src.slice(start, src.indexOf("\n}", start));
		assert.ok(body.includes("unitPx()"), `${fn} must divide by the drawn unit`);
		assert.ok(!/\/\s*(COL|ROW)_UNIT_PX/.test(body), `${fn} divides by a stored-format constant`);
	}
	assert.ok(!src.includes("rowUnitPx"), "rowUnitPx was renamed to unitPx — no stragglers");
});
```

(Add `import { readFileSync } from "node:fs"; import { fileURLToPath } from "node:url";` at the top if absent.)

- [ ] **Step 2: Run it** — Expected: FAIL (`contentColSpan` divides by `COL_UNIT_PX`; `rowUnitPx` present).

- [ ] **Step 3: Implement**

In `panelCanvas.ts`:
- Rename `rowUnitPx` → `unitPx` everywhere in the file (lines 81, 673-680, 1488, 1633) and read `--u` instead of `--row-unit`:
  ```ts
  export function unitPx(): number {
  	if (typeof document === "undefined") return ROW_UNIT_PX;
  	const raw = getComputedStyle(document.documentElement).getPropertyValue("--u");
  	const px = parseFloat(raw);
  	return Number.isFinite(px) && px > 0 ? px : ROW_UNIT_PX;
  }
  ```
  Rewrite its doc comment (lines 53-79): the unit is DRAWN for both axes; the stored unit is frozen; it is no longer "conservative — chosen from the least-shrinking card", because every layout-space length now scales with it, so there is one rate and no compromise to make.
- `contentColSpan` (line 729) and `headerColSpan` (745): `/ COL_UNIT_PX` → `/ unitPx()`.
- `startMove` (1532) and `startResize` (1700): `(COL_UNIT_PX + GAP_PX)` → `(unitPx + GAP_PX)` — `unitPx` is already the local read once per drag at 1488/1633.
- `COL_UNIT_PX` doc (93-106): note it is now the stored-format column unit, same role as `ROW_UNIT_PX`.

In `PanelCanvas.tsx`: `"grid-template-columns": \`repeat(${GRID_COLS}, var(--u))\``, `"grid-auto-rows": "var(--u)"`; remove the `COL_UNIT_PX` import; rewrite the doc comment: both tracks are `var(--u)`, the drag math reads the same property through `unitPx()`, so cursor and card cannot diverge.

In `LayoutAuditPanel.tsx`: import `unitPx` instead of `rowUnitPx`/`COL_UNIT_PX`; line 182 → `unit {unitPx()}px`.

In `index.css`: delete the `--row-unit` declaration and its comment from `:root` (≈160-171) and the `--row-unit` lines from the three `[data-pitch]` blocks (193, 207, 226). Grep `row-unit` across `packages/ui/src` → nothing.

- [ ] **Step 4: Run tests + typecheck** — `pnpm test`, `npx tsc -b --force`. Expected: all PASS.

- [ ] **Step 5: Browser check**

Dev server, scale absent: screenshot Machine and diff against Task 2's baseline — identical (at `--u: 4px` both tracks are 4px, as before). Set scale `150`: every card's BOX grows 1.5× on both axes (contents do not yet — that is Tasks 4-7). Drag-resize a card at 150: the stop lands where the content ends, not 1.5× past it.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/shell/panelCanvas.ts packages/ui/src/shell/PanelCanvas.tsx packages/ui/src/dev/LayoutAuditPanel.tsx packages/ui/src/index.css packages/ui/test/panel-canvas.test.ts
git commit -m "feat(grid): both axes draw in --u; unitPx() replaces rowUnitPx and the column literal"
```

---

### Task 4: `index.css` tokens in `u`; pitch blocks and `--fs-bump` retired

**Files:**
- Modify: `packages/ui/src/index.css:110-227` and every other px length in the file
- Modify: `packages/ui/src/app.css` — only the 109 `font-size: calc(Npx + var(--fs-bump))` lines and the `--fs-col` / `--tool-col-*` family (`app.css:725-741`, `1433`), because they reference `--fs-bump`
- Modify: `packages/ui/test/unit-lengths.test.ts` (`BASELINE`)

**Conversion rule (used by every remaining task):** a layout-space length `Npx` becomes `calc(N/4 * var(--u))`, written with the quotient as a plain decimal: `16px` → `calc(4 * var(--u))`, `6px` → `calc(1.5 * var(--u))`, `7px` → `calc(1.75 * var(--u))`, `1px` (layout-space, e.g. a 1px gap) → `calc(0.25 * var(--u))`. A font size `calc(Npx + var(--fs-bump))` becomes `calc((N+2)/4 * var(--u))`: `14px` → `calc(4 * var(--u))`, `11.5px` → `calc(3.375 * var(--u))`, `10px` → `calc(3 * var(--u))`, `12.5px` → `calc(3.625 * var(--u))`. Shorthands convert per value: `padding: 12px 16px` → `padding: calc(3 * var(--u)) calc(4 * var(--u))`. `0` stays `0`. Percentages, `vh`, `fr`, `ch`, `em` are untouched.

- [ ] **Step 1: `:root` tokens**

Convert every px token in `:root` (`index.css:110-171`):
- `--fs-bump: 2px;` → delete the declaration and its comment; `--radius: 6px` stays (exempt by use — but to keep the lint simple it is a custom property, so mark the line `/* px-ok: radius never occupies layout space */`).
- `--ctl-h: calc(28px + var(--fs-bump))` → `--ctl-h: calc(7.5 * var(--u))`; `--ctl-gap: 8px` → `calc(2 * var(--u))`.
- Every `--sp-*` token by the rule (`--sp-card-x: 16px` → `calc(4 * var(--u))`, `--sp-card-t: 6px` → `calc(1.5 * var(--u))`, … `--sp-head-h: 36px` → `calc(9 * var(--u))`, `--sp-gutter-b: 14px` → `calc(3.5 * var(--u))`).
- The body rule at 241 `font-size: calc(14px + var(--fs-bump))` → `calc(4 * var(--u))`.
- Any other px in `index.css` outside exempt properties, same rule.

Delete the three `[data-pitch]` blocks (183-227) and the "density overrides" comment; rewrite the "density: the baseline" comment (133-147) to describe the tokens as `u` multiples and point at `shell/scale.ts`.

- [ ] **Step 2: `app.css` font sizes and column tracks**

All 109 `font-size: calc(Npx + var(--fs-bump))` → `calc((N+2)/4 * var(--u))` by the rule. `--fs-col: calc(4 * var(--fs-bump))` (741) was 8px → `calc(2 * var(--u))`; then `--tool-col-heater: calc(152px + var(--fs-col))` → `calc(40 * var(--u))` (152+8=160 → 40u), `--tool-col-active: calc(70px + …)` → `calc(19.5 * var(--u))`, `standby 56` → `calc(16 * var(--u))`, `current 58` → `calc(16.5 * var(--u))`, `set 156` → `calc(41 * var(--u))`, line 1433 `current 50` → `calc(14.5 * var(--u))`; delete `--fs-col`. Grep `fs-bump\|fs-col` across `packages/ui/src` → nothing.

- [ ] **Step 3: Lower the ratchet**

Run `node --conditions=browser --test test/unit-lengths.test.ts`; set `BASELINE` to the printed count. Run `pnpm test` — all PASS (`scale.test.ts` "every spacing token app.css uses is declared" semantics carried over; "no pitch override" test was deleted with density).

- [ ] **Step 4: Browser check**

Scale absent: screenshot Machine/Control/Jobs/System, diff against Task 2 baseline — **identical**. Scale 150: type, controls and spacing are 1.5×; cards keep filling their boxes (the box grew in Task 3). Scale 075: nothing clipped in cards built from tokens (Tools & heaters, Movement, Extruders).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/index.css packages/ui/src/app.css packages/ui/test/unit-lengths.test.ts
git commit -m "feat(css): spacing, control and type tokens in --u; density pitch blocks and --fs-bump retired"
```

---

### Task 5: Borders and hairlines become zero-layout

**Files:**
- Modify: `packages/ui/src/app.css` — the 97 `border`/`border-top`/`border-bottom`/`border-left`/`border-right` declarations with a px width; `packages/ui/src/editor/setup.ts:62`
- Modify: `packages/ui/test/unit-lengths.test.ts` (`BASELINE`)

**Rule.** A border must not occupy layout space, so it is drawn as an inset shadow:

| before | after |
|---|---|
| `border: 1px solid C;` | `box-shadow: inset 0 0 0 1px C;` |
| `border-top: 1px solid C;` | `box-shadow: inset 0 1px 0 C;` |
| `border-bottom: 1px solid C;` | `box-shadow: inset 0 -1px 0 C;` |
| `border-left: 1px solid C;` | `box-shadow: inset 1px 0 0 C;` |
| `border-right: 1px solid C;` | `box-shadow: inset -1px 0 0 C;` |
| `border-bottom: 2px solid C;` (e.g. `app.css:402`) | `box-shadow: inset 0 -2px 0 C;` |
| `border: none;` / `border: 0;` | delete (nothing to remove once no border exists) — but KEEP if it overrides a UA border on `button`/`input`/`select`/`textarea`/`fieldset` |

If the rule already has a `box-shadow`, comma-join: `box-shadow: <existing>, inset 0 0 0 1px C;`. If a `:hover`/`:focus`/`.active` variant changes only the border colour, convert it the same way so the variant still overrides (same property, later/more specific rule wins exactly as before).

Borders on `button`, `input`, `select`, `textarea`: keep a `border: 0;` (UA default removal — `0` has no px and is not a hit) and add the inset shadow. Check each such rule's `padding` — the UA border used to add 2px to the box; after removal the control is 2px smaller. Since `--ctl-h` fixes the height explicitly this only affects width: add `calc(0.25 * var(--u))` to horizontal padding on the rule ONLY if the Task 5 screenshot diff shows a width change; otherwise leave it.

`editor/setup.ts:62` `borderRight: "1px solid var(--hairline)"` → `boxShadow: "inset -1px 0 0 var(--hairline)"`.

- [ ] **Step 1: Convert** — work top-to-bottom through `grep -n "border\(-top\|-bottom\|-left\|-right\)\?: *[0-9]" packages/ui/src/app.css`, one Edit per rule.

- [ ] **Step 2: Lower the ratchet** — run the lint, set `BASELINE`; `pnpm test` PASS.

- [ ] **Step 3: Browser check — the one that can fail**

Scale absent: screenshot the four screens and diff against the Task 2 baseline. Expected: **every card is now 2px shorter and 2px narrower than baseline** (the border no longer adds to the box), hairlines are in the same places, nothing else moved. That 2px delta is the expected and only difference; anything else is a mis-conversion. Re-take the baselines after this task (they are the new reference for Tasks 6-8). Inspect the Tools & heaters table and the file list: row hairlines present, rows evenly pitched.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/app.css packages/ui/src/editor/setup.ts packages/ui/test/unit-lengths.test.ts
git commit -m "feat(css): borders and hairlines drawn as inset shadows — exempt from scale, zero layout space"
```

---

### Task 6: `app.css` — remaining layout lengths in `u` (first half, lines 1–1800)

**Files:**
- Modify: `packages/ui/src/app.css:1-1800`
- Modify: `packages/ui/test/unit-lengths.test.ts` (`BASELINE`)

- [ ] **Step 1: Convert** every remaining non-exempt px in lines 1–1800 by the Task 4 rule. Specific cases:
  - `min-height`/`min-width`/`height`/`width` floors on charts, viewports, canvases (e.g. `.temp-chart { min-height: 150px }` → `calc(37.5 * var(--u))`) — these are exactly the 17-card floors from FINDING 2 and are the point of the exercise.
  - `letter-spacing: Npx` → `u` rule (it scales).
  - `@media (max-width: Npx)` preludes: leave (exempt).
  - `border-radius`, `box-shadow`, `outline`, `text-shadow`, `filter`: leave.
  - `.scale-opt`, `.panel-resize-grip`, `.estop` blocks: these must NOT scale (scale.test.ts asserts it). Mark each px line in them `/* px-ok: hit target that must not follow the scale it controls */`.
  - `.panel-canvas` / card margins already use `--sp-stack`; nothing to do.
  - Dense dotted/hatched backgrounds (`background-size: Npx`): convert (they are visual texture tied to the grid).
- [ ] **Step 2: Lower the ratchet**; `pnpm test` PASS.
- [ ] **Step 3: Browser check** — scale absent: identical to the Task 5 baseline. Scale 150 and 075: Temperatures, Camera, Toolpath, Jobs, Macros, System files, Object model, Sensors, Firmware update — each card's content fills its box with no clipped control and no hidden-scroll truncation (check `.panel-body` `scrollHeight <= clientHeight` via CDP for each card on each screen at both scales; record the numbers).
- [ ] **Step 4: Commit** — `git commit -m "feat(css): app.css 1-1800 layout lengths in --u"`

---

### Task 7: `app.css` — remaining layout lengths in `u` (second half, lines 1800–end) and `paletteLab.css`

**Files:**
- Modify: `packages/ui/src/app.css:1800-end`, `packages/ui/src/dev/paletteLab.css`
- Modify: `packages/ui/test/unit-lengths.test.ts` (`BASELINE`)

- [ ] **Step 1: Convert** exactly as Task 6 Step 1, for the rest of `app.css` and all 17 tokens in `paletteLab.css`.
- [ ] **Step 2: Lower the ratchet**; `pnpm test` PASS. Expected remaining hits: only TS/TSX files.
- [ ] **Step 3: Browser check** — scale absent identical to the Task 5 baseline; at 150/075 repeat the `scrollHeight <= clientHeight` sweep for every card on every screen plus the Card Lab and Palette Lab.
- [ ] **Step 4: Commit** — `git commit -m "feat(css): app.css 1800-end and paletteLab.css layout lengths in --u"`

---

### Task 8: TS/TSX literals; the `px-ok` allowlist; ratchet to zero

**Files:**
- Modify: the 21 TS/TSX files reported by the lint (list from the lint output; known members: `compose/ComposedScreen.tsx`, `editor/setup.ts:46`, `charts/TemperatureChart.tsx`, `files/FileBrowserView.tsx`, `heightmap/*.ts(x)`, `cards/*.tsx`, `shell/edgeScroll.ts:41,100,165`, `shell/panelCanvas.ts:436,452`, `shell/copyText.ts`, `dev/layoutAudit.ts`, `compose/defs.ts`, `config/parse.ts`, `compose/screens.ts`, `compose/controls/builtin.ts`)
- Modify: `packages/ui/test/unit-lengths.test.ts` — `BASELINE` → delete the constant; assert `hits.length === 0`

Triage each hit into exactly one of:
1. **Prose in a comment** (e.g. `ComposedScreen.tsx:121-122` "cost 36px") — not a hit if inside a block comment; for `//` line comments, reword or leave (`findPxHits` only blanks block comments — extend `stripBlockComments` to also blank `//` comments in `.ts/.tsx` files, with a unit test that a `// 36px` line is not a hit).
2. **Layout-space length** (inline `style`, a canvas floor, CodeMirror `fontSize: "13px"`): convert to `calc(n * var(--u))` strings. `editor/setup.ts:46` `fontSize: "13px"` → `"calc(3.25 * var(--u))"`. A chart or heightmap that sizes a bitmap from a px constant reads `unitPx()` instead and multiplies.
3. **Pointer physics / screen px**: `edgeScroll.ts:41 EDGE_MIN_PX`, `:100 LINE_HEIGHT_PX`, `:165 --edge-w`, `panelCanvas.ts:436 EDGE_ZONE_PX`, `:452 EDGE_MAX_STEP_PX`, `copyText.ts` (if it is an off-screen textarea), `config/parse.ts` (if it is a validator bound) — mark `/* px-ok: pointer physics — about the hand, not the layout */` (or the accurate reason).
4. **Stored-format constants** (`ROW_UNIT_PX = 4`, `COL_UNIT_PX = 4`, `compose/defs.ts` sizes) — these are numbers, not `px` tokens, so they are not hits; if a comment says "4px" in a `//` comment it is case 1.

- [ ] **Step 1: Extend the lint for `//` comments** (test first):

```ts
test("findPxHits: a // comment in TS is not a hit", () => {
	const r = findPxHits("x.ts", "const a = 1; // was 36px\nconst b = { width: \"8px\" };");
	assert.deepEqual(r.hits.map(h => h.line), [2]);
});
```
Implement: in `findPxHits`, for non-CSS files, blank `//.*$` per line before scanning (keep the original for reporting).

- [ ] **Step 2: Triage and convert** every remaining hit per the four cases.
- [ ] **Step 3: Ratchet to zero** — replace the `BASELINE` mechanism:

```ts
assert.equal(hits.length, 0, `${hits.length} layout-space px literals:\n${sample}`);
```
and delete the `BASELINE` constant and its comment (the doc comment keeps the sentence about the ratchet as history). Run `pnpm test` — PASS, and the printed `px-ok` list is reviewed: every line's reason must be one of pointer physics, hit target, radius, or breakpoint.

- [ ] **Step 4: Typecheck + build** — `npx tsc -b --force`, `pnpm build`. PASS.
- [ ] **Step 5: Browser check** — scale absent identical to Task 5 baseline; at 150 the CodeMirror editor text is 1.5×; toolpath/heightmap/camera viewports fill their cards at 075 and 150.
- [ ] **Step 6: Commit** — `git commit -m "feat(ui): last px literals in TS converted or allowlisted; the px lint ratchets to zero"`

---

### Task 9: Card Lab scale sweep — the claim as an assertion

**Files:**
- Modify: `packages/ui/src/dev/layoutAudit.ts` (pure judgement), `packages/ui/src/dev/LayoutAuditPanel.tsx` (driver)
- Test: `packages/ui/test/layout-audit.test.ts`

**Interfaces:**
- Produces: `export function judgeScaleInvariance(a: { rows: number; cols: number }, b: { rows: number; cols: number }, tolerance = 1): { ok: boolean; rowDelta: number; colDelta: number }` in `layoutAudit.ts`.

- [ ] **Step 1: Write the failing test** (append to `layout-audit.test.ts`)

```ts
import { judgeScaleInvariance } from "../src/dev/layoutAudit.ts";

test("judgeScaleInvariance: floors equal within one cell pass; two cells fail", () => {
	assert.equal(judgeScaleInvariance({ rows: 53, cols: 156 }, { rows: 54, cols: 156 }).ok, true);
	assert.equal(judgeScaleInvariance({ rows: 53, cols: 156 }, { rows: 55, cols: 156 }).ok, false);
	const r = judgeScaleInvariance({ rows: 53, cols: 156 }, { rows: 53, cols: 160 });
	assert.equal(r.ok, false);
	assert.equal(r.colDelta, 4);
});
```

- [ ] **Step 2: Run** — FAIL (`judgeScaleInvariance` not exported).

- [ ] **Step 3: Implement** in `layoutAudit.ts`:

```ts
/**
 * The scale invariant, as a judgement that can fail: a card's floor in STORED
 * cells must be the same at every scale, ±1 for Math.ceil at a non-integer
 * unit. A failure names a card that still contains a layout-space pixel the
 * px lint could not see — a bitmap sized by script, a third-party stylesheet.
 */
export function judgeScaleInvariance(
	a: { rows: number; cols: number },
	b: { rows: number; cols: number },
	tolerance = 1,
): { ok: boolean; rowDelta: number; colDelta: number } {
	const rowDelta = Math.abs(a.rows - b.rows);
	const colDelta = Math.abs(a.cols - b.cols);
	return { ok: rowDelta <= tolerance && colDelta <= tolerance, rowDelta, colDelta };
}
```

- [ ] **Step 4: Drive it from the Card Lab**

In `LayoutAuditPanel.tsx`, add a "Scale sweep" button beside the existing audit. On click, for each card in the lab: set `document.documentElement.setAttribute("data-scale", "075")`, `await` two animation frames, measure `contentRowSpan`/`contentColSpan`; repeat at `"150"`; restore the previous attribute (or remove it); judge; render a row per card with `ok`, `rowDelta`, `colDelta` in a reserved-width table (tabular-nums, no reflow as results arrive). Do not destructure props; render the rows with `<For>`.

- [ ] **Step 5: Run it in the browser** — every card `ok`. Any failure: find the pixel (inspect the card at both scales for an element whose height does not scale), fix in `app.css`/the card, re-run. Record the final table in the commit message body.

- [ ] **Step 6: `pnpm test`, typecheck, commit**

```bash
git commit -m "feat(dev): Card Lab scale sweep — asserts every card's cell floor is equal at 0.75 and 1.5"
```

---

### Task 10: Docs, verification, ship

**Files:**
- Modify: `CLAUDE.md` (one line under "Architecture requirements": the scaling constraint is met by the `--u` design; point at the spec), `docs/invariant-register.md` (register `unit-lengths` as the enforcement for the scaling constraint, rung 7: build-failing lint)
- Modify: the `DensityToggle`/density references in any `docs/*.md` that describe the control (grep `density\|pitch` in `docs/` excluding `superpowers/specs`)

- [ ] **Step 1: Full gate** — `pnpm test`, `npx tsc -b --force`, `pnpm build`. All clean. Note eager/total gz sizes from the build output.
- [ ] **Step 2: Live verification in Edge (CDP), each check can fail:**
  1. Fresh profile → scale control shows 100 active; `data-scale` absent on `<html>`.
  2. Seed `localStorage["dwc-ng.density-pitch"]="050"` with no `dwc-ng.scale`, reload → 75 active, `data-scale="075"`.
  3. Drag a card to its floor at 100. Switch to 075, then 150: the card's content fits at both (`scrollHeight <= clientHeight` on its `.panel-body`), the stored rect is unchanged (read `localStorage["dwc-ng.canvas.<screen>"]` before/after — byte-equal).
  4. At 150 on a 1280-wide window and at 075 on a 400-wide window (mobile), the preflight strip, rail, console drawer and e-stop are all usable; e-stop and resize grips are the same pixel size at both.
  5. Live polling against the mock for 60 s at 075 — no jitter or reflow in the DRO and temperature cards (positional-stability rule).
- [ ] **Step 3: Ship**

```bash
pnpm build
pnpm ship --target http://duet3.nydick.net --mode dsf
```
Gabe verifies on the printer.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md docs/invariant-register.md docs
git commit -m "docs: scaling constraint is met by the global unit; register the px lint"
```

---

## Self-review

**Spec coverage.** One unit + steps (T2, T4); exemption rule and zero-layout borders (T5, lint exempt list T1); the control, storage key, legacy mapping, toggle, deleted shell note (T2); both grid axes in `--u`, no migration, `contentColSpan` via `unitPx()`, migration uses the frozen constant (T3, tests in T2/T3); stylesheet pass incl. `--fs-bump`, column tracks, CodeMirror (T4-T8); lint first then ratchet to zero with a visible allowlist (T1, T8); scale sweep ±1 (T9); pixel identity at scale 1 (T2 baseline, every task diffs; T5 documents the expected 2px border delta); manual Edge pass at 0.75/1.5 desktop and mobile (T10); out-of-scope items untouched.

**Known deviation from the spec, deliberate:** the spec says the lint is "written first, red". A red test on every intermediate commit would break `pnpm test`; the plan uses the project's existing debt-ratchet shape instead (baseline counts down, reaches 0 in T8), which keeps each commit green and still makes migration completeness a counted fact.

**Placeholders.** None; every conversion has its rule and every test its code.

**Type consistency.** `unitPx()` defined T3, used T3/T8/T9; `SCALES/DEFAULT_SCALE/parseScale/legacyPitchToScale/scale/setScale/applyStoredScale` defined T2, used T2; `findPxHits`/`Hit` defined T1, extended T8; `judgeScaleInvariance` defined and used T9.
