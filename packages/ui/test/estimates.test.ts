import { test } from "node:test";
import assert from "node:assert/strict";
import { headlineRemaining, estimateSources } from "../src/om/estimates.ts";

test("headline prefers filament, then file, then slicer", () => {
	assert.deepEqual(headlineRemaining({ filament: 100, file: 200, slicer: 300 }), { seconds: 100, source: "filament" });
	assert.deepEqual(headlineRemaining({ filament: null, file: 200, slicer: 300 }), { seconds: 200, source: "file" });
	assert.deepEqual(headlineRemaining({ filament: null, file: null, slicer: 300 }), { seconds: 300, source: "slicer" });
});

test("headline is null when no source is published", () => {
	assert.equal(headlineRemaining({ filament: null, file: null, slicer: null }), null);
});

test("a zero estimate is a real value, not absent", () => {
	// A finished-by-bytes print reports file: 0 while the slicer still guesses
	// time left — 0 must win as the headline, not fall through to slicer.
	assert.deepEqual(headlineRemaining({ filament: null, file: 0, slicer: 45 }), { seconds: 0, source: "file" });
});

test("breakdown lists present sources in fixed file/filament/slicer order", () => {
	assert.deepEqual(estimateSources({ filament: 100, file: 200, slicer: 300 }), [
		{ seconds: 200, source: "file" },
		{ seconds: 100, source: "filament" },
		{ seconds: 300, source: "slicer" },
	]);
});

test("breakdown drops absent sources but keeps the order of the rest", () => {
	assert.deepEqual(estimateSources({ filament: 100, file: null, slicer: 300 }), [
		{ seconds: 100, source: "filament" },
		{ seconds: 300, source: "slicer" },
	]);
});

test("breakdown is empty when nothing is published", () => {
	assert.deepEqual(estimateSources({ filament: null, file: null, slicer: null }), []);
});
