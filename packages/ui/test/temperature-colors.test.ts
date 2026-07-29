import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseOverlay } from "../src/config/parse.ts";
import { DEFAULT_CONFIG, DEFAULT_THERMAL_COLORS } from "../src/config/types.ts";
import { heaterSeries, BED_COLOR, TOOL_COLORS } from "../src/om/heaterSeries.ts";
import { deltaE, isHexColor, expandHex, nearestCollision, MIN_SEPARATION } from "../src/util/colorDistance.ts";

const model = (heaterCount: number, bed: number[] = [0]) => ({
	heaters: Array.from({ length: heaterCount }, () => ({ current: 20 })) as never,
	bedHeaters: bed,
	chamberHeaters: [],
	tools: [],
});

// ---- the hex gate ----

test("isHexColor accepts #rgb and #rrggbb, rejects everything else", () => {
	for (const good of ["#fff", "#FFF", "#6e8ca8", "#6E8CA8"]) {
		assert.equal(isHexColor(good), true, good);
	}
	for (const bad of [
		null, undefined, 42, {}, [], "", "fff", "#ff", "#ffff", "#fffff",
		"#gggggg", "red", "rgb(1,2,3)", "#6e8ca8;", " #6e8ca8",
		// The one that matters: a CSS injection attempt must not reach a style slot.
		"#000;background:url(http://evil/)",
	]) {
		assert.equal(isHexColor(bad), false, JSON.stringify(bad));
	}
});

test("expandHex widens the short form so ΔE compares like with like", () => {
	assert.equal(expandHex("#fff"), "#ffffff");
	assert.equal(expandHex("#6e8ca8"), "#6e8ca8");
	assert.equal(deltaE("#fff", "#ffffff"), 0);
});

// ---- ΔE, shared with the palette test ----

test("deltaE is zero for identical colours and symmetric", () => {
	assert.equal(deltaE(BED_COLOR, BED_COLOR), 0);
	assert.equal(
		deltaE(TOOL_COLORS[0]!, TOOL_COLORS[1]!).toFixed(6),
		deltaE(TOOL_COLORS[1]!, TOOL_COLORS[0]!).toFixed(6),
	);
});

test("nearestCollision reports the CLOSEST offender, not the first", () => {
	// #c9a227 is the bed's gold; a near-gold pick should name the bed even
	// though a far-off entry is listed first.
	const hit = nearestCollision("#c9a227", [["Teal", "#6bccb7"], ["Bed", "#e0b84a"]]);
	assert.equal(hit?.label, "Bed");
	assert.ok(hit!.separation < MIN_SEPARATION);
});

test("nearestCollision returns null when everything clears the floor", () => {
	assert.equal(nearestCollision(BED_COLOR, [["t0", TOOL_COLORS[0]!], ["t1", TOOL_COLORS[1]!]]), null);
});

test("nearestCollision ignores malformed entries rather than throwing", () => {
	assert.equal(nearestCollision("#6e8ca8", [["bad", "not-a-colour"], ["worse", ""]]), null);
});

// ---- overrides ----

test("an override replaces exactly one line and leaves the others derived", () => {
	const base = heaterSeries(model(4));
	const withOverride = heaterSeries(model(4), { "2": "#ff00ff" });
	assert.equal(withOverride[2]!.stroke, "#ff00ff");
	assert.equal(withOverride[2]!.label, base[2]!.label, "an override must not rename the series");
	for (const i of [0, 1, 3]) {
		assert.equal(withOverride[i]!.stroke, base[i]!.stroke, `heater ${i} must be untouched`);
	}
});

test("overriding a tool does NOT renumber the palette for the tools after it", () => {
	// The regression this guards: if the palette counter skipped overridden
	// heaters, clearing one override would recolour every line after it.
	const base = heaterSeries(model(5));
	const withOverride = heaterSeries(model(5), { "1": "#ff00ff" });
	assert.equal(withOverride[2]!.stroke, base[2]!.stroke);
	assert.equal(withOverride[3]!.stroke, base[3]!.stroke);
	assert.equal(withOverride[4]!.stroke, base[4]!.stroke);
});

test("the bed can be overridden too", () => {
	assert.equal(heaterSeries(model(3))[0]!.stroke, BED_COLOR);
	assert.equal(heaterSeries(model(3), { "0": "#123456" })[0]!.stroke, "#123456");
});

test("no overrides is identical to the derived palette", () => {
	assert.deepEqual(heaterSeries(model(4), {}), heaterSeries(model(4)));
});

// ---- parsing at the untrusted boundary ----

test("parseOverlay keeps valid heater colours and drops invalid ones", () => {
	const overlay = parseOverlay({
		heaterColors: { "0": "#c9a227", "1": "chartreuse", "2": "#6bccb7", "3": 42 },
	});
	assert.deepEqual(overlay.heaterColors, { "0": "#c9a227", "2": "#6bccb7" });
});

test("parseOverlay drops prototype-reaching keys in heaterColors", () => {
	const overlay = parseOverlay(JSON.parse('{"heaterColors":{"__proto__":"#fff","0":"#c9a227"}}'));
	assert.deepEqual(overlay.heaterColors, { "0": "#c9a227" });
	assert.equal(({} as Record<string, unknown>)["0"], undefined, "prototype must be unpolluted");
});

test("thermalColors is rebuilt channel by channel; a bad channel drops alone", () => {
	assert.deepEqual(
		parseOverlay({ thermalColors: { cold: "#111111", warm: "nope", hot: "#333333" } }).thermalColors,
		{ cold: "#111111", hot: "#333333" },
	);
	assert.equal(parseOverlay({ thermalColors: { cold: "nope" } }).thermalColors, undefined);
	assert.equal(parseOverlay({ thermalColors: "nope" }).thermalColors, undefined);
});

test("DEFAULT_CONFIG customises no heater and ships the full ramp", () => {
	assert.deepEqual(DEFAULT_CONFIG.heaterColors, {});
	assert.deepEqual(DEFAULT_CONFIG.thermalColors, DEFAULT_THERMAL_COLORS);
	for (const channel of ["cold", "warm", "hot"] as const) {
		assert.equal(isHexColor(DEFAULT_THERMAL_COLORS[channel]), true, channel);
	}
});

/**
 * index.css declares --t-cold/--t-warm/--t-hot for the first paint; App.tsx
 * overwrites them from config.thermalColors once the store exists. If the two
 * disagree, the UI visibly shifts colour a frame after boot for a user who has
 * customised nothing.
 */
test("index.css and DEFAULT_THERMAL_COLORS declare the same ramp", () => {
	const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
	for (const [channel, expected] of Object.entries(DEFAULT_THERMAL_COLORS)) {
		const match = css.match(new RegExp(`--t-${channel}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`));
		assert.notEqual(match, null, `index.css declares no --t-${channel}`);
		assert.equal(
			match![1]!.toLowerCase(), expected.toLowerCase(),
			`--t-${channel} in index.css must match DEFAULT_THERMAL_COLORS`,
		);
	}
});
