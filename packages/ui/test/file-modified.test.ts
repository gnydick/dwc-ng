import { test } from "node:test";
import assert from "node:assert/strict";
import { formatModified, formatTimestamp } from "../src/files/format.ts";

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

// --- formatTimestamp: backups need the DATE, not just the time -------------

test("formatTimestamp shows date AND time to the minute, zero-padded", () => {
	// Built from LOCAL components on both sides, so the expectation holds in
	// any timezone the suite runs in. Single-digit month/day/hour/minute all
	// exercise the padding.
	assert.equal(formatTimestamp(new Date(2026, 0, 5, 9, 7, 3).getTime()), "2026-01-05 09:07");
	assert.equal(formatTimestamp(new Date(2026, 11, 31, 23, 59, 59).getTime()), "2026-12-31 23:59");
});

test("formatTimestamp emits the SAME shape formatModified does", () => {
	// One timestamp format across the app: the file browser's modified column
	// and the backup list must not drift apart. Same wall-clock, same string.
	assert.equal(
		formatTimestamp(new Date(2026, 6, 20, 23, 10, 0).getTime()),
		formatModified("2026-07-20T23:10:00"),
	);
});

test("formatTimestamp renders the viewer's LOCAL time, not UTC", () => {
	// The failure this pins: toISOString() would render UTC, showing the wrong
	// hour off UTC and — near midnight — the wrong DAY, which defeats the whole
	// point of adding the date. Asserting against the Date's own local getters
	// is the contract; a UTC-based implementation fails this wherever the
	// offset is non-zero.
	const d = new Date(2026, 6, 25, 0, 30, 0);
	assert.equal(formatTimestamp(d.getTime()), "2026-07-25 00:30");
	assert.equal(formatTimestamp(d.getTime()).slice(0, 10), `${d.getFullYear()}-07-${String(d.getDate()).padStart(2, "0")}`);
});

test("formatTimestamp is fixed width so a list of them never reflows", () => {
	const widths = new Set([
		new Date(2026, 0, 1, 0, 0, 0),
		new Date(2026, 11, 31, 23, 59, 59),
		new Date(2026, 6, 9, 5, 5, 5),
	].map(d => formatTimestamp(d.getTime()).length));
	assert.deepEqual([...widths], [16], "every stamp is exactly 16 characters");
});

test("formatTimestamp yields empty string for an unusable value", () => {
	assert.equal(formatTimestamp(Number.NaN), "");
});
