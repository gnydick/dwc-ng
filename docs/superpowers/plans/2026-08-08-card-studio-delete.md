# Card Studio Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move custom-card deletion out of the compose drawer and into the Card Studio, with an armed confirmation that reports which screens the card is used on.

**Architecture:** A pure `screensUsing(config, cardId)` helper in `compose/screens.ts` computes usage (built-ins via their `screens.layouts` overlay only — a built-in default composition can never contain a custom card; custom screens via their stored `cards`; hidden built-ins included and flagged). The studio footer gains a two-step Delete through `createArmed` whose armed state shows the usage report on the studio's existing reserved message line. The drawer's ✕ is removed. CardLab gets a fallback so the featured pill never points at a deleted card.

**Tech Stack:** SolidJS + TypeScript, node:test (no DOM in tests — test pure helpers, not components).

**Spec:** `docs/superpowers/specs/2026-08-08-card-studio-delete-design.md`

## Global Constraints

- Never destructure props; use `props.x`. Use `<Show>`/`<For>`, never early returns or `.map` in JSX. Signals/stores read inside tracking scopes only.
- Every two-step control MUST arm via `createArmed` from `src/control/armed.ts` (Escape disarms; `test/armed.test.ts` enforces by source walk). Name the pair exactly `[armed, setArmed]` so the walk covers it.
- No new dependencies.
- Reserved-geometry rule: nothing may appear that shoves other elements (the studio's `.fb-msg` line exists for this; reuse it).
- Typecheck with `npx tsc -b --force` from repo root (`npx tsc --noEmit` checks ZERO files here — solution-style root tsconfig).
- Tests: `pnpm --filter @dwc-ng/ui test` (node:test, no jsdom — component JSX is not importable in tests; test pure functions).
- Files are mixed CRLF/LF — use the Edit tool only, never scripted rewrites.
- Commit messages: conventional-commit style (`feat(compose): …`), ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_015f8hRj3ohmDDBxvt5sRzJF`

---

### Task 1: Pure helpers — `screensUsing`, `deleteConfirmMessage`, `isOrphanSlot`

**Files:**
- Modify: `packages/ui/src/compose/screens.ts` (add exports at the end, after `captureScreenGeometry`)
- Modify: `packages/ui/src/compose/composition.ts` (add `isOrphanSlot` near `isCustomCardId`)
- Test: `packages/ui/test/screens-using.test.ts` (new)

**Interfaces:**
- Consumes: `createConfigStore()` from `src/config/store.ts` (`addCustomCard(name, spec): CustomCardId`, `setScreenCard(screenId, cardId, rect | null)`, `addScreen(name): UserScreenId`, `setScreenHidden(id, hidden)`, `renameScreen(id, name)`); `BUILTIN_SCREENS` in `screens.ts`; `SPINDLE_EXAMPLE_JSON` from `src/compose/controls/examples.ts`.
- Produces (Tasks 2 and 4 rely on these exact signatures):
  - `interface ScreenUse { id: string; name: string; hidden: boolean }` (exported from `screens.ts`)
  - `screensUsing(config: UiConfig, cardId: CustomCardId): ScreenUse[]` (exported from `screens.ts`)
  - `deleteConfirmMessage(uses: ScreenUse[]): string` (exported from `screens.ts`)
  - `isOrphanSlot(id: SlotId, config: UiConfig): boolean` (exported from `composition.ts`)

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/test/screens-using.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConfigStore } from "../src/config/store.ts";
import { screensUsing, deleteConfirmMessage } from "../src/compose/screens.ts";
import { isOrphanSlot } from "../src/compose/composition.ts";
import { SPINDLE_EXAMPLE_JSON } from "../src/compose/controls/examples.ts";

const RECT = { col: 0, row: 0, colSpan: 24, rowSpan: 40 };

// ---- screensUsing: the studio delete's confirmation data ----

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

// ---- deleteConfirmMessage: the armed line's wording ----

test("deleteConfirmMessage wording: unused, used, hidden flagged", () => {
	assert.equal(deleteConfirmMessage([]), "Not on any screen.");
	assert.equal(
		deleteConfirmMessage([
			{ id: "machine", name: "Machine", hidden: false },
			{ id: "u-1", name: "CNC bench", hidden: true },
		]),
		"On screens: Machine, CNC bench (hidden) — confirm to remove it from all of them.",
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
Expected: FAIL — `screensUsing`, `deleteConfirmMessage`, `isOrphanSlot` have no export.

- [ ] **Step 3: Implement the helpers**

In `packages/ui/src/compose/screens.ts` — add `type CustomCardId` to the existing import from `./composition.ts`, then append at the end of the file:

```ts
/** One screen that still shows a given custom card — what the studio's
 *  delete confirmation lists. */
export interface ScreenUse {
	id: string;
	name: string;
	/** Hidden built-ins are reported too: the card is still placed on them,
	 *  and unhiding the screen would bring it back. */
	hidden: boolean;
}

/**
 * Every screen whose composition contains `cardId` — the data behind the
 * studio delete's confirmation line. Built-ins are checked via their layouts
 * overlay ONLY: a built-in's default composition can never name a custom card
 * (the registry and the "c-" namespace are disjoint by construction).
 * `screenList()` is deliberately not reused — it filters hidden screens out,
 * which is exactly wrong here.
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

/** The armed delete's message line — pure so the wording is testable. */
export function deleteConfirmMessage(uses: ScreenUse[]): string {
	if (uses.length === 0) return "Not on any screen.";
	const names = uses.map(u => (u.hidden ? `${u.name} (hidden)` : u.name)).join(", ");
	return `On screens: ${names} — confirm to remove it from all of them.`;
}
```

In `packages/ui/src/compose/composition.ts`, next to `isCustomCardId` (match its style; `SlotId` and `UiConfig` are already in scope in that module):

```ts
/** A slot id that can no longer render: a custom card whose definition is
 *  gone. Registry ids never orphan — the registry is code. */
export function isOrphanSlot(id: SlotId, config: UiConfig): boolean {
	return isCustomCardId(id) && !Object.hasOwn(config.cards, id);
}
```

(If `composition.ts` does not already import `UiConfig`, add `import type { UiConfig } from "../config/types.ts";` — check its existing imports first; `customCardIds(config)` lives there so it likely does.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @dwc-ng/ui test`
Expected: PASS (all suites — including pre-existing ones).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -b --force` — expected: clean.

```bash
git add packages/ui/src/compose/screens.ts packages/ui/src/compose/composition.ts packages/ui/test/screens-using.test.ts
git commit -m "feat(compose): screensUsing + delete-confirm helpers for the studio delete"
```

---

### Task 2: Card Studio delete button with armed usage report

**Files:**
- Modify: `packages/ui/src/compose/CardStudio.tsx` (imports; delete logic after `save`; footer JSX at lines ~284-289)
- Modify: `packages/ui/src/app.css` (one rule near the other `.studio-*` styles)

**Interfaces:**
- Consumes: `createArmed<T>(): [Accessor<T | null>, (v: T | null) => void]` from `src/control/armed.ts`; `screensUsing`/`deleteConfirmMessage` from Task 1; `app.config.removeCustomCard(id: CustomCardId): void` (exists); `props.cardId: CustomCardId | null`, `props.onClose(): void` (exist).
- Produces: studio deletes the card itself and closes — hosts need no new prop. `.fb-act.danger` + `.armed` styling already exists (the drawer used the same classes).

- [ ] **Step 1: Add imports and delete logic**

In `CardStudio.tsx`, extend the solid-js import to include `createEffect` and `onCleanup`, and add:

```ts
import { createArmed } from "../control/armed.ts";
import { deleteConfirmMessage, screensUsing } from "./screens.ts";
```

After the `save` function (line ~130), add:

```ts
	// Deleting a CREATION is permanent once saved, so it never rides on one
	// click (house two-step), and it arms through createArmed so Escape is a
	// way out here like everywhere else. While armed, the reserved message
	// line reports which screens still show the card — the report and the
	// thing the next click does cannot disagree, because both read the same
	// armed id.
	const [armed, setArmed] = createArmed<CustomCardId>();
	const usage = (): string =>
		props.cardId === null ? "" : deleteConfirmMessage(screensUsing(app.config.config, props.cardId));
	const deleteCard = (): void => {
		const id = props.cardId;
		if (id === null) return;
		if (armed() !== id) {
			setArmed(id);
			return;
		}
		setArmed(null);
		app.config.removeCustomCard(id);
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
				{/* Reserved line: an error — or the armed delete's usage report —
				    appearing must not shove the buttons. Armed wins while armed:
				    the report is what the next click acts on. */}
				<p class="fb-msg" classList={{ show: armed() !== null || error() !== "" }}>
					{armed() !== null ? usage() : error() || " "}
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
git commit -m "feat(compose): Card Studio deletes its card — armed confirm reports the screens it is on"
```

---

### Task 3: Remove the compose drawer's card delete

**Files:**
- Modify: `packages/ui/src/compose/ComposedScreen.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: drawer custom-card rows have exactly checkbox / Edit / ⤓ export. `armedScreenDelete` ("Delete screen") remains untouched.

- [ ] **Step 1: Delete the card-delete mechanism**

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

5. Update the two comments that promise a drawer delete: the file-head list (line ~14, "add/remove cards, rename, hide/delete, new screen") and the lifecycle note (lines ~152-157, "…own explicit ✕/Delete") — both now say card *deletion* lives in the Card Studio (drawer checkboxes only compose the current screen).
6. The two-step comment above the armed signals (lines ~315-318) now describes only the screen delete — trim it accordingly. `CustomCardId` stays imported (the import-purge path still uses it).

- [ ] **Step 2: Verify**

Run: `pnpm --filter @dwc-ng/ui test` — expected: PASS.
Run: `npx tsc -b --force` — expected: clean (an unused `setArmedCardDelete` would have failed this; confirm nothing else referenced it).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/compose/ComposedScreen.tsx
git commit -m "feat(compose): drawer no longer deletes cards — lifecycle moved to the studio"
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

### Task 5: Live verification and ship

**Files:** none (verification + deploy).

- [ ] **Step 1: Full suite + typecheck + build**

Run: `pnpm --filter @dwc-ng/ui test`, `npx tsc -b --force`, `pnpm build` — all expected clean.

- [ ] **Step 2: Live verification (dev server or board, via browser)**

Drive the real UI (headless Edge over CDP is the house fallback — no Chrome on this machine). Checks, each of which could fail:

1. Card Lab → feature a custom card → ✎ Edit → studio shows "Delete card" at the far right of the footer; a NEW card (+ New card) shows no delete.
2. Place that card on a screen via the drawer checkbox, reopen the studio, click Delete → button reads "Confirm delete" and the message line names that screen; buttons do not move (reserved line).
3. Press Escape → disarms. Arm again, click elsewhere in the studio → disarms.
4. Arm → Confirm → studio closes, card gone from the lab pills, featured falls back to "Printing · estimates", the screen shows no hole where the slot was.
5. Open the compose drawer → custom-card rows have no ✕.

- [ ] **Step 3: Ship to the board**

```bash
pnpm build
pnpm ship --target http://duet3.nydick.net --mode dsf
```

Gabe verifies on the printer (deploy-after-every-major-commit).
