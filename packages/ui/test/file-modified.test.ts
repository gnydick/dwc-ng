import { test } from "node:test";
import assert from "node:assert/strict";
import { formatModified } from "../src/files/format.ts";

test("formatModified shows date AND time from RRF's ISO stamp", () => {
	assert.equal(formatModified("2026-07-20T23:10:00"), "2026-07-20 23:10");
});

test("formatModified leaves the board's LOCAL time unshifted", () => {
	// Deliberately string-sliced, not parsed through new Date(): RRF reports
	// local wall-clock with no zone, so 23:10 must stay 23:10 regardless of the
	// viewer's timezone. A Date()-based formatter would fail this in most zones.
	assert.equal(formatModified("2026-01-01T00:30:00"), "2026-01-01 00:30");
	assert.equal(formatModified("2026-12-31T23:59:59"), "2026-12-31 23:59");
});

test("formatModified tolerates a date-only value and missing dates", () => {
	assert.equal(formatModified("2026-07-20"), "2026-07-20");
	assert.equal(formatModified(undefined), "");
	assert.equal(formatModified(""), "");
});
