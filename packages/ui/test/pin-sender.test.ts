import test from "node:test";
import assert from "node:assert/strict";
import { batchPins } from "../src/control/pinSender.ts";
import type { PinnedCommand } from "../src/config/types.ts";

const pin = (command: string, enabled: boolean, key?: string): PinnedCommand => ({
	id: `p-${command}`, command, enabled, ...(key !== undefined ? { key } : {}),
});

test("only ENABLED, non-empty pins are sent", () => {
	const pins = [
		pin("M204 P6000", true),
		pin("M106 P0 S0.50", false), // disabled — skipped
		pin("   ", true),            // blank — skipped
	];
	assert.equal(batchPins(pins), "M204 P6000");
});

test("all enabled pins go out in ONE newline-joined request", () => {
	// Batching is the point: one request per tick however many pins, so the
	// weak embedded server sees a fixed rate.
	const pins = [pin("M204 P6000", true), pin("M106 P0 S0.50", true, "fan:0")];
	assert.equal(batchPins(pins), "M204 P6000\nM106 P0 S0.50");
});

test("commands are trimmed", () => {
	assert.equal(batchPins([pin("  M204 P6000  ", true)]), "M204 P6000");
});

test("nothing enabled → null (no request at all)", () => {
	assert.equal(batchPins([pin("M204 P6000", false)]), null);
	assert.equal(batchPins([]), null);
});

test("order is preserved — pins fire in list order each tick", () => {
	const pins = [pin("M106 P0 S1", true), pin("M204 P6000", true), pin("M572 D0 S0.05", true)];
	assert.equal(batchPins(pins), "M106 P0 S1\nM204 P6000\nM572 D0 S0.05");
});
