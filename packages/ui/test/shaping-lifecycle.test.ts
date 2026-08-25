/**
 * One value decides a control's enabled state, its confirm sentence and its
 * note — the same guarantee `stepReadiness` gives one level down.
 *
 * The copy is injected, so these assertions are about the LIFECYCLE and not
 * about the wording: a reworded sentence must not turn this file red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type CaveatCopy, held, lifecycleOf, type Provenance } from "../src/shaping/evidence/evidence.ts";
import type { Caveat } from "../src/shaping/evidence/caveat.ts";
import { caveatText, provenanceText, supersedeText } from "../src/shaping/copy.ts";
import { hz } from "../src/shaping/engine/units.ts";
import { measuredUnder } from "./helpers/shaping.ts";

const MEASURED: Provenance = measuredUnder();
const UNKNOWN: Provenance = { kind: "unknown", why: "conditions were not recorded" };
const ADVISORY: Caveat = { kind: "few-fits", axis: "Y", n: 3, of: 10 };
const DISQUALIFYING: Caveat = { kind: "mode-on-forcing-locus", axis: "X", modeHz: hz(125), speedMmPerS: 25 };

/** The real table, so the sentences are the ones the screen shows. */
const COPY: CaveatCopy = { caveat: caveatText, supersede: supersedeText, provenance: provenanceText };

test("a sound product gives a plain enabled control", () => {
	assert.equal(lifecycleOf(held(1, MEASURED, []), COPY).kind, "enabled");
});

test("a caveated product arms the control with the reason as the confirm", () => {
	const l = lifecycleOf(held(1, MEASURED, [ADVISORY]), COPY);
	assert.equal(l.kind, "armed");
	assert.ok(l.kind === "armed" && l.confirm.includes("3"), "the confirm must carry the caveat's own numbers");
});

test("an unattributable product arms rather than blocks", () => {
	// Hand-assembled captures are the only reason 259 prototype captures are
	// usable at all. They must be MARKED, not blocked.
	const l = lifecycleOf(held(1, UNKNOWN, []), COPY);
	assert.equal(l.kind, "armed");
	assert.ok(l.kind === "armed" && /cannot be checked/.test(l.confirm));
});

test("a hand-assembled product arms with a sentence that names WHY it cannot be checked", () => {
	// Newly reachable with #57: `assembled` is unattributable too, so the
	// confirm has to have words. Before the copy table gained a provenance row
	// this rendered as a bare em dash — an armed dialog asking the operator to
	// agree to nothing.
	const l = lifecycleOf(held(1, { kind: "assembled", n: 12 }, []), COPY);
	assert.equal(l.kind, "armed");
	if (l.kind !== "armed") return;
	assert.match(l.confirm, /12 captures/, "the count the operator ticked");
	assert.match(l.confirm, /tool, the shaper or the acceleration/, "what is missing, by name");
	assert.match(l.confirm, /cannot be checked/);
});

test("every provenance arm has a sentence, and none of them is empty", () => {
	// The same standard `refusalText` and `caveatText` are held to. An arm with
	// no words renders as an armed confirm over nothing.
	const arms: readonly Provenance[] = [
		MEASURED,
		{ kind: "assembled", n: 1 },
		{ kind: "loaded", path: "0:/sys/dwc-ng/shaping/tool0.json" },
		UNKNOWN,
	];
	for (const p of arms) {
		const text = provenanceText(p);
		assert.ok(text.length > 20, `${p.kind}: ${JSON.stringify(text)}`);
		assert.equal(text.trim(), text, `${p.kind} has stray whitespace`);
	}
	// One capture is not "1 captures".
	assert.match(provenanceText({ kind: "assembled", n: 1 }), /this is one capture/);
});

test("a disqualified product disables and names the remedy", () => {
	const l = lifecycleOf(held(1, MEASURED, [DISQUALIFYING]), COPY);
	assert.equal(l.kind, "disabled");
	assert.ok(l.kind === "disabled" && /ripple|current, microstepping/i.test(l.note));
});

test("a superseded product arms with what changed under it", () => {
	const l = lifecycleOf({ state: "superseded", value: 1, cause: { kind: "tool-changed", was: 0, now: 2 } }, COPY);
	assert.equal(l.kind, "armed");
	assert.ok(l.kind === "armed" && /T0|T2/.test(l.confirm));
});

test("absent, running and failed are all disabled with their own note", () => {
	assert.equal(lifecycleOf({ state: "absent" }, COPY).kind, "disabled");
	assert.equal(lifecycleOf({ state: "running", what: "measuring" }, COPY).kind, "disabled");
	const f = lifecycleOf({ state: "failed", why: "the run was cancelled" }, COPY);
	assert.equal(f.kind, "disabled");
	assert.ok(f.kind === "disabled" && /cancelled/.test(f.note));
});

test("a disqualifying caveat never merely arms — it is the one thing that disables", () => {
	// The rule the whole layer turns on: a caveat may cost the operator a
	// sentence to read, and only an unactionable one may cost them the control.
	for (const caveats of [[ADVISORY], [ADVISORY, ADVISORY]]) {
		assert.equal(lifecycleOf(held(1, MEASURED, caveats), COPY).kind, "armed");
	}
	assert.equal(lifecycleOf(held(1, MEASURED, [ADVISORY, DISQUALIFYING]), COPY).kind, "disabled");
});
