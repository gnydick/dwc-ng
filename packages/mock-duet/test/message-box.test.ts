import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock } from "./helpers.ts";

/** Read state.messageBox out of a full-model query. */
async function readBox(mock: Awaited<ReturnType<typeof startMock>>, key: number) {
	const res = await mock.getJson("rr_model?key=state&flags=d99vno", key);
	return res.result.messageBox ?? null;
}

const gcode = (code: string) => `rr_gcode?gcode=${encodeURIComponent(code)}`;

test("M291 raises a message box the model reports", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	assert.equal(await readBox(mock, key), null, "no box before M291");

	await mock.getJson(gcode('M291 P"Insert filament" R"Filament change" S3'), key);

	const box = await readBox(mock, key);
	assert.equal(box.message, "Insert filament");
	assert.equal(box.title, "Filament change");
	assert.equal(box.mode, 3);
	assert.equal(box.cancelButton, true, "okCancel mode implies a cancel button");
});

test("M291 parses each quoted parameter separately, not just the first", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	// A naive "first quoted string" parser puts the message into the title too.
	await mock.getJson(gcode('M291 P"the message" R"the title" S2'), key);

	const box = await readBox(mock, key);
	assert.equal(box.message, "the message");
	assert.equal(box.title, "the title");
});

test("M291 K{...} carries multiple choices", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	await mock.getJson(gcode('M291 P"Which side?" S4 K{"Left","Right","Neither"}'), key);

	const box = await readBox(mock, key);
	assert.deepEqual(box.choices, ["Left", "Right", "Neither"]);
	assert.equal(box.mode, 4);
});

test("M292 with the matching seq dismisses the box", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	await mock.getJson(gcode('M291 P"hi" S2'), key);
	const box = await readBox(mock, key);

	await mock.getJson(gcode(`M292 S${box.seq}`), key);
	assert.equal(await readBox(mock, key), null);
});

// This is the whole reason M292 carries S: a tool-change macro can raise
// several boxes in a row, and an acknowledge aimed at box N must not silently
// dismiss box N+1 that replaced it between render and click.
test("M292 with a stale seq is ignored, leaving the box open", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	await mock.getJson(gcode('M291 P"first" S2'), key);
	const first = await readBox(mock, key);

	await mock.getJson(gcode(`M292 S${first.seq + 99}`), key);

	const still = await readBox(mock, key);
	assert.notEqual(still, null, "a mismatched seq must not dismiss the box");
	assert.equal(still.seq, first.seq);
});

test("seqs are never reused, so a late acknowledge can't hit a later box", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	await mock.getJson(gcode('M291 P"first" S2'), key);
	const first = await readBox(mock, key);
	await mock.getJson(gcode(`M292 S${first.seq}`), key);

	await mock.getJson(gcode('M291 P"second" S2'), key);
	const second = await readBox(mock, key);

	assert.notEqual(second.seq, first.seq, "a dismissed seq must not come round again");

	// The operator's slow click on the FIRST box must not dismiss the second.
	await mock.getJson(gcode(`M292 S${first.seq}`), key);
	assert.notEqual(await readBox(mock, key), null);
});

test("raising a box bumps seqs.state so a polling client refetches", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const before = (await mock.getJson("rr_model?flags=d99fn", key)).result.seqs.state;
	await mock.getJson(gcode('M291 P"hi" S2'), key);
	const after = (await mock.getJson("rr_model?flags=d99fn", key)).result.seqs.state;

	assert.ok(after > before, `state seq must advance (${before} -> ${after})`);
});
