/**
 * #51 — the procedure selects the head it is measuring, and gives it back.
 *
 * Before this, `packages/ui/src/shaping/` contained no `T` code at all. The
 * operator picked a tool on the screen, the procedure measured WHATEVER head
 * happened to be on the carriage, and `store.setMeasurement` filed the answer
 * under the tool that had been picked. Carriage mass is what moves the
 * resonant frequency, so on a four-head changer that is a plausible-looking
 * wrong number which then ranks candidates, produces an `M593` line and is
 * written into `tpost<N>.g`.
 *
 * The two halves are equally load-bearing and both are pinned here:
 *
 *  1. The run SELECTS the tool, as a planned step, before it records anything
 *     — and it lands the carriage on the plan's own start, because a tool
 *     change is real motion (dock, undock) and every step after it declares
 *     the position it must start from. The fake board models that motion: it
 *     parks at a dock on every change, so a run that did not plan the approach
 *     would fail its very next position check.
 *  2. The run GIVES THE TOOL BACK, to whatever was mounted when it opened —
 *     which may be no tool at all — on every exit path, through the same
 *     `#restore` array that already puts the shaper back. `T-1` is DWC's
 *     answer (RecordMotionProfileDialog.vue:517-525, read-only reference) and
 *     is not ours: it is only correct when nothing was mounted to begin with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { planProcedure, type ProcEvent, type RingPlan } from "../src/shaping/procedure.ts";
import { Preconditions, runPriorOf, type RunPrior } from "../src/shaping/preconditions.ts";
import {
	EI2_PRIOR, NOW, RATE, config, drain, errorOf, fakeBoard, freshPre, kinds, modelWith, ringPlan, testClock,
	type FakeOptions,
} from "./helpers/shapingMachine.ts";
import type { ObjectModel, Shaping } from "../src/om/types.ts";

/** The tool the fixture measures, and the one the carriage starts holding. */
const MEASURED = 2;
const MOUNTED = 0;

/** A machine with four heads. */
const FOUR = { tools: 4 } as const;

/** Is this code one of the lines of this request? A request may carry several,
 *  newline separated, and the assertions here are about codes not requests. */
const carries = (request: string, code: string): boolean =>
	request.split("\n").some(line => line.trim() === code);

const firstIndex = (wire: readonly string[], code: string): number => wire.findIndex(r => carries(r, code));

const lastIndex = (wire: readonly string[], code: string): number => {
	for (let i = wire.length - 1; i >= 0; i--) if (carries(wire[i]!, code)) return i;
	return -1;
};

type Overrides = {
	readonly plan?: Partial<RingPlan>;
	readonly fake?: FakeOptions;
	readonly shaping?: Shaping;
};

function planned(tool: number, mounted: number, over: Overrides = {}) {
	const machine = { ...FOUR, currentTool: mounted, ...(over.shaping === undefined ? {} : { shaping: over.shaping }) };
	const model = modelWith(machine);
	const pre = freshPre(machine);
	const prior: RunPrior = runPriorOf(pre, tool);
	const result = planProcedure(ringPlan({ repeats: 1, ...over.plan }), pre, config(), NOW, RATE, prior);
	if (!result.ok) throw new Error(`fixture refused: ${JSON.stringify(result.refusal)}`);
	return { proc: result.proc, model, pre };
}

type Ran = {
	readonly wire: readonly string[];
	readonly deadlines: ReadonlyArray<number | undefined>;
	readonly currentTool: () => number;
	readonly events: readonly ProcEvent[];
	readonly model: ObjectModel;
};

/** Plan a one-repeat ring for `tool` on a machine holding `mounted`, run it
 *  against the fake board, and report what the board heard. */
async function runFor(tool: number, mounted: number, over: Overrides = {}): Promise<Ran> {
	const { proc, model } = planned(tool, mounted, over);
	const fake = fakeBoard(model, over.fake);
	const events = await drain(proc.run(fake.conn, () => model, testClock()));
	return { wire: fake.sent, deadlines: fake.deadlines, currentTool: fake.currentTool, events, model };
}

test("a run for a tool that is not mounted selects it before it records anything", async () => {
	const { wire } = await runFor(MEASURED, MOUNTED);
	const select = firstIndex(wire, `T${MEASURED}`);
	const firstArm = wire.findIndex(r => r.includes("M956"));
	assert.ok(select >= 0, `no T${MEASURED} reached the board: ${JSON.stringify(wire)}`);
	assert.ok(firstArm >= 0, "the run recorded nothing");
	assert.ok(select < firstArm, `T${MEASURED} was sent after the first capture was armed`);
});

test("the tool change is followed by a move to the plan's own start, and the run then runs", async () => {
	// The fake parks at its dock on a change, so this is the whole proof that
	// the approach leg exists: without it every later position check fails.
	const { wire, events } = await runFor(MEASURED, MOUNTED);
	const select = firstIndex(wire, `T${MEASURED}`);
	const approach = wire.findIndex((r, i) => i >= select && /^G1 X100 Y100 F/m.test(r));
	assert.ok(approach >= select, `no approach to the plan start after the tool change: ${JSON.stringify(wire)}`);
	assert.ok(kinds(events).includes("done"), `the run did not finish: ${errorOf(events)}`);
});

test("the run gives back the tool that was mounted when it opened", async () => {
	const { wire, currentTool } = await runFor(MEASURED, MOUNTED);
	assert.equal(currentTool(), MOUNTED, "the board was left holding the wrong tool");
	assert.ok(lastIndex(wire, `T${MOUNTED}`) > lastIndex(wire, `T${MEASURED}`), "the restore did not put the tool back last");
});

test("nothing mounted at the start is restored with T-1, not left holding the measured tool", async () => {
	const { wire, currentTool } = await runFor(MEASURED, -1);
	assert.ok(firstIndex(wire, `T${MEASURED}`) >= 0, "the run did not select the tool it was measuring");
	assert.equal(currentTool(), -1, "a machine that started with no tool was left holding one");
	assert.ok(lastIndex(wire, "T-1") >= 0, "T-1 never went out");
});

test("a run for the tool already mounted sends no T at all", async () => {
	const { wire } = await runFor(MOUNTED, MOUNTED);
	const tools = wire.filter(r => r.split("\n").some(line => /^T-?\d+$/.test(line.trim())));
	assert.deepEqual(tools, [], "a tool change was sent for a tool that was already on the carriage");
});

test("the tool goes back BEFORE the shaper, because tpost<N>.g may set M593", async () => {
	const { wire } = await runFor(MEASURED, MOUNTED, { shaping: EI2_PRIOR });
	const back = lastIndex(wire, `T${MOUNTED}`);
	const shaper = lastIndex(wire, 'M593 P"ei2" F52 S0.075');
	assert.ok(back >= 0 && shaper >= 0, `restore incomplete: ${JSON.stringify(wire)}`);
	assert.ok(back < shaper, "the shaper was restored before the tool change that would overwrite it");
});

test("the tool restore goes out when a step fails mid-run", async () => {
	const { wire, currentTool } = await runFor(MEASURED, MOUNTED, {
		fake: { onSend: (code) => { if (code.includes("M956")) throw new Error("rejected"); } },
	});
	assert.equal(currentTool(), MOUNTED, "a failed run left the wrong tool on the carriage");
	assert.ok(lastIndex(wire, `T${MOUNTED}`) > firstIndex(wire, `T${MEASURED}`), "the tool was never put back");
});

test("the tool restore goes out when the consumer abandons the run", async () => {
	const { proc, model } = planned(MEASURED, MOUNTED);
	const fake = fakeBoard(model);
	// One event, then walk away — the `finally` still has to put the tool back.
	for await (const _ of proc.run(fake.conn, () => model, testClock())) break;
	assert.equal(fake.currentTool(), MOUNTED, "an abandoned run left the wrong tool on the carriage");
});

test("a run refuses a tool the machine does not have", () => {
	const pre = freshPre({ ...FOUR, currentTool: MOUNTED });
	const r = planProcedure(ringPlan(), pre, config(), NOW, RATE, runPriorOf(pre, 9));
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "no-such-tool", tool: 9 });
});

test("a reading refuses a machine that will not say which tool is mounted", () => {
	const om = modelWith(FOUR);
	(om.state as unknown as Record<string, unknown>).currentTool = "T0";
	const r = Preconditions.read(om, config(), freshPre(FOUR).accel, NOW);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.deepEqual(r.refusal, { kind: "tool-unknown" });
});

test("the tool step is sent with a deadline far beyond the flat per-request floor", async () => {
	const { wire, deadlines } = await runFor(MEASURED, MOUNTED);
	const at = wire.findIndex(r => carries(r, `T${MEASURED}`));
	assert.ok(at >= 0, "no tool change on the wire");
	assert.ok((deadlines[at] ?? 0) > 60_000, `the tool change carried a ${String(deadlines[at])} ms deadline`);
});
