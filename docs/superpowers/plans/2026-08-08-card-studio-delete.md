# Card Studio Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move custom-card deletion out of the compose drawer and into the Card Studio, with an armed confirmation that reports which screens the card is used on — and the report/deletion agreement enforced by construction.

**Architecture:** A branded `CardDeletePlan` (sole producer `planCardDelete(config, id)` in `compose/screens.ts`, mirroring `RemovePlan` in `files/browser.ts`) computes the screens using the card AND the confirmation message from one id — the studio arms with the plan, renders `armed().message`, and confirms `armed().id`, so the thing shown and the thing done cannot disagree (rung 7). A source-walking test pins `removeCustomCard` call sites to an allowlist, making the studio the only user-facing delete surface (rung 6, same mechanism grading as `control/escape-disarms`). The drawer's ✕ is removed; its remaining raw-signal armed control is converted to `createArmed` (grandfathering). CardLab gets a fallback so the featured pill never points at a deleted card.

**Tech Stack:** SolidJS + TypeScript, node:test (no DOM in tests — test pure helpers, not components), `@dwc-ng/invariants` register generator.

**Spec:** `docs/superpowers/specs/2026-08-08-card-studio-delete-design.md`

## Global Constraints

- Never destructure props; use `props.x`. Use `<Show>`/`<For>`, never early returns or `.map` in JSX. Signals/stores read inside tracking scopes only.
- Every two-step control MUST arm via `createArmed` from `src/control/armed.ts` (Escape disarms; `test/armed.test.ts` enforces by source walk).
- **Invariant ledger rules:** the debt ceiling is FULL (20 below rung 6, ceiling 20 in `packages/invariants/debt-ceiling.json`) — every new `@invariant` declaration in this plan MUST be rung 6 or above, with the rung assigned from the mechanism, not the wording. New declarations require regenerating `docs/invariant-register.md` (`pnpm --filter @dwc-ng/invariants generate`). Avoid red-flag phrases in comments outside declarations ("should", "callers must", "by convention", "not yet", "remember to", "deferred", "future work", "in practice", "pinned by a test") — the red-flag ceiling is also ratcheted.
- No new dependencies.
- Reserved-geometry rule: nothing may appear that shoves other elements (the studio's `.fb-msg` line exists for this; reuse it).
- Typecheck with `npx tsc -b --force` from repo root (`npx tsc --noEmit` checks ZERO files here — solution-style root tsconfig).
- Tests: `pnpm --filter @dwc-ng/ui test` (node:test, no jsdom — component JSX is not importable in tests; test pure functions). Invariant gate: `pnpm --filter @dwc-ng/invariants test`.
- Files are mixed CRLF/LF — use the Edit tool only, never scripted rewrites.
- Commit messages: conventional-commit style (`feat(compose): …`), ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_015f8hRj3ohmDDBxvt5sRzJF`

---

### Task 1: `CardDeletePlan` (sole producer), `screensUsing`, `isOrphanSlot`

**Files:**
- Modify: `packages/ui/src/compose/screens.ts` (add exports at the end, after `captureScreenGeometry`)
- Modify: `packages/ui/src/compose/composition.ts` (add `isOrphanSlot` near `isCustomCardId`)
- Test: `packages/ui/test/screens-using.test.ts` (new)

**Interfaces:**
- Consumes: `createConfigStore()` from `src/config/store.ts` (`addCustomCard(name, spec): CustomCardId`, `setScreenCard(screenId, cardId, rect | null)`, `addScreen(name): UserScreenId`, `setScreenHidden(id, hidden)`, `renameScreen(id, name)`, `removeCustomCard(id)`); `BUILTIN_SCREENS` in `screens.ts`; `SPINDLE_EXAMPLE_JSON` from `src/compose/controls/examples.ts`.
- Produces (Tasks 2 and 4 rely on these exact signatures):
  - `interface ScreenUse { id: string; name: string; hidden: boolean }` (exported from `screens.ts`)
  - `interface CardDeletePlan { readonly id: CustomCardId; readonly uses: readonly ScreenUse[]; readonly message: string; readonly __plan: unique symbol }` (exported from `screens.ts`)
  - `planCardDelete(config: UiConfig, id: CustomCardId): CardDeletePlan` (exported from `screens.ts` — the SOLE producer)
  - `screensUsing(config: UiConfig, cardId: CustomCardId): ScreenUse[]` (exported from `screens.ts`)
  - `isOrphanSlot(id: SlotId, config: UiConfig): boolean` (exported from `composition.ts`)

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/screens-using.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { planCardDelete, screensUsing } from "../src/compose/screens.ts";
import { isOrphanSlot } from "../src/compose/composition.ts";
import { SPINDLE_EXAMPLE_JSON } from "../src/compose/controls/examples.ts";

const RECT = { col: 0, row: 0, colSpan: 24, rowSpan: 40 };

// ---- screensUsing: the blast-radius data behind the plan ----

test("screensUsing: unplaced card is on no screen", () => {
	const store = createConfigStore();
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	assert.deepEqual(screensUsing(store.config, id), []);
});

test("screensUsing finds a card on a builtin via the layouts overlay, rename applied", () => {
	const store = createConfigStore();
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("machine", id, RECT);
	store.renameScreen("machine", "Printer");
	assert.deepEqual(screensUsing(store.config, id), [
		{ id: "machine", name: "Printer", hidden: false },
	]);
});

test("screensUsing reports hidden builtins — the card is still placed on them", () => {
	const store = createConfigStore();
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("bed", id, RECT);
	store.setScreenHidden("bed", true);
	assert.deepEqual(screensUsing(store.config, id), [
		{ id: "bed", name: "Bed maintenance", hidden: true },
	]);
});

test("screensUsing finds a card on a custom screen", () => {
	const store = createConfigStore();
	const cardId = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	const screenId = store.addScreen("CNC bench");
	store.setScreenCard(screenId, cardId, RECT);
	assert.deepEqual(screensUsing(store.config, cardId), [
		{ id: screenId, name: "CNC bench", hidden: false },
	]);
});

test("screensUsing: removing the placement removes the usage", () => {
	const store = createConfigStore();
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("machine", id, RECT);
	store.setScreenCard("machine", id, null);
	assert.deepEqual(screensUsing(store.config, id), []);
});

// ---- planCardDelete: the sole producer builds id, uses, and message TOGETHER ----

test("planCardDelete: unused card — plan says so and still names the id it deletes", () => {
	const store = createConfigStore();
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	const plan = planCardDelete(store.config, id);
	assert.equal(plan.id, id);
	assert.deepEqual(plan.uses, []);
	assert.equal(plan.message, "Not on any screen.");
});

test("planCardDelete: message lists every use, hidden flagged, from the same uses array", () => {
	const store = createConfigStore();
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	store.setScreenCard("machine", id, RECT);
	const screenId = store.addScreen("CNC bench");
	store.setScreenCard(screenId, id, RECT);
	store.setScreenHidden("machine", true);
	const plan = planCardDelete(store.config, id);
	assert.deepEqual(plan.uses.map(u => u.name), ["Machine", "CNC bench"]);
	assert.equal(
		plan.message,
		"On screens: Machine (hidden), CNC bench — confirm to remove it from all of them.",
	);
});

// ---- isOrphanSlot: the lab's featured-fallback condition ----

test("isOrphanSlot: registry ids never orphan; custom ids orphan when their def is gone", () => {
	const store = createConfigStore();
	assert.equal(isOrphanSlot("position", store.config), false);
	const id = store.addCustomCard("Spindle", SPINDLE_EXAMPLE_JSON);
	assert.equal(isOrphanSlot(id, store.config), false);
	store.removeCustomCard(id);
	assert.equal(isOrphanSlot(id, store.config), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: FAIL — `screensUsing`, `planCardDelete`, `isOrphanSlot` have no export.

- [ ] **Step 3: Implement the helpers**

In `packages/ui/src/compose/screens.ts` — add `type CustomCardId` to the existing import from `./composition.ts`, then append at the end of the file:

```ts
/** One screen that still shows a given custom card — a line of the delete
 *  plan's blast radius. */
export interface ScreenUse {
	id: string;
	name: string;
	/** Hidden built-ins are reported too: the card is still placed on them,
	 *  and unhiding the screen would bring it back. */
	hidden: boolean;
}

/**
 * Every screen whose composition contains `cardId`. Built-ins are checked via
 * their layouts overlay ONLY: a built-in's default composition can never name
 * a custom card (the registry and the "c-" namespace are disjoint by
 * construction — see compose/defs.ts registered-card-ids). `screenList()` is
 * deliberately not reused — it filters hidden screens out, which is exactly
 * wrong here.
 */
export function screensUsing(config: UiConfig, cardId: CustomCardId): ScreenUse[] {
	const uses: ScreenUse[] = [];
	const screens = config.screens;
	for (const [id, def] of Object.entries(BUILTIN_SCREENS) as Array<[BuiltinScreenId, ScreenDef]>) {
		const override = screens.layouts[id];
		if (override !== undefined && Object.hasOwn(override, cardId)) {
			uses.push({ id, name: screens.renames[id] ?? def.name, hidden: screens.hidden.includes(id) });
		}
	}
	for (const [id, c] of Object.entries(screens.custom)) {
		if (Object.hasOwn(c.cards, cardId)) uses.push({ id, name: c.name, hidden: false });
	}
	return uses;
}

/**
 * A checked intent to delete a custom card, carrying what would be lost —
 * the compose twin of files/browser.ts's RemovePlan.
 *
 * @invariant card-delete-carries-its-blast-radius
 * @rung 7  sole-constructor type — the armed confirm holds a CardDeletePlan,
 *          and `planCardDelete` is its only producer, deriving the screens the
 *          card is on AND the message shown from the same id in one pass. The
 *          confirm deletes `plan.id`, so the report the operator read and the
 *          deletion performed cannot disagree
 * @why a delete that removes a card from every screen at once is exactly the
 *      action whose scope the operator must see before confirming — "delete
 *      this card?" cannot precede stripping it from screens they forgot it
 *      was on. The plan freezes usage at arm time; the studio is modal over
 *      composition edits, so the frozen report cannot go stale between the
 *      two clicks
 */
export interface CardDeletePlan {
	readonly id: CustomCardId;
	readonly uses: readonly ScreenUse[];
	/** The armed line's text — built here, beside the uses it describes. */
	readonly message: string;
	readonly __plan: unique symbol;
}

export function planCardDelete(config: UiConfig, id: CustomCardId): CardDeletePlan {
	const uses = screensUsing(config, id);
	const names = uses.map(u => (u.hidden ? `${u.name} (hidden)` : u.name)).join(", ");
	const message = uses.length === 0
		? "Not on any screen."
		: `On screens: ${names} — confirm to remove it from all of them.`;
	return { id, uses, message } as CardDeletePlan;
}
```

In `packages/ui/src/compose/composition.ts`, next to `isCustomCardId` (match its style; check the module's imports — `customCardIds(config)` lives there, so `UiConfig` is likely already imported; add `import type { UiConfig } from "../config/types.ts";` only if missing):

```ts
/** A slot id that can no longer render: a custom card whose definition is
 *  gone. Registry ids never orphan — the registry is code. */
export function isOrphanSlot(id: SlotId, config: UiConfig): boolean {
	return isCustomCardId(id) && !Object.hasOwn(config.cards, id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS (all suites — including pre-existing ones).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -b --force` — expected: clean.

```bash
git add packages/ui/src/compose/screens.ts packages/ui/src/compose/composition.ts packages/ui/test/screens-using.test.ts
git commit -m "feat(compose): CardDeletePlan — a card delete carries its blast radius"
```

---

### Task 2: Card Studio delete button armed with the plan

**Files:**
- Modify: `packages/ui/src/compose/CardStudio.tsx` (imports; delete logic after `save`; footer JSX at lines ~284-289)
- Modify: `packages/ui/src/app.css` (one rule near the other `.studio-*` styles)

**Interfaces:**
- Consumes: `createArmed<T>(): [Accessor<T | null>, (v: T | null) => void]` from `src/control/armed.ts`; `planCardDelete`/`CardDeletePlan` from Task 1; `app.config.removeCustomCard(id: CustomCardId): void` (exists); `props.cardId: CustomCardId | null`, `props.onClose(): void` (exist).
- Produces: studio deletes the card itself and closes — hosts need no new prop. `.fb-act.danger` + `.armed` styling already exists (the drawer used the same classes). Task 3's walk test allowlists this file as the sole user-facing `removeCustomCard` caller.

- [ ] **Step 1: Add imports and delete logic**

In `CardStudio.tsx`, extend the solid-js import to include `createEffect` and `onCleanup`, and add:

```ts
import { createArmed } from "../control/armed.ts";
import { planCardDelete } from "./screens.ts";
```

After the `save` function (line ~130), add:

```ts
	/**
	 * Deleting a CREATION is permanent once saved, so it never rides on one
	 * click (house two-step), and it arms through createArmed so Escape is a
	 * way out here like everywhere else. The armed value IS the CardDeletePlan:
	 * arming requires producing the plan, the message line renders the plan,
	 * and the confirm deletes the plan's id — there is no armed state without
	 * a computed blast radius.
	 *
	 * @invariant one-card-delete-surface
	 * @rung 6  choke-point — this armed confirm is the only user-facing route
	 *          to removeCustomCard, and test/card-delete-surface.test.ts walks
	 *          src rejecting any new caller by file and line (allowlisted: the
	 *          store definition, and ComposedScreen's import purge — which
	 *          deletes the cards embedded in a screen being displaced, a flow
	 *          with its own confirm). Promote by moving deletion behind an
	 *          executor that accepts only a CardDeletePlan once the config
	 *          layer can name compose types without an import cycle
	 * @why a second delete surface is how the blast-radius report gets skipped:
	 *      the old drawer ✕ deleted from every screen while showing only a
	 *      tooltip warning. One surface, armed with the plan, keeps "delete"
	 *      and "here is what that does" inseparable
	 */
	const [armed, setArmed] = createArmed<CardDeletePlan>();
	const deleteCard = (): void => {
		const id = props.cardId;
		if (id === null) return;
		const plan = armed();
		if (plan === null) {
			setArmed(planCardDelete(app.config.config, id));
			return;
		}
		setArmed(null);
		app.config.removeCustomCard(plan.id);
		props.onClose();
	};

	// A press anywhere but the delete button disarms it — same dismissal the
	// drawer's armed controls use. pointerdown, not click, so a press that
	// becomes a drag still disarms; registered only while armed.
	let deleteBtn: HTMLButtonElement | undefined;
	createEffect(() => {
		if (armed() === null) return;
		const disarm = (e: PointerEvent): void => {
			if (deleteBtn !== undefined && e.target instanceof Node && deleteBtn.contains(e.target)) return;
			setArmed(null);
		};
		document.addEventListener("pointerdown", disarm, { capture: true });
		onCleanup(() => document.removeEventListener("pointerdown", disarm, { capture: true }));
	});
```

Also add `CardDeletePlan` to the type imports from `./screens.ts` (i.e. `import { planCardDelete, type CardDeletePlan } from "./screens.ts";`).

- [ ] **Step 2: Wire the footer JSX**

Replace the current reserved line + footer row (lines ~284-289):

```tsx
				{/* Reserved line: an error appearing must not shove the buttons. */}
				<p class="fb-msg" classList={{ show: error() !== "" }}>{error() || " "}</p>
				<div class="compose-row">
					<button class="fb-act ok" onClick={save}>{props.cardId === null ? "Create card" : "Save card"}</button>
					<button class="fb-act" onClick={props.onClose}>Cancel</button>
				</div>
```

with:

```tsx
				{/* Reserved line: an error — or the armed delete's blast-radius
				    report — appearing must not shove the buttons. The armed plan
				    wins while armed: its report is what the next click acts on. */}
				<p class="fb-msg" classList={{ show: armed() !== null || error() !== "" }}>
					{armed()?.message ?? (error() || " ")}
				</p>
				<div class="compose-row">
					<button class="fb-act ok" onClick={save}>{props.cardId === null ? "Create card" : "Save card"}</button>
					<button class="fb-act" onClick={props.onClose}>Cancel</button>
					<Show when={props.cardId !== null}>
						<button
							ref={deleteBtn}
							class="fb-act danger studio-delete"
							classList={{ armed: armed() !== null }}
							onClick={deleteCard}
						>
							{armed() !== null ? "Confirm delete" : "Delete card"}
						</button>
					</Show>
				</div>
```

- [ ] **Step 3: CSS — push the delete away from Save/Cancel**

In `packages/ui/src/app.css`, next to the other `.studio-*` rules:

```css
/* Delete stands apart from Save/Cancel — a miss on Save must not land on it. */
.studio-delete { margin-left: auto; }
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @dwc-ng/ui test` — expected: PASS, including `test/armed.test.ts` (the new `[armed,` line sits on the same line as `createArmed`, which is what the walk requires).
Run: `npx tsc -b --force` — expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/compose/CardStudio.tsx packages/ui/src/app.css
git commit -m "feat(compose): Card Studio deletes its card — armed confirm holds the delete plan"
```

---

### Task 3: Remove the drawer's card delete; pin the delete surface; grandfather the screen delete onto createArmed

**Files:**
- Modify: `packages/ui/src/compose/ComposedScreen.tsx`
- Test: `packages/ui/test/card-delete-surface.test.ts` (new)

**Interfaces:**
- Consumes: `createArmed` from `src/control/armed.ts`.
- Produces: drawer custom-card rows have exactly checkbox / Edit / ⤓ export; `removeCustomCard` call sites are pinned by test to {store definition, CardStudio, ComposedScreen import purge}.

- [ ] **Step 1: Write the walk test (fails while the drawer delete still exists — that IS the red check)**

Create `packages/ui/test/card-delete-surface.test.ts` (walk mechanics copied from `test/armed.test.ts`):

```ts
/**
 * compose/one-card-delete-surface (declared in CardStudio.tsx): the studio's
 * plan-armed confirm is the only user-facing route to removeCustomCard, so a
 * card deletion cannot reach the config without its blast radius having been
 * computed and shown. This walk rejects any new caller by file and line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Every entry carries its reason — an allowlist without reasons is how it grows.
const ALLOWED = new Set([
	"config/store.ts", // the store: interface declaration + the one mutator body
	"compose/CardStudio.tsx", // the sole user-facing surface (plan-armed confirm)
	"compose/ComposedScreen.tsx", // import purge: cards embedded in a displaced screen
]);

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(full);
		else if (/\.tsx?$/.test(entry.name)) yield full;
	}
}

test("removeCustomCard is reachable only from the store, the studio, and the import purge", () => {
	const offenders: string[] = [];
	for (const file of walk(SRC)) {
		const rel = relative(SRC, file).split(sep).join("/");
		if (ALLOWED.has(rel)) continue;
		readFileSync(file, "utf8").split("\n").forEach((line, i) => {
			if (line.includes("removeCustomCard")) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(
		offenders,
		[],
		"card deletion goes through the studio's plan-armed confirm — a new delete surface skips the blast-radius report",
	);
});
```

Note: `ComposedScreen.tsx` is allowlisted, so this test passes even before Step 2 — its red check is different: temporarily add `removeCustomCard` to any non-allowlisted file (e.g. a comment in `CardLab.tsx`), run the test, watch it fail by file and line, then remove it. Do this once, in this step, before committing.

- [ ] **Step 2: Delete the drawer's card-delete mechanism**

In `ComposedScreen.tsx`:

1. Remove the signal (line ~319):
   `const [armedCardDelete, setArmedCardDelete] = createSignal<CustomCardId | null>(null);`
2. Remove the whole `deleteCard` function (lines ~322-330).
3. In `deleteScreen` (line ~333), remove the `setArmedCardDelete(null);` line.
4. In the custom-card row JSX (lines ~509-516), remove the ✕ button block:

```tsx
										<button
											class="fb-act danger"
											classList={{ armed: armedCardDelete() === id }}
											title={`Delete ${app.config.config.cards[id]!.name} — removes it from every screen`}
											onClick={() => deleteCard(id)}
										>
											{armedCardDelete() === id ? "Confirm" : "✕"}
										</button>
```

5. Update the two comments that promise a drawer delete: the file-head list (line ~14, "add/remove cards, rename, hide/delete, new screen") and the lifecycle note (lines ~152-157, "…own explicit ✕/Delete") — both now say card deletion lives in the Card Studio (drawer checkboxes only compose the current screen).
6. `CustomCardId` stays imported (the import-purge path still uses it).

- [ ] **Step 3: Grandfather `armedScreenDelete` onto `createArmed`**

Same file, same block we are editing: `armedScreenDelete` is a raw `createSignal(false)` — a two-step control Escape cannot reach, invisible to `test/armed.test.ts`'s walk because it is not named `armed`. `control/escape-disarms` is rung 6 and this is a bypass of its choke point; touching the block obligates the fix (cant-break-by-design rule 6):

```ts
	// Two-step confirm for the drawer's one destructive act (house pattern —
	// matching file delete / heater reset / macro run): first click arms, the
	// second fires. Deleting a CREATION is permanent once saved, so it never
	// rides on a single click. Card deletion is the Card Studio's job — the
	// drawer only composes the current screen. createArmed, so Escape disarms
	// this like every other armed control.
	const [armedScreenDelete, setArmedScreenDelete] = createArmed<true>();

	const deleteScreen = (): void => {
		if (armedScreenDelete() === null) {
			setArmedScreenDelete(true);
			return;
		}
		setArmedScreenDelete(null);
		app.config.removeScreen(props.screenId);
		// The hash still points at the screen just deleted, which would fall
		// through to the first screen's cards while the nav highlights nothing —
		// looking like the delete failed. Navigate somewhere real.
		const first = screenList(app.config.config)[0];
		if (first !== undefined) window.location.hash = `#/${first.id}`;
	};
```

Add `import { createArmed } from "../control/armed.ts";` and update the two JSX reads (lines ~435, ~438): `armedScreenDelete()` truthiness becomes `armedScreenDelete() !== null`:

```tsx
									<button
										class="fb-act danger"
										classList={{ armed: armedScreenDelete() !== null }}
										onClick={deleteScreen}
									>
										{armedScreenDelete() !== null ? "Confirm" : "Delete screen"}
									</button>
```

(If `createSignal` now has no remaining use in the file, drop it from the solid-js import; `newName`/`open` likely still use it — check.)

- [ ] **Step 4: Verify**

Run: `pnpm --filter @dwc-ng/ui test` — expected: PASS, including the new walk test.
Run: `npx tsc -b --force` — expected: clean (an unused `setArmedCardDelete` would have failed this; confirm nothing else referenced it).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/compose/ComposedScreen.tsx packages/ui/test/card-delete-surface.test.ts
git commit -m "feat(compose): drawer no longer deletes cards; delete surface pinned by walk; screen delete arms via createArmed"
```

---

### Task 4: Card Lab featured-card fallback

**Files:**
- Modify: `packages/ui/src/dev/CardLab.tsx`

**Interfaces:**
- Consumes: `isOrphanSlot(id, config)` from Task 1 (`composition.ts` — extend the existing import on line ~14); `featured`/`setFeatured` signal (line ~41, default `"active-job-detailed"`); `outer.config` (line ~38 `outer = useApp()`).
- Produces: nothing downstream.

- [ ] **Step 1: Add the fallback effect**

After the `customIds` declaration (line ~98):

```ts
	// The featured card can be deleted out from under us — the studio's
	// delete, an import purge — and a featured id with no definition renders
	// a ghost. Fall back to the default featured card instead. This guards
	// EVERY deletion path, not just the studio's.
	createEffect(() => {
		if (isOrphanSlot(featured(), outer.config.config)) setFeatured("active-job-detailed");
	});
```

`createEffect` is already imported in CardLab.tsx; add `isOrphanSlot` to the existing `../compose/composition.ts` import.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @dwc-ng/ui test` and `npx tsc -b --force` — expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/dev/CardLab.tsx
git commit -m "feat(lab): featured card falls back when its definition is deleted"
```

---

### Task 5: Regenerate the invariant register; run the gate

**Files:**
- Regenerated: `docs/invariant-register.md` (and `DEBT.md` if the generator touches it)

- [ ] **Step 1: Regenerate**

Run: `pnpm --filter @dwc-ng/invariants generate`
Expected: the register gains `compose/card-delete-carries-its-blast-radius` (rung 7) and `compose/one-card-delete-surface` (rung 6); the totals line's below-rung-6 count is UNCHANGED (both new declarations are ≥6, ceiling stays 20/20).

- [ ] **Step 2: Run the gate**

Run: `pnpm --filter @dwc-ng/invariants test`
Expected: PASS — register fresh, debt count ≤ ceiling, red-flag count ≤ ceiling. If the red-flag ratchet fails, the offending phrase is in one of this plan's new comments — reword it (the ratchet output names file and line).

- [ ] **Step 3: Commit**

```bash
git add docs/invariant-register.md DEBT.md
git commit -m "docs(invariants): register the card-delete plan invariants"
```

---

### Task 6: Live verification and ship

**Files:** none (verification + deploy).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `pnpm test` (all packages), `npx tsc -b --force`, `pnpm build` — all expected clean.

- [ ] **Step 2: Live verification (dev server or board, via browser)**

Drive the real UI (headless Edge over CDP is the house fallback — no Chrome on this machine). Checks, each of which could fail:

1. Card Lab → feature a custom card → ✎ Edit → studio shows "Delete card" at the far right of the footer; a NEW card (+ New card) shows no delete.
2. Place that card on a screen via the drawer checkbox, reopen the studio, click Delete → button reads "Confirm delete" and the message line names that screen; buttons do not move (reserved line).
3. Press Escape → disarms. Arm again, click elsewhere in the studio → disarms.
4. Arm → Confirm → studio closes, card gone from the lab pills, featured falls back to "Printing · estimates", the screen shows no hole where the slot was.
5. Open the compose drawer → custom-card rows have no ✕; "Delete screen" still arms, and Escape now disarms it.

- [ ] **Step 3: Ship to the board**

```bash
pnpm build
pnpm ship --target http://duet3.nydick.net --mode dsf
```

Gabe verifies on the printer (deploy-after-every-major-commit).
