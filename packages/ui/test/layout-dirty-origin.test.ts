// #120 defect B — one flag carried two different facts: "the operator
// rearranged the screen" and "the canvas emitted a geometry event". Every
// geometry write went through `persist`, and `persist` always called
// `onLayoutChange` (ComposedScreen passes the config store's markLayoutDirty),
// so ComposedScreen's composition-sync effect — which runs as the screen
// catches up to a config change nobody dragged — reported unsaved work on a
// plain reload. Gabe, 2026-08-27: "every time I reload the message changes from
// All changes saved to Unsaved changes", with no edit made.
//
// The fix distinguishes the two AT THE SOURCE: `persist` takes a mandatory
// LayoutOrigin, and only "operator-gesture" notifies. It is deliberately NOT
// "stop marking dirty" — geometry reaches the overlay only at save time
// (captureScreenGeometry) and Save is gated on the flag, so a canvas that never
// marked dirty is one whose rearrangement could never be saved at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRoot } from "solid-js";
import { createPanelCanvas, devCanvasKeys } from "../src/shell/panelCanvas.ts";
import { createConfigStore } from "../src/config/store.ts";
import { CONFIG_CACHE_KEY, CONFIG_VERSION } from "../src/config/types.ts";
import { withLocalStorage } from "./helpers/localStorage.ts";

const rect = (col: number, row: number, colSpan: number, rowSpan: number) => ({ col, row, colSpan, rowSpan });

/** A canvas plus a count of how many times it claimed the layout changed. */
function canvasWithNotifier(key: string, defaults: { id: string; col: number; row: number; colSpan: number; rowSpan: number }[]) {
	let notified = 0;
	const canvas = createPanelCanvas(devCanvasKeys(key), defaults, undefined, () => { notified += 1; });
	return { canvas, notifications: () => notified };
}

test("building a canvas does not report unsaved work", () => {
	// The construction-time settle write (a deterministic repair) goes straight
	// to keys.set and has never notified. Pinned here because it is one line
	// away from the notifying path and reads exactly like a write.
	const { notifications } = canvasWithNotifier("dwc-ng.canvas.test-origin-boot", [
		{ id: "a", ...rect(0, 0, 12, 40) },
		{ id: "b", ...rect(12, 0, 12, 40) },
	]);
	assert.equal(notifications(), 0);
});

test("the composition-sync effect's slot adoption and removal do not report unsaved work", () => {
	// This IS the boot path: ComposedScreen's effect calls ensureSlot for every
	// slot the composition holds and removeSlot for anything the canvas tracks
	// that the composition no longer does — including junk ids left in old
	// storage, which is why a browser that had ever run an older build reported
	// unsaved work on EVERY load.
	const { canvas, notifications } = canvasWithNotifier("dwc-ng.canvas.test-origin-sync", [
		{ id: "a", ...rect(0, 0, 12, 40) },
	]);
	canvas.ensureSlot("b", rect(12, 0, 12, 40));
	assert.equal(notifications(), 0, "adopting a slot the config already knows about is not an operator edit");

	canvas.removeSlot("b");
	assert.equal(notifications(), 0, "nor is forgetting one the composition dropped");

	// The write still HAPPENED — this must not have been fixed by not persisting.
	assert.deepEqual(canvas.styleFor("b"), {}, "b is gone from the live layout");
	assert.equal(canvas.slotIds().includes("a"), true);
});

test("an operator gesture still reports unsaved work", () => {
	// Requirement 4: rearranging must stay saveable. `adoptLayout` (import) and
	// `resetSlot` are the gestures reachable without a DOM; the drag and resize
	// commits need a pointer and are pinned by the call-site scan below.
	const { canvas, notifications } = canvasWithNotifier("dwc-ng.canvas.test-origin-gesture", [
		{ id: "a", ...rect(0, 0, 12, 40) },
		{ id: "b", ...rect(12, 0, 12, 40) },
	]);
	canvas.adoptLayout({ a: rect(0, 40, 12, 40), b: rect(12, 40, 12, 40) });
	assert.equal(notifications(), 1, "an import is the operator's act");

	canvas.resetSlot("a");
	assert.equal(notifications(), 2, "so is resetting one card to its coded default");
});

// --- the per-call-site scan the invariant's rung-6 claim rests on -----------
//
// `only-an-operator-gesture-reports-unsaved-work` says a geometry write that
// never decided whose act it was does not compile — true, because `origin` has
// no default. What the type system CANNOT say is that a new call site picked
// the right literal, and that `onLayoutChange` is still named at exactly one
// line. Both are pinned here.
test("every geometry write names its origin, and only one line notifies", () => {
	const src = readFileSync(fileURLToPath(new URL("../src/shell/panelCanvas.ts", import.meta.url)), "utf8");
	const lines = src.split(/\r?\n/);

	const calls = lines
		.map((line, i) => ({ line: line.trim(), n: i + 1 }))
		.filter(l => !l.line.startsWith("//") && !l.line.startsWith("*") && !l.line.startsWith("/*"))
		.filter(l => /\bpersist\(/.test(l.line) && !/\bpersistParked\(/.test(l.line) && !/^const persist =/.test(l.line));
	assert.ok(calls.length >= 6, `expected the known geometry writers, found ${calls.length}`);
	for (const c of calls) {
		assert.match(c.line, /"(operator-gesture|composition-reconcile)"\)/, `panelCanvas.ts:${c.n} writes geometry without naming its origin`);
	}

	// Exactly two reconciles, and they are ensureSlot's and removeSlot's — the
	// only two writers driven by the composition rather than by a person.
	const reconciles = calls.filter(c => c.line.includes("composition-reconcile"));
	assert.equal(reconciles.length, 2, "only slot adoption and slot removal are reconciliation");

	// The notifier itself: named once, and behind the origin check.
	const notifies = lines.map((line, i) => ({ line: line.trim(), n: i + 1 })).filter(l => !l.line.startsWith("//") && !l.line.startsWith("*") && /onLayoutChange\?\.\(\)/.test(l.line));
	assert.equal(notifies.length, 1, "onLayoutChange is invoked at exactly one line");
	assert.match(lines[notifies[0]!.n - 1]!, /origin === "operator-gesture"/, "and only for an operator gesture");
});

// --- the same thing again, through the REAL consumer -------------------------
//
// The tests above count notifications; these two assert on the flag the save
// bar actually reads, with the real config store wired the way
// ComposedScreen.tsx:185 wires it. That wiring is where the ticket's
// requirement 3 lives ("a reload with no operator edit reports All changes
// saved"), and a notifier count cannot speak for it.

/** A boot with NOTHING unsaved — the persisted state on the reload Gabe
 *  complained about. */
function bootClean(key: string) {
	localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ version: CONFIG_VERSION, overlay: {}, dirty: false, snapshots: [] }));
	const store = createConfigStore({ machineStore: () => null });
	assert.equal(store.dirty, false, "precondition: this boot starts clean");
	const canvas = createPanelCanvas(
		devCanvasKeys(key),
		[{ id: "a", ...rect(0, 0, 12, 40) }],
		undefined,
		// Verbatim the wiring at compose/ComposedScreen.tsx:185.
		() => store.markLayoutDirty(),
	);
	return { store, canvas };
}

test("a boot with a persisted dirty:false and no operator input leaves the config clean (#120 requirement 3)", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const { store, canvas } = bootClean("dwc-ng.canvas.test-origin-store-clean");
			// ComposedScreen's sync effect, in shape: adopt what the composition
			// has, forget what it no longer has.
			canvas.ensureSlot("b", rect(12, 0, 12, 40));
			canvas.removeSlot("b");
			assert.equal(store.dirty, false, "reconciling the canvas is not an operator edit");
			const cached = JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY)!) as { dirty: boolean };
			assert.equal(cached.dirty, false, "and nothing writes dirty:true to the cache, so the NEXT boot is clean too");
			dispose();
		});
	});
});

test("an operator layout gesture still makes Save to machine reachable (#120 requirement 4)", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const { store, canvas } = bootClean("dwc-ng.canvas.test-origin-store-gesture");
			canvas.resetSlot("a");
			assert.equal(store.dirty, true, "a rearranged screen must still be savable");
			dispose();
		});
	});
});
