import { test } from "node:test";
import assert from "node:assert/strict";
import { prosCons, type Note } from "../src/shaping/engine/recommend.ts";
import { rank, customCandidate } from "../src/shaping/engine/rank.ts";
import { hz, seconds } from "../src/shaping/engine/units.ts";
import { modeForTest, prototypeFingerprint } from "./helpers/shaping.ts";

const fp = prototypeFingerprint();
const ranked = rank(fp);
const find = (type: string, F: number, S: number) => ranked.find((c) => c.spec.type === type && "F" in c.spec && c.spec.F === F && c.spec.S === S)!;
const rules = (notes: Note[]): string[] => notes.map((n) => `${n.kind}:${n.rule}`);

test("ei2 F52: short-shaper pro, robust-band pro with several tools, unverified con", () => {
	const notes = prosCons(find("ei2", 52, 0.1), { fp, toolsConfigured: 4 });
	const r = rules(notes);
	assert.ok(r.includes("pro:short-shaper") && r.includes("pro:robust-band") && r.includes("con:unverified"), r.join(","));
	assert.ok(!r.includes("con:long-shaper"));
});

test("zvdd F17.5: long-shaper con names the duration; both-axes-by-harmonic note fires", () => {
	const notes = prosCons(find("zvdd", 17.5, 0.2), { fp, toolsConfigured: 1 });
	const r = rules(notes);
	assert.ok(r.includes("con:long-shaper"));
	assert.ok(notes.find((n) => n.rule === "long-shaper")!.text.includes("ms"));
	assert.ok(r.includes("note:both-axes-by-harmonic"), r.join(","));
});

test("zvd with several tools: narrow-band con; with one tool: no band note", () => {
	assert.ok(rules(prosCons(find("zvd", 52, 0.1), { fp, toolsConfigured: 4 })).includes("con:narrow-band"));
	const one = rules(prosCons(find("zvd", 52, 0.1), { fp, toolsConfigured: 1 }));
	assert.ok(!one.includes("con:narrow-band") && !one.includes("pro:robust-band"));
});

test("mzv always carries the RRF-ordering con", () => {
	assert.ok(rules(prosCons(find("mzv", 52, 0.1), { fp, toolsConfigured: 1 })).includes("con:mzv-rrf-ordering"));
});

test("measured-damping pro exactly when S is within 0.02 of a fitted zeta", () => {
	for (const S of [0.05, 0.1, 0.15, 0.2]) {
		const expected = [fp.X!, fp.Y!].some((m) => Math.abs(S - m.zeta) <= 0.02);
		const got = rules(prosCons(find("ei2", 52, S), { fp, toolsConfigured: 1 })).includes("pro:measured-damping");
		assert.equal(got, expected, `S ${S} (zeta X ${fp.X!.zeta.toFixed(3)}, Y ${fp.Y!.zeta.toFixed(3)})`);
	}
	assert.ok([0.05, 0.1, 0.15, 0.2].some((S) => [fp.X!, fp.Y!].some((m) => Math.abs(S - m.zeta) <= 0.02)), "at least one grid S is near a measured zeta");
});

test("a verified candidate with an artefact gets the artefact con and no unverified con", () => {
	const notes = prosCons(find("zvdd", 17.5, 0.2), {
		fp,
		toolsConfigured: 1,
		verified: { measured: { X: 1.67, Y: 1.18 }, artefacts: [{ axis: "X", hz: hz(38), peakG: modeForTest(38, 0.13, 0.25).peakG }] },
	});
	const r = rules(notes);
	assert.ok(r.includes("con:artefact") && !r.includes("con:unverified"));
	assert.ok(notes.find((n) => n.rule === "artefact")!.text.includes("38 Hz"));
});

test("custom candidates get duration notes but no named-type notes", () => {
	const c = customCandidate({ type: "custom", H: [0.335, 0.2641, 0.2242], T: [seconds(0.00972), seconds(0.0278), seconds(0.03752)] }, fp);
	const r = rules(prosCons(c, { fp, toolsConfigured: 4 }));
	assert.ok(!r.includes("pro:robust-band") && !r.includes("con:mzv-rrf-ordering") && !r.includes("note:both-axes-by-harmonic"));
	assert.ok(r.includes("con:unverified"));
});
