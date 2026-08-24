/**
 * What the Candidates card is allowed to show, and why the old answer was
 * useless on a real machine.
 *
 * `rank` sorts on `worstRobust` with `durationS` only a tie-break at 0.001
 * granularity, so the tie never fires between shaper types — the widest shaper
 * wins the residual contest outright, every time, on any machine. Taking the
 * top 40 of that order gave forty rows of ONE shaper. Measured on Gabe's
 * fingerprint (X 38.66, Y 50.05) every one of the top fifty was `zvddd`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rank, shortlist } from "../src/shaping/engine/rank.ts";
import { candidateCaveats } from "../src/shaping/evidence/findings.ts";
import { caveatText } from "../src/shaping/copy.ts";
import { held, type Provenance } from "../src/shaping/evidence/evidence.ts";
import type { Fingerprint, Mode } from "../src/shaping/engine/fit.ts";
import { g, hz } from "../src/shaping/engine/units.ts";

const mode = (f: number, z: number): Mode => ({ f: hz(f), zeta: z, peakG: g(0.2), cyclesFit: 3 } as Mode);

/** Gabe's board, read 2026-08-24 from 0:/sys/dwc-ng/shaping/tool0.json. */
const REAL: Fingerprint = { X: mode(38.66, 0.12), Y: mode(50.05, 0.08), n: { X: 20, Y: 10 }, spreadHz: { X: 0.65, Y: 8.91 } };

const typesIn = (cs: ReadonlyArray<{ spec: { type: string } }>) => new Set(cs.map((c) => c.spec.type));

test("the residual order really is one shaper — this is the defect, pinned", () => {
	// If this ever stops being true the shortlist is solving a problem that
	// went away, and somebody should find out why before deleting it.
	const top = rank(REAL).slice(0, 40);
	assert.equal(typesIn(top).size, 1, "the plain order is single-type on this machine");
	assert.ok(top.every((c) => c.spec.type === "zvddd"));
});

test("the shortlist shows the trade instead", () => {
	const front = shortlist(rank(REAL), 40);
	assert.ok(typesIn(front).size >= 4, `only ${typesIn(front).size} types on the list`);
	// The two ends: most robust and shortest.
	const best = front[0]!;
	const lean = front.reduce((a, b) => (Number(b.durationS) < Number(a.durationS) ? b : a));
	assert.ok(Number(best.durationS) > Number(lean.durationS) * 1.5, "the ends must differ enough to be a choice");
	assert.ok(best.worstRobust < lean.worstRobust, "and the shorter one must cost residual");
});

test("no row on the shortlist is beaten outright by another row", () => {
	// The invariant: shortlist-is-dominated-free. A row that is worse on BOTH
	// axes than some other row is a row nobody could ever have a reason to pick.
	const front = shortlist(rank(REAL), 40);
	for (const a of front) {
		for (const b of front) {
			if (a === b) continue;
			const dominated =
				b.worstRobust <= a.worstRobust &&
				Number(b.durationS) <= Number(a.durationS) &&
				(b.worstRobust < a.worstRobust || Number(b.durationS) < Number(a.durationS));
			assert.ok(!dominated, `${a.spec.type} ${a.worstRobust} is dominated by ${b.spec.type} ${b.worstRobust}`);
		}
	}
});

test("the per-type cap limits rows without letting a dominated one in", () => {
	const front = shortlist(rank(REAL), 40, 2);
	const counts = new Map<string, number>();
	for (const c of front) counts.set(c.spec.type, (counts.get(c.spec.type) ?? 0) + 1);
	for (const [t, n] of counts) assert.ok(n <= 2, `${t} appears ${n} times`);
	// Capping must not resurrect a longer row of an already-capped type.
	let shortest = Number.POSITIVE_INFINITY;
	for (const c of front) {
		assert.ok(Number(c.durationS) < shortest, "rows must strictly shorten down the list");
		shortest = Number(c.durationS);
	}
});

test("an empty grid shortlists to nothing rather than throwing", () => {
	assert.deepEqual(shortlist([], 40), []);
});

test("the card says the ordering ignores the cost", () => {
	const front = shortlist(rank(REAL), 40);
	const prov: Provenance = { kind: "unknown", why: "not recorded" };
	const c = candidateCaveats(front, held(null, prov, []), 0).find((x) => x.kind === "ranking-trade-off");
	assert.ok(c !== undefined && c.kind === "ranking-trade-off");
	assert.ok(c.bestMs > c.leanMs);
	assert.ok(c.bestResidual < c.leanResidual);
	const text = caveatText(c);
	assert.match(text, /ms/);
	assert.match(text, /%/);
	assert.match(text, /ordered by ringing left/);
});

test("a one-entry list has no trade to report", () => {
	const prov: Provenance = { kind: "unknown", why: "not recorded" };
	const one = shortlist(rank(REAL), 1);
	assert.equal(candidateCaveats(one, held(null, prov, []), 0).filter((c) => c.kind === "ranking-trade-off").length, 0);
});
