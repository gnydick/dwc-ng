/**
 * Edit sessions (editor/drafts.ts): the unsaved text and the checkpoint history
 * behind the editor's ◀ ▶ stepper, plus the storage that carries both across a
 * reload.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_ENTRIES,
	beginSession,
	checkpoint,
	closeSession,
	currentText,
	isDirty,
	isStale,
	loadSession,
	markSaved,
	saveSession,
	stepTo,
} from "../src/editor/drafts.ts";

class MemStore {
	private m = new Map<string, string>();
	getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
	setItem(k: string, v: string): void { this.m.set(k, v); }
	removeItem(k: string): void { this.m.delete(k); }
	clear(): void { this.m.clear(); }
}
const ls = new MemStore();
(globalThis as { localStorage?: unknown }).localStorage = ls;

const CFG = "0:/sys/config.g";

test("a freshly opened file is one checkpoint and is not dirty", () => {
	const s = beginSession(CFG, "M115\n");
	assert.equal(s.entries.length, 1);
	assert.equal(s.at, 0);
	assert.equal(currentText(s), "M115\n");
	assert.equal(isDirty(s), false);
});

test("a tick with unchanged text adds nothing", () => {
	const s = beginSession(CFG, "M115\n");
	const same = checkpoint(s, "M115\n");
	assert.equal(same, s, "an idle tick returns the very same session, not a copy");
	assert.equal(same.entries.length, 1);
});

test("a tick with changed text becomes the newest checkpoint, and it reads dirty", () => {
	let s = beginSession(CFG, "M115\n");
	s = checkpoint(s, "M115\nG28\n");
	assert.equal(s.entries.length, 2);
	assert.equal(s.at, 1, "the stepper follows the newest checkpoint");
	assert.equal(currentText(s), "M115\nG28\n");
	assert.equal(isDirty(s), true);
});

test("stepping back shows the older text without losing the newer one", () => {
	let s = beginSession(CFG, "a");
	s = checkpoint(s, "ab");
	s = checkpoint(s, "abc");
	assert.equal(s.entries.length, 3);
	s = stepTo(s, 0);
	assert.equal(currentText(s), "a");
	s = stepTo(s, 2);
	assert.equal(currentText(s), "abc", "forward still reaches the newest");
});

test("stepping out of range clamps instead of throwing", () => {
	let s = beginSession(CFG, "a");
	s = checkpoint(s, "ab");
	assert.equal(currentText(stepTo(s, -5)), "a");
	assert.equal(currentText(stepTo(s, 99)), "ab");
});

test("editing after stepping back drops the checkpoints ahead", () => {
	// Otherwise ▶ would walk forward into text that, from where the operator
	// now is, was never typed.
	let s = beginSession(CFG, "a");
	s = checkpoint(s, "ab");
	s = checkpoint(s, "abc");
	s = stepTo(s, 0);
	s = checkpoint(s, "aZ");
	assert.deepEqual([...s.entries], ["a", "aZ"]);
	assert.equal(s.at, 1);
});

test("SAVING keeps the history — you can still step back past a save", () => {
	// The explicit requirement: flushed after you close, NOT after you save.
	let s = beginSession(CFG, "a");
	s = checkpoint(s, "ab");
	s = markSaved(s, "ab");
	assert.equal(isDirty(s), false, "the saved text is the new clean baseline");
	assert.ok(s.entries.length >= 2, "the history survived the save");
	assert.equal(currentText(stepTo(s, 0)), "a", "the pre-save text is still reachable");
});

test("saving text the history has not seen checkpoints it first", () => {
	let s = beginSession(CFG, "a");
	s = markSaved(s, "typed-then-saved-within-one-tick");
	assert.equal(currentText(s), "typed-then-saved-within-one-tick");
	assert.equal(isDirty(s), false);
	assert.equal(currentText(stepTo(s, 0)), "a");
});

test("the history is capped, keeping the RECENT past", () => {
	let s = beginSession(CFG, "v0");
	for (let i = 1; i <= MAX_ENTRIES + 10; i++) s = checkpoint(s, `v${i}`);
	assert.equal(s.entries.length, MAX_ENTRIES);
	assert.equal(currentText(s), `v${MAX_ENTRIES + 10}`);
	assert.equal(s.entries[0], `v${11}`, "the oldest revisions are what fall off");
	assert.equal(s.at, MAX_ENTRIES - 1);
});

test("a CRLF file from the board does not read as edited", () => {
	// CodeMirror hands text back with LF endings whatever it was given, so an
	// untouched CRLF file would otherwise look changed the instant the first
	// tick compared them.
	const s = beginSession(CFG, "M115\r\nG28\r\n");
	assert.equal(isDirty(s), false);
	assert.equal(checkpoint(s, "M115\nG28\n"), s, "the view's own text is not a change");
	assert.equal(isStale(s, "M115\r\nG28\r\n"), false, "nor did the board's copy move");
});

test("stepping back and forward through a CRLF file KEEPS the newer revision", () => {
	// The real-board bug: entries[0] came from a CRLF download, stepping back
	// put it in the view, the view handed back LF, checkpoint read that as an
	// edit, truncated the branch and destroyed the newer revision. Observed on
	// duet3 as lens=[115,126] becoming lens=[115,111].
	let s = beginSession(CFG, "M115\r\nG28\r\n");
	s = checkpoint(s, "M115\nG28\nG1 X1\n"); // typed, arriving LF from the view
	assert.equal(s.entries.length, 2);

	s = stepTo(s, 0);
	// What the view would hand back after being given entries[0]:
	s = checkpoint(s, s.entries[0]!);
	assert.equal(s.entries.length, 2, "stepping back must not truncate anything");
	assert.equal(s.at, 0, "nor move the position");

	s = stepTo(s, 1);
	assert.ok(currentText(s).includes("G1 X1"), "the newer revision survived the round trip");
});

test("a board copy that moved under the draft is detectable", () => {
	const s = checkpoint(beginSession(CFG, "a"), "ab");
	assert.equal(isStale(s, "a"), false);
	assert.equal(isStale(s, "a-changed-by-a-macro"), true);
});

// ---- storage ----

test("a session survives a reload, and CLOSING is what erases it", () => {
	ls.clear();
	let s = beginSession(CFG, "a");
	s = checkpoint(s, "ab");
	assert.equal(saveSession(s), true);

	const back = loadSession(CFG);
	assert.notEqual(back, null);
	assert.equal(currentText(back!), "ab", "the unsaved text came back");
	assert.equal(isDirty(back!), true);

	// Saving to the board must NOT flush it.
	assert.equal(saveSession(markSaved(s, "ab")), true);
	assert.notEqual(loadSession(CFG), null, "a save left the session in place");

	closeSession(CFG);
	assert.equal(loadSession(CFG), null, "closing flushed it");
});

test("a stored record filed under a DIFFERENT path is refused", () => {
	// The one failure here that destroys data: restoring config.g's text into an
	// editor open on homeall.g would write it over homeall.g on the next Save.
	ls.clear();
	ls.setItem(
		"dwc-ng.drafts",
		JSON.stringify({ "0:/sys/homeall.g": { path: CFG, baseline: "a", entries: ["a", "ab"], at: 1 } }),
	);
	assert.equal(loadSession("0:/sys/homeall.g"), null);
	assert.equal(loadSession(CFG), null, "nor is it reachable under the path it claims");
});

test("malformed or hostile storage yields no session, never a throw", () => {
	ls.clear();
	ls.setItem("dwc-ng.drafts", "{not json");
	assert.equal(loadSession(CFG), null);

	const bad = {
		"0:/a": { path: "0:/a", baseline: "x", entries: [], at: 0 },            // empty history
		"0:/b": { path: "0:/b", baseline: "x", entries: ["x"], at: 4 },         // index off the end
		"0:/c": { path: "0:/c", baseline: 7, entries: ["x"], at: 0 },           // baseline not text
		"0:/d": { path: "0:/d", baseline: "x", entries: ["x", 9], at: 0 },      // a non-string revision
		"0:/e": { path: "0:/e", baseline: "x", entries: ["x", "xy"], at: 1 },   // the one good record
	};
	ls.setItem("dwc-ng.drafts", JSON.stringify(bad));
	for (const path of ["0:/a", "0:/b", "0:/c", "0:/d"]) {
		assert.equal(loadSession(path), null, `${path} should not revive`);
	}
	assert.equal(currentText(loadSession("0:/e")!), "xy", "a good record beside bad ones still loads");
});

test("a prototype-reaching key cannot pollute the store", () => {
	ls.clear();
	ls.setItem("dwc-ng.drafts", JSON.stringify({ "__proto__": { path: "__proto__", baseline: "x", entries: ["x"], at: 0 } }));
	loadSession(CFG);
	assert.equal(({} as Record<string, unknown>)["baseline"], undefined);
});

test("the number of remembered files is capped, and the newest is never the one evicted", () => {
	ls.clear();
	for (let i = 0; i < 30; i++) saveSession(checkpoint(beginSession(`0:/sys/f${i}.g`, "a"), `edit${i}`));
	let kept = 0;
	for (let i = 0; i < 30; i++) if (loadSession(`0:/sys/f${i}.g`) !== null) kept++;
	assert.ok(kept <= 12, `capped at 12 files, kept ${kept}`);
	assert.notEqual(loadSession("0:/sys/f29.g"), null, "the file just written survived");
});

test("a session too large to store says so instead of pretending", () => {
	ls.clear();
	const huge = "x".repeat(600 * 1024);
	assert.equal(saveSession(checkpoint(beginSession("0:/sys/big.g", "a"), huge)), false);
});

// The exact sequence that destroyed a revision on duet3, where sys files are
// CRLF and the mock's are not: open a CRLF file, checkpoint an edit, step BACK
// and then forward. CodeMirror hands text back as LF whatever it was given, so
// without normalization the round trip reads as an edit nobody typed, truncates
// the forward history as a new branch, and the newer revision is gone.
test("a CRLF file survives step-back-then-forward with its history intact", () => {
	const session = beginSession("0:/sys/config.g", "G28\r\nG1 X0\r\n");
	const edited = checkpoint(session, "G28\nG1 X0\nG1 Y0\n");
	assert.equal(edited.entries.length, 2, "the edit is a second checkpoint");

	// Step back to the opened text, then forward again — the round trip a
	// stepper exists to make.
	const back = stepTo(edited, 0);
	// The view hands the SAME document back as LF. Before normalization this
	// looked like a change and dropped entries[1].
	const afterViewRoundTrip = checkpoint(back, "G28\nG1 X0\n");
	assert.equal(afterViewRoundTrip, back, "the view's own normalization is not an edit");

	const forward = stepTo(afterViewRoundTrip, 1);
	assert.equal(currentText(forward), "G28\nG1 X0\nG1 Y0\n", "the newer revision is still there");
	assert.equal(forward.entries.length, 2, "and nothing was truncated");
});

test("a CRLF file is not dirty the moment it opens", () => {
	const session = beginSession("0:/sys/config.g", "G28\r\nG1 X0\r\n");
	assert.equal(isDirty(session), false, "every CRLF file would otherwise show unsaved on the first tick");
	assert.equal(isStale(session, "G28\r\nG1 X0\r\n"), false, "nor changed on the board");
	assert.equal(isDirty(checkpoint(session, "G28\nG1 X0\n")), false, "nor after the view returns it as LF");
});
