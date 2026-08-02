import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	parseHeightMap, serializeHeightMap, cellPosition, gridStats,
} from "../src/heightmap/parse.ts";

const CAPTURE = new URL(
	"../../mock-duet/captures/duet3-real-2026-07-15/heightmap.csv",
	import.meta.url,
);
const csv = (): string => readFileSync(CAPTURE, "utf8");

test("parses the real machine's height map", () => {
	const map = parseHeightMap(csv());
	assert.ok(map, "capture must parse");
	assert.equal(map.meta.axis0, "X");
	assert.equal(map.meta.axis1, "Y");
	assert.equal(map.meta.num0, 16);
	assert.equal(map.meta.num1, 16);
	assert.equal(map.meta.min0, 5);
	assert.equal(map.meta.max0, 335);
	assert.equal(map.meta.spacing0, 22);
	assert.equal(map.meta.radius, -1, "rectangular bed, not delta");
	assert.equal(map.rows.length, 16);
	assert.ok(map.rows.every(r => r.length === 16), "every row is num0 wide");
	assert.equal(map.rows[0]?.[0], 0.067);
});

test("round-trips the real capture byte-for-byte", () => {
	// This single test pins the format, the number formatting AND the derived
	// statistics arithmetic. If RRF's output is not byte-stable this is the
	// test that says so.
	const original = csv();
	const map = parseHeightMap(original);
	assert.ok(map);
	assert.equal(serializeHeightMap(map), original);
});

test("the header statistics are DERIVED, not carried through", () => {
	const map = parseHeightMap(csv());
	assert.ok(map);
	map.rows[0]![0] = 9.999 as typeof map.rows[0][0]; // an obviously out-of-range value
	const out = serializeHeightMap(map);
	assert.match(out, /max error 9\.999/, "max must reflect the edited grid");
	assert.doesNotMatch(out, /max error 0\.150/, "the original max must not survive");
});

test("gridStats computes min, max, mean and population deviation", () => {
	const stats = gridStats([[0, 2], [4, 6]]);
	assert.equal(stats.min, 0);
	assert.equal(stats.max, 6);
	assert.equal(stats.mean, 3);
	// population sd of 0,2,4,6 = sqrt(5) = 2.2360679...
	assert.ok(Math.abs(stats.deviation - Math.sqrt(5)) < 1e-9);
});

test("cellPosition maps grid indices to bed coordinates", () => {
	const map = parseHeightMap(csv());
	assert.ok(map);
	assert.deepEqual(cellPosition(map.meta, 0, 0), { x: 5, y: 5 });
	// col advances along axis0 by spacing0, row along axis1 by spacing1
	assert.deepEqual(cellPosition(map.meta, 0, 1), { x: 27, y: 5 });
	const last = cellPosition(map.meta, 15, 15);
	assert.ok(Math.abs(last.x - 335) < 0.01, `x ${last.x}`);
	assert.ok(Math.abs(last.y - 295) < 0.01, `y ${last.y}`);
});

test("malformed input yields null rather than throwing", () => {
	for (const bad of ["", "not a height map", "RepRapFirmware height map file v2\n"]) {
		assert.equal(parseHeightMap(bad), null, JSON.stringify(bad));
	}
});

test("a row of the wrong width is rejected", () => {
	const broken = csv().replace(/\n {2}0\.067.*$/m, "\n  0.067,  0.017");
	assert.equal(parseHeightMap(broken), null);
});

test("negative zero survives a round trip", () => {
	// RRF writes "-0.000" for a point that rounded down to zero from below, and
	// that is meaningful: the point measured slightly low. Number("-0.000") is
	// -0, but (-0).toFixed(3) is "0.000" in JS, so the sign is lost unless it is
	// handled explicitly.
	const map = parseHeightMap(csv());
	assert.ok(map);
	assert.ok(Object.is(map.rows[0]?.[2], -0), "the capture's -0.000 must parse to -0");
	assert.match(serializeHeightMap(map).split("\n")[3] ?? "", /^ {2}0\.067, {2}0\.017, -0\.000/);
});

test("the stored spacing is preserved even though positions do not use it", () => {
	// Geometry is not ours to rewrite: the file keeps RRF's rounded 19.33 while
	// cellPosition derives the exact step from the bounds.
	const map = parseHeightMap(csv());
	assert.ok(map);
	assert.equal(map.meta.spacing1, 19.33);
	assert.match(serializeHeightMap(map).split("\n")[2] ?? "", /,19\.33,/);
	assert.equal(cellPosition(map.meta, 15, 0).y, 295);
});
