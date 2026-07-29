# Movement Jog Step Banks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Movement card's Step chips and `−/+` pair with a per-axis bank of six jog buttons whose offsets are individually editable and stored in the config overlay.

**Architecture:** Two new node types extend the existing data-driven control vocabulary (`compose/controls/`), so the Movement card stays written *in* that vocabulary rather than escaping to hand-written JSX. Offsets live in the config overlay keyed by axis letter, parsed at the untrusted boundary like every other overlay section. Buttons emit through `control/commands.ts` unchanged — no new G-code.

**Tech Stack:** SolidJS + TypeScript, Vite, pnpm workspace. Tests: `node:test` via `node --conditions=browser --test`.

## Global Constraints

- **Line endings are CRLF.** Every file under `packages/ui/src` is CRLF. Use the Edit tool. A Python text-mode write or an LF-normalising script produces a whole-file diff.
- **Never destructure props** in Solid components (kills reactivity). Use `props.x` or `splitProps`.
- Use `<Show>` / `<For>` / `<Switch>` in JSX — never early returns or `.map`.
- **Controls are 1:1 with G-code.** No GUI-side safeties, gating, or verdicts. Firmware is the authority.
- **No new dependencies.**
- Every walk over parsed-but-unvalidated data goes through `safeEntries()` from `src/util/safeObject.ts`. `Object.entries` is for trusted, locally-constructed records only.
- Typecheck: `pnpm --filter @dwc-ng/ui exec tsc -b --force` (plain `npx tsc --noEmit` checks zero files here).
- Full suite: `pnpm test` from the repo root. Single file: `cd packages/ui && node --conditions=browser --test "test/<name>.test.ts"`.
- Baseline at plan start: 636 tests passing.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/src/config/types.ts` | `AxisSteps` type, `DEFAULT_AXIS_STEPS`, `UiConfig.axisSteps`, `DEFAULT_CONFIG.axisSteps` |
| `packages/ui/src/config/parse.ts` | `asAxisSteps` + `parseAxisSteps` at the untrusted boundary |
| `packages/ui/src/config/store.ts` | `setAxisSteps` / `clearAxisSteps` on `ConfigApi` |
| `packages/ui/src/compose/controls/spec.ts` | `axis-step-bank` + `steps-edit-toggle` node types, compile-time validation |
| `packages/ui/src/compose/controls/parse.ts` | Import validation for both new node types |
| `packages/ui/src/compose/share.ts` | `reviewSpec` inventory for both new node types |
| `packages/ui/src/compose/controls/ControlList.tsx` | `editingSteps` signal, bank + toggle rendering |
| `packages/ui/src/compose/controls/builtin.ts` | `MOVEMENT_SPEC` rewritten to use the bank |
| `packages/ui/src/app.css` | `.step-table`, `.step-cell`, `.step-input` geometry |
| `packages/ui/test/axis-steps.test.ts` | New: parse + store behaviour |
| `packages/ui/test/control-spec.test.ts` | Modify: weld table + `extractButtons` cases |
| `packages/ui/test/custom-cards.test.ts` | Modify: import validation for new nodes |
| `packages/ui/test/share.test.ts` | Modify: review inventory round-trip |

---

### Task 1: `AxisSteps` type, default, and the untrusted-boundary parser

**Files:**
- Modify: `packages/ui/src/config/types.ts` (add type + `UiConfig` field + `DEFAULT_CONFIG` field)
- Modify: `packages/ui/src/config/parse.ts` (add `asAxisSteps`, `parseAxisSteps`, wire into `parseOverlay`)
- Test: `packages/ui/test/axis-steps.test.ts` (create)

**Interfaces:**
- Consumes: `isPlainObject`, `safeEntries` from `src/util/safeObject.ts`; `ConfigOverlay` from `config/types.ts`
- Produces:
  - `export type AxisSteps = readonly [number, number, number, number, number, number]`
  - `export const DEFAULT_AXIS_STEPS: AxisSteps`
  - `UiConfig["axisSteps"]: Record<string, AxisSteps>`
  - `export function asAxisSteps(value: unknown): AxisSteps | null`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/axis-steps.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { asAxisSteps, parseOverlay } from "../src/config/parse.ts";
import { DEFAULT_AXIS_STEPS, DEFAULT_CONFIG } from "../src/config/types.ts";

test("asAxisSteps accepts exactly six finite numbers", () => {
	assert.deepEqual(asAxisSteps([-100, -10, -1, 1, 10, 100]), [-100, -10, -1, 1, 10, 100]);
	// Zero, fractional and asymmetric sides are all legal — the label states
	// exactly what will be sent, and firmware is the authority on the move.
	assert.deepEqual(asAxisSteps([-0.02, -0.1, 0, 0.1, 1, 25.4]), [-0.02, -0.1, 0, 0.1, 1, 25.4]);
});

test("asAxisSteps rejects anything that is not six finite numbers", () => {
	for (const bad of [
		null, undefined, "nope", 42, {}, { 0: 1 },
		[], [1, 2, 3], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7],
		[1, 2, 3, 4, 5, "6"], [1, 2, 3, 4, 5, null],
		[1, 2, 3, 4, 5, Number.NaN], [1, 2, 3, 4, 5, Number.POSITIVE_INFINITY],
	]) {
		assert.equal(asAxisSteps(bad), null, `expected null for ${JSON.stringify(bad)}`);
	}
});

test("arity is checked, never padded — a short tuple is dropped whole", () => {
	// Padding would put a fabricated offset on a motion control.
	assert.equal(asAxisSteps([-10, -1, -0.1, 0.1, 1]), null);
});

test("parseOverlay keeps good axes and drops bad ones individually", () => {
	const overlay = parseOverlay({
		axisSteps: {
			X: [-100, -10, -1, 1, 10, 100],
			Z: [-10, -1, -0.1, 0.1, 1, 10],
			U: "garbage",
			V: [1, 2, 3],
		},
	});
	assert.deepEqual(overlay.axisSteps, {
		X: [-100, -10, -1, 1, 10, 100],
		Z: [-10, -1, -0.1, 0.1, 1, 10],
	});
});

test("parseOverlay drops prototype-reaching keys via safeEntries", () => {
	const overlay = parseOverlay(JSON.parse('{"axisSteps":{"__proto__":[1,2,3,4,5,6],"X":[1,2,3,4,5,6]}}'));
	assert.deepEqual(overlay.axisSteps, { X: [1, 2, 3, 4, 5, 6] });
	assert.equal(({} as Record<string, unknown>)["0"], undefined, "prototype must be unpolluted");
});

test("an axisSteps section with nothing valid is omitted, not left empty", () => {
	assert.equal(parseOverlay({ axisSteps: { X: "bad" } }).axisSteps, undefined);
	assert.equal(parseOverlay({ axisSteps: "bad" }).axisSteps, undefined);
});

test("the shipped default is six offsets and DEFAULT_CONFIG customises nothing", () => {
	assert.deepEqual(DEFAULT_AXIS_STEPS, [-100, -10, -1, 1, 10, 100]);
	assert.deepEqual(DEFAULT_CONFIG.axisSteps, {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test "test/axis-steps.test.ts"`
Expected: FAIL — `asAxisSteps` and `DEFAULT_AXIS_STEPS` are not exported.

- [ ] **Step 3: Add the type, default, and config field**

In `packages/ui/src/config/types.ts`, above `export interface UiConfig`:

```ts
/** Six signed jog offsets for one axis, in rendered order (left to right). */
export type AxisSteps = readonly [number, number, number, number, number, number];

/**
 * What every axis renders until the operator tunes it.
 *
 * Deliberately uniform across axes. Deriving finer offsets for leadscrews
 * from axis range would be the GUI guessing at a workflow, and M208 limits
 * are what actually decide whether a jog is legal. One predictable default
 * the operator adjusts beats a clever one they have to reverse-engineer.
 *
 * The ONE place this is written down — rendering reads
 * `config.axisSteps[letter] ?? DEFAULT_AXIS_STEPS`, so there is no second
 * site where a different default could appear.
 */
export const DEFAULT_AXIS_STEPS: AxisSteps = [-100, -10, -1, 1, 10, 100];
```

Inside `UiConfig`, directly after the `axisRoles` field:

```ts
	/** Axis letter → its six jog offsets. RRF has no notion of a "jog step";
	 * this is per-machine UI metadata, like axisRoles above. */
	axisSteps: Record<string, AxisSteps>;
```

Inside `DEFAULT_CONFIG`, directly after `axisRoles: {},`:

```ts
	axisSteps: {},
```

- [ ] **Step 4: Add the parser**

In `packages/ui/src/config/parse.ts`, add after `asSlotRect`:

```ts
/**
 * Six finite numbers, or null. Arity is CHECKED rather than padded: a
 * five-entry tuple padded to six would put a fabricated offset on a motion
 * control.
 */
export function asAxisSteps(value: unknown): AxisSteps | null {
	if (!Array.isArray(value) || value.length !== 6) return null;
	if (value.some(v => typeof v !== "number" || !Number.isFinite(v))) return null;
	return [value[0], value[1], value[2], value[3], value[4], value[5]] as AxisSteps;
}
```

Add beside `parseAxisRoles`:

```ts
function parseAxisSteps(raw: unknown): ConfigOverlay["axisSteps"] {
	if (!isPlainObject(raw)) return undefined;
	const out: Record<string, AxisSteps> = {};
	for (const [key, value] of safeEntries(raw)) {
		const steps = asAxisSteps(value);
		if (steps !== null) out[key] = steps;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}
```

Add `AxisSteps` to the type import from `./types.ts`, and add to the `sections` object in `parseOverlay`, directly after `axisRoles`:

```ts
		axisSteps: parseAxisSteps(raw.axisSteps),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/ui && node --conditions=browser --test "test/axis-steps.test.ts"`
Expected: PASS, 7 tests.

Then: `pnpm --filter @dwc-ng/ui exec tsc -b --force`
Expected: exit 0, no output. (`DEFAULT_CONFIG` is typed `UiConfig`, so a missing `axisSteps` would be a compile error here.)

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config/types.ts packages/ui/src/config/parse.ts packages/ui/test/axis-steps.test.ts
git commit -m "feat(config): per-axis jog offsets in the overlay

Six finite numbers per axis letter, parsed at the untrusted boundary like
every other overlay section. Arity is checked rather than padded: a short
tuple is dropped whole, because padding would put a fabricated offset on a
motion control."
```

---

### Task 2: Config store setter and clearer

**Files:**
- Modify: `packages/ui/src/config/store.ts` (`ConfigApi` interface ~line 34, implementation ~line 174)
- Test: `packages/ui/test/axis-steps.test.ts` (append)

**Interfaces:**
- Consumes: `AxisSteps` from Task 1; the store's existing `apply(draft => …)` helper
- Produces: `ConfigApi["setAxisSteps"](letter: string, steps: AxisSteps): void`, `ConfigApi["clearAxisSteps"](letter: string): void`

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/axis-steps.test.ts` (mirror the setup used by the existing `test/config.test.ts` for constructing a store; read that file first and copy its harness verbatim):

```ts
test("setAxisSteps writes the overlay and marks config dirty", () => {
	const store = makeTestConfigStore();           // same harness as config.test.ts
	assert.equal(store.dirty, false);
	store.setAxisSteps("Z", [-10, -1, -0.1, 0.1, 1, 10]);
	assert.deepEqual(store.config.axisSteps.Z, [-10, -1, -0.1, 0.1, 1, 10]);
	assert.equal(store.dirty, true, "an edit must arm Save to machine");
});

test("clearAxisSteps drops the overlay entry so the code default returns", () => {
	const store = makeTestConfigStore();
	store.setAxisSteps("Z", [-10, -1, -0.1, 0.1, 1, 10]);
	store.clearAxisSteps("Z");
	assert.equal(store.config.axisSteps.Z, undefined);
	assert.deepEqual(DEFAULT_CONFIG.axisSteps, {}, "defaults must never be mutated");
});

test("an untouched axis is absent from the overlay, not written as a default copy", () => {
	const store = makeTestConfigStore();
	store.setAxisSteps("Z", [-10, -1, -0.1, 0.1, 1, 10]);
	assert.equal(store.config.axisSteps.X, undefined,
		"only edited axes are stored — the default lives in code");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test "test/axis-steps.test.ts"`
Expected: FAIL — `store.setAxisSteps is not a function`.

- [ ] **Step 3: Add the setters**

In `packages/ui/src/config/store.ts`, in the `ConfigApi` interface directly after `clearAxisRole`:

```ts
	setAxisSteps(letter: string, steps: AxisSteps): void;
	clearAxisSteps(letter: string): void;
```

In the implementation object directly after `clearAxisRole`:

```ts
		setAxisSteps(letter, steps) {
			apply(draft => { (draft.axisSteps ??= {})[letter] = steps; });
		},
		clearAxisSteps(letter) {
			apply(draft => { delete draft.axisSteps?.[letter]; });
		},
```

Add `AxisSteps` to the existing type import from `./types.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ui && node --conditions=browser --test "test/axis-steps.test.ts"`
Expected: PASS, 10 tests.

Run: `pnpm test`
Expected: 646 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/config/store.ts packages/ui/test/axis-steps.test.ts
git commit -m "feat(config): setAxisSteps / clearAxisSteps on the overlay

Overlay-on-defaults: only edited axes are stored, so clearing restores the
code default rather than a second copy of it."
```

---

### Task 3: The two vocabulary node types

**Files:**
- Modify: `packages/ui/src/compose/controls/spec.ts` (`ControlNode` union, `CompiledNode` union, `compileNode` switch)
- Test: `packages/ui/test/control-spec.test.ts` (append)

**Interfaces:**
- Consumes: the existing `needInput(name, where)` compile-time validator
- Produces: `{ type: "axis-step-bank"; axisVar: string; feed: string }` and `{ type: "steps-edit-toggle"; label: string }` in both the authored and compiled unions. Neither carries a template — the bank emits via `cmd.jog` in the renderer, exactly like `axis-jog`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/control-spec.test.ts`:

```ts
test("axis-step-bank compiles and validates its feed input reference", () => {
	const spec = compileControlSpec({
		inputs: { feed: { kind: "number", label: "Feed", default: 6000 } },
		nodes: [{ type: "axis-step-bank", axisVar: "axis", feed: "feed" }],
	});
	assert.equal(spec.nodes[0]!.type, "axis-step-bank");
});

test("axis-step-bank naming an unknown input throws a path-named error", () => {
	assert.throws(
		() => compileControlSpec({
			inputs: {},
			nodes: [{ type: "axis-step-bank", axisVar: "axis", feed: "nope" }],
		}),
		/nodes\[0\]\.feed: unknown input "nope"/,
	);
});

test("steps-edit-toggle compiles", () => {
	const spec = compileControlSpec({
		inputs: {},
		nodes: [{ type: "steps-edit-toggle", label: "Steps" }],
	});
	assert.equal(spec.nodes[0]!.type, "steps-edit-toggle");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test "test/control-spec.test.ts"`
Expected: FAIL — TypeScript rejects the literal, or the compile switch has no case.

- [ ] **Step 3: Add both variants to the unions and the compiler**

In `packages/ui/src/compose/controls/spec.ts`, add to the `ControlNode` union directly after the `axis-jog` line:

```ts
	| { type: "axis-step-bank"; axisVar: string; feed: string }
	| { type: "steps-edit-toggle"; label: string }
```

Add the identical two lines to the `CompiledNode` union after its `axis-jog` line. (Neither node carries a template, so the authored and compiled shapes are the same — as with `jog-pad` and `axis-jog`.)

In `compileNode`, after the `axis-jog` case:

```ts
			case "axis-step-bank":
				needInput(node.feed, `${where}.feed`);
				return node;
			case "steps-edit-toggle":
				return node;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ui && node --conditions=browser --test "test/control-spec.test.ts"`
Expected: PASS.

Run: `pnpm --filter @dwc-ng/ui exec tsc -b --force`
Expected: **FAIL**, and this is correct. `compose/share.ts` and `ControlList.tsx` both end their node switch with `unreachable(node)`, so a new variant is a compile error until inventoried. Note the reported files — Task 4 and Task 5 fix them. Do not suppress these errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/compose/controls/spec.ts packages/ui/test/control-spec.test.ts
git commit -m "feat(controls): axis-step-bank and steps-edit-toggle node types

Compile-time validation of the feed reference, so a spec naming a
nonexistent input throws at module load rather than rendering a broken
control. The totality welds in share.ts and ControlList.tsx now fail to
compile until both are inventoried — by design."
```

---

### Task 4: Import validation and share review

**Files:**
- Modify: `packages/ui/src/compose/controls/parse.ts` (node switch ~line 84)
- Modify: `packages/ui/src/compose/share.ts` (`reviewSpec` walk ~line 73)
- Test: `packages/ui/test/custom-cards.test.ts`, `packages/ui/test/share.test.ts` (append)

**Interfaces:**
- Consumes: `asString` / `fail` helpers already in `controls/parse.ts`; the `review.motion: string[]` field in `share.ts`
- Produces: both node types importable and inventoried. `reviewSpec` lists `axis-step-bank` under `motion`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/test/custom-cards.test.ts`:

```ts
test("axis-step-bank imports with its axisVar and feed", () => {
	const parsed = parseControlSpecText(
		'{"inputs":{"feed":{"kind":"number","label":"Feed","default":6000}},' +
		'"nodes":[{"type":"axis-step-bank","axisVar":"axis","feed":"feed"}]}',
	);
	assert.equal("error" in parsed, false, JSON.stringify(parsed));
});

test("axis-step-bank missing its axisVar is a named error, not a silent import", () => {
	const parsed = parseControlSpecText(
		'{"inputs":{"feed":{"kind":"number","label":"Feed","default":6000}},' +
		'"nodes":[{"type":"axis-step-bank","feed":"feed"}]}',
	);
	assert.match((parsed as { error: string }).error, /axisVar/);
});

test("steps-edit-toggle imports with its label", () => {
	const parsed = parseControlSpecText('{"inputs":{},"nodes":[{"type":"steps-edit-toggle","label":"Steps"}]}');
	assert.equal("error" in parsed, false, JSON.stringify(parsed));
});
```

Append to `packages/ui/test/share.test.ts`:

```ts
test("reviewSpec inventories axis-step-bank as a motion primitive", () => {
	const spec = compileControlSpec({
		inputs: { feed: { kind: "number", label: "Feed", default: 6000 } },
		nodes: [{ type: "axis-step-bank", axisVar: "axis", feed: "feed" }],
	});
	const review = reviewSpec(spec);
	assert.equal(review.motion.length, 1);
	assert.match(review.motion[0]!, /axis-step-bank/);
	assert.match(review.motion[0]!, /cmd\.jog/);
});

test("steps-edit-toggle is inventoried and moves nothing", () => {
	const spec = compileControlSpec({ inputs: {}, nodes: [{ type: "steps-edit-toggle", label: "Steps" }] });
	assert.deepEqual(reviewSpec(spec).motion, [],
		"a view-mode toggle must not be declared as motion");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/ui && node --conditions=browser --test "test/custom-cards.test.ts" "test/share.test.ts"`
Expected: FAIL — unknown node type on import; `unreachable` throws in `reviewSpec`.

- [ ] **Step 3: Add the import cases**

In `packages/ui/src/compose/controls/parse.ts`, after the `axis-jog` case:

```ts
		case "axis-step-bank":
			return {
				type,
				axisVar: asString(o.axisVar, `${where}.axisVar`),
				feed: asString(o.feed, `${where}.feed`),
			};
		case "steps-edit-toggle":
			return { type, label: asString(o.label, `${where}.label`) };
```

Also add both strings to the accepted-type list this switch validates against, if `controls/parse.ts` keeps one (grep for `"axis-jog"` in that file and mirror every occurrence).

- [ ] **Step 4: Add the review cases**

In `packages/ui/src/compose/share.ts`, after the `axis-jog` case:

```ts
			case "axis-step-bank":
				review.motion.push(`axis-step-bank (cmd.jog on {${node.axisVar}}, 6 offsets)`);
				return;
			case "steps-edit-toggle":
				// A view mode, not a control that reaches the machine. Listed
				// nowhere in `motion` on purpose — declaring it as motion would
				// make the import review cry wolf.
				return;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/ui && node --conditions=browser --test "test/custom-cards.test.ts" "test/share.test.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/compose/controls/parse.ts packages/ui/src/compose/share.ts packages/ui/test/custom-cards.test.ts packages/ui/test/share.test.ts
git commit -m "feat(controls): import + review support for the step bank

A shared card containing a bank now discloses that it moves the machine.
The edit toggle is deliberately absent from the motion inventory."
```

---

### Task 5: Render the bank and the toggle

**Files:**
- Modify: `packages/ui/src/compose/controls/ControlList.tsx` (add signal near the `inputs` store ~line 33; add two cases to the `RenderNode` switch after `axis-jog` ~line 129)
- Modify: `packages/ui/src/app.css` (add `.step-table` block near the existing `.jog-table` block)
- Test: manual verification in Chrome (Task 6 covers the automated weld)

**Interfaces:**
- Consumes: `cmd.jog(axis: string, delta: number, feed: number): string`; `props.ctx.config.config.axisSteps`; `props.ctx.config.setAxisSteps`; `DEFAULT_AXIS_STEPS`
- Produces: rendered `.step-row` elements inside a `.step-table` grid; card-local `editingSteps` signal

- [ ] **Step 1: Add the card-local edit signal**

In `ControlList`, directly after the `inputs` store is created:

```tsx
	// Card-local and NEVER persisted: this is a transient view mode. A card
	// that reloaded into edit mode would present text fields where the
	// operator expects jog buttons.
	const [editingSteps, setEditingSteps] = createSignal(false);
```

Ensure `createSignal` is in the `solid-js` import.

- [ ] **Step 2: Render both nodes**

Add to the `RenderNode` switch, after the `axis-jog` case:

```tsx
			case "axis-step-bank": {
				const item = createMemo(() => {
					const value = p.vars[node.axisVar];
					return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
				});
				const letter = (): string => String(item().letter ?? "");
				const role = (): string | undefined => props.ctx.config.config.axisRoles[letter()];
				const feed = (): number => inputs[node.feed] ?? 0;
				// The ONE read of the default — see DEFAULT_AXIS_STEPS' doc.
				const steps = (): AxisSteps => props.ctx.config.config.axisSteps[letter()] ?? DEFAULT_AXIS_STEPS;
				const commit = (index: number, raw: string): void => {
					const value = Number(raw);
					// Refuse rather than coerce: a clamped or rounded value would
					// make a button lie about the move it sends.
					if (raw.trim() === "" || !Number.isFinite(value)) return;
					const next = [...steps()] as [number, number, number, number, number, number];
					next[index] = value;
					props.ctx.config.setAxisSteps(letter(), next);
				};
				return (
					<div class="step-row">
						<span class="ctl-name">{letter()}<Show when={role()}>{r => <small>{r()}</small>}</Show></span>
						<For each={[...steps()]}>
							{(offset, index) => (
								<Show
									when={editingSteps()}
									fallback={
										<GcodeButton
											class="step-cell"
											label={offset > 0 ? `+${offset}` : String(offset)}
											command={cmd.jog(letter(), offset, feed())}
											stamp={false}
										/>
									}
								>
									<input
										class="step-input"
										type="text"
										inputmode="decimal"
										aria-label={`${letter()} step ${index() + 1}`}
										value={String(offset)}
										onChange={e => commit(index(), e.currentTarget.value)}
									/>
								</Show>
							)}
						</For>
					</div>
				);
			}
			case "steps-edit-toggle":
				return (
					<button
						type="button"
						class="ghost-btn"
						aria-pressed={editingSteps()}
						title="Edit the jog offsets for every axis"
						onClick={() => setEditingSteps(!editingSteps())}
					>
						{node.label}
					</button>
				);
```

Add `AxisSteps` and `DEFAULT_AXIS_STEPS` to the imports from `../../config/types.ts`.

- [ ] **Step 3: Add the geometry**

In `packages/ui/src/app.css`, after the existing `.jog-table` block:

```css
/* ---------- the per-axis step bank ----------
   One grid for every axis: name track plus six equal offset tracks. Each
   .step-row is display: contents, so its seven cells are direct children of
   THIS grid and land in the same tracks as every other row's. Alignment is
   true by construction — it cannot depend on "U" and "X" measuring the same,
   and adding an axis cannot reflow the columns.

   Buttons and inputs share --ctl-h and identical horizontal padding, so
   toggling edit mode resizes nothing: no cell changes size and nothing moves
   under a finger already resting on the card. */
.step-table {
	display: grid;
	grid-template-columns: max-content repeat(6, minmax(0, 1fr));
	gap: var(--ctl-gap);
	align-items: center;
}
.step-table .step-row { display: contents; }
.step-table .ctl-name { min-width: 0; white-space: nowrap; }
.step-cell { width: 100%; justify-content: center; padding: 0 6px; }
/* Tabular so "-0.02" and "-100" occupy the same width — otherwise editing one
   cell would resize its column and shift the buttons either side of it. */
.step-cell .gcode-label,
.step-input { font-variant-numeric: tabular-nums; }
.step-input {
	width: 100%;
	height: var(--ctl-h);
	box-sizing: border-box;
	padding: 0 6px;
	background: var(--mask-900);
	border: 1px solid var(--hairline);
	border-radius: var(--radius);
	color: var(--silk);
	font: 600 12.5px/1 var(--font-display);
	text-align: center;
}
.step-input:focus-visible { outline: none; border-color: var(--copper); }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @dwc-ng/ui exec tsc -b --force`
Expected: exit 0. The `unreachable(node)` weld in `ControlList.tsx` now passes because both cases are handled.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/compose/controls/ControlList.tsx packages/ui/src/app.css
git commit -m "feat(controls): render the axis step bank and its edit toggle

Buttons and inputs share --ctl-h and one grid's tracks, so toggling edit
mode causes zero reflow. A cell that does not parse to a finite number is
refused rather than coerced: a rounded value would make a button lie about
the move it sends."
```

---

### Task 6: Wire the Movement card and re-weld the tests

**Files:**
- Modify: `packages/ui/src/compose/controls/builtin.ts` (`MOVEMENT_SPEC`)
- Modify: `packages/ui/test/control-spec.test.ts` (`extractButtons` switch + the weld table)

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: the shipped Movement card. `MOVEMENT_SPEC.inputs` loses `step` and keeps `feed`, `extMm`, `extFeed`.

- [ ] **Step 1: Rewrite MOVEMENT_SPEC**

In `packages/ui/src/compose/controls/builtin.ts`, replace the `step` input and the first two nodes.

Delete from `inputs`:

```ts
		step: { kind: "chips", label: "Step", default: 1, options: [0.1, 1, 10, 100], unit: "mm" },
```

Replace the `{ type: "row", label: "Step", class: "step-row", … }` node and the `jog-table` node with:

```ts
		// Feed plus the edit toggle. The Step chips are gone: their only job
		// was choosing a magnitude, and every bank button now carries its own,
		// so the chips would have been a control that drives nothing.
		{ type: "row", label: "Feed", class: "ctl-wrap", items: [{ input: "feed" }, { type: "steps-edit-toggle", label: "Steps" }] },
		{
			// Every visible axis, six offsets each, in one grid. See .step-table
			// in app.css for why the tracks live on the container.
			type: "row",
			class: "step-table",
			items: [
				{
					type: "forEach",
					from: "move.axes[visible]",
					as: "axis",
					node: { type: "axis-step-bank", axisVar: "axis", feed: "feed" },
				},
			],
		},
```

Leave the coupler and extruder nodes untouched.

**Note:** the old top row used `class: "step-row"`, which is now the per-axis bank row class. It must become `ctl-wrap` as above, or the feed row will inherit `display: contents` and collapse into the grid.

- [ ] **Step 2: Update `extractButtons` and the weld table**

In `packages/ui/test/control-spec.test.ts`, add to the `extractButtons` switch beside the existing motion primitives:

```ts
			case "jog-pad":
			case "axis-jog":
			case "axis-step-bank":
				return; // motion primitives emit via cmd.jog inside the renderer
			case "steps-edit-toggle":
				return; // a view mode, not a command
```

The weld table itself needs no new entries — the bank emits no `gcode-button` templates. Confirm the `buttons.length` assertion still matches: removing the `axis-jog` node removes no buttons from the table (it was already skipped), so the expected count is unchanged at 9.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`
Expected: 651 pass, 0 fail.

Run: `pnpm --filter @dwc-ng/ui exec tsc -b --force`
Expected: exit 0.

- [ ] **Step 4: Verify in the running app**

```bash
pnpm mock    # background
pnpm dev     # background
```

Open `http://localhost:5173/#/control` with the **Mock** backend selected. Confirm, and state which check could have failed:

1. Seven axis rows (X Y Z U V W C), each with six buttons labelled `-100 -10 -1 +1 +10 +100`.
2. The `-/+` pair and the Step chips are gone; Feed and the `Steps` toggle remain.
3. Pressing `Steps` swaps every cell to a text input **without any cell changing size** — measure it, do not eyeball:

```js
const before = [...document.querySelectorAll('.step-row > *:not(.ctl-name)')].map(e => e.getBoundingClientRect().width);
document.querySelector('[aria-pressed]').click();
const after = [...document.querySelectorAll('.step-row > *:not(.ctl-name)')].map(e => e.getBoundingClientRect().width);
JSON.stringify({ same: JSON.stringify(before) === JSON.stringify(after), before: before.slice(0,6), after: after.slice(0,6) });
```
Expected: `same: true`.

4. Type `0.05` into a Z cell, blur, press `Steps` again — the Z button reads `0.05` and the header Save bar is armed.
5. Type `abc` into a cell and blur — the field reverts and config does **not** become dirty.
6. Press a jog button and read the wire: the console shows `M120 / G91 / G1 Z0.05 F6000 / M121`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/compose/controls/builtin.ts packages/ui/test/control-spec.test.ts
git commit -m "feat(controls): Movement card jogs from per-axis step banks

Six offsets per axis, each individually editable behind the Steps toggle and
stored in the config overlay. The Step chips and the single -/+ pair are
removed: the bank subsumes both, and chips driving nothing would be a dead
control."
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| `AxisSteps` tuple type | 1 |
| `DEFAULT_AXIS_STEPS`, uniform, single site | 1 |
| `UiConfig.axisSteps`, `DEFAULT_CONFIG.axisSteps: {}` | 1 |
| `parseAxisSteps` via `safeEntries`, arity checked not padded | 1 |
| Overlay-on-defaults, Reset restores defaults | 2 |
| `axis-step-bank` + `steps-edit-toggle` node types, compile validation | 3 |
| Import/export admission + `reviewSpec` motion inventory | 4 |
| Card-local, non-persisted edit signal | 5 |
| Six cells independently editable | 5 |
| Buttons emit `cmd.jog` unchanged | 5, 6 |
| `display: contents` shared tracks, zero-reflow toggle, tabular numerals | 5, 6 step 4 |
| Finite-number validation, refuse-don't-coerce, zero allowed | 1, 5 |
| Step chips removed, Feed kept | 6 |
| Coupler/extruder untouched | 6 |

No gaps.

**Placeholder scan:** none. Every code step carries literal code. Task 2 step 1 references `makeTestConfigStore` from the existing `test/config.test.ts` harness rather than inventing one — the step instructs reading and copying that file's setup verbatim, which is the only external lookup in the plan.

**Type consistency:** `AxisSteps` is used identically in Tasks 1, 2 and 5. `setAxisSteps(letter, steps)` matches between the interface (Task 2), the implementation (Task 2) and the caller (Task 5). `DEFAULT_AXIS_STEPS` is defined in Task 1 and read in exactly one place in Task 5. Node type names `axis-step-bank` / `steps-edit-toggle` are byte-identical across Tasks 3, 4, 5 and 6.

**Deliberate build break:** Task 3 step 4 expects `tsc` to fail. That is the totality weld doing its job, and Tasks 4 and 5 clear it. Tasks 3–5 should land as a group; do not stop at Task 3 with a red build.

**Ordering note:** `.step-row` changes meaning in Task 6 (it becomes the per-axis bank row). Task 5 introduces the new `.step-row` rules while `MOVEMENT_SPEC` still uses the old class on its top row, so between Task 5 and Task 6 the Movement card's Feed row renders wrong. This is only visible if you run the app mid-plan; Task 6 step 1's note resolves it.
