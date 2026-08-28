import { test } from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../src/machine.ts";
import { scenarios } from "../src/scenarios/index.ts";
import { loadCaptureFile } from "../src/capture.ts";
import { startMock } from "./helpers.ts";

// The real capture from Gabe's toolchanger (SBC mode, GET /machine/model):
// 7 axes (X Y Z U V W C), none of which are X/Y/Z-only — the machine G28
// must be able to home UVW/C on, and must error rather than guess when a
// letter names an axis this machine doesn't have.
const TOOLCHANGER = new URL("../captures/om-snapshot-2026-07-12.json", import.meta.url);

test("idle machine: clock advances, temperatures stay near ambient", () => {
	const machine = new Machine(scenarios["idle"]);
	machine.advance(5_000);
	assert.equal(machine.om.state.upTime, 5);
	assert.ok(Math.abs(machine.om.heat.heaters[1].current - 22.5) < 2);
	assert.equal(machine.om.state.status, "idle");
});

test("heater approaches its target after M104 without bumping seqs.heat", () => {
	const machine = new Machine(scenarios["idle"]);
	// The idle scenario deliberately mistunes the hotend so the UI's
	// running-hot states are reachable on the bench. This test measures the
	// approach law itself, so it takes the quirk back out.
	machine.om.heat.heaters[1].overshoot = 0;
	const heatSeq = machine.seqs.heat;

	machine.execute("M104 S210");
	assert.equal(machine.om.heat.heaters[1].active, 210);
	assert.equal(machine.om.heat.heaters[1].state, "active");

	for (let i = 0; i < 120; i++) machine.advance(1_000);
	assert.ok(Math.abs(machine.om.heat.heaters[1].current - 210) < 5, `got ${machine.om.heat.heaters[1].current}`);
	// Analog sensor mirrors the heater
	assert.ok(Math.abs(machine.om.sensors.analog[1].lastReading - 210) < 5);
	// Temperature changes are live values: no seq bump
	assert.equal(machine.seqs.heat, heatSeq);
});

/**
 * The two halves of M568 are independent, and the UI relies on that: its mode
 * buttons send the setpoint on one click and the mode on the next. A mock that
 * only reads S/R swallows the second click, and the heater sits at ambient
 * forever while the UI shows a target — which is exactly what happened.
 */
test("M568 S sets the setpoint WITHOUT switching the heater on", () => {
	const machine = new Machine(scenarios["idle"]);
	const heater = machine.om.heat.heaters[1];
	const before = heater.state;

	machine.execute("M568 P0 S210");
	assert.equal(heater.active, 210, "the setpoint is stored");
	assert.equal(heater.state, before, "…but the mode is untouched — that is A's job");

	for (let i = 0; i < 120; i++) machine.advance(1_000);
	assert.ok(heater.current < 40, `an off heater must not heat; got ${heater.current}`);
});

test("M568 A2 then heats to the setpoint already stored", () => {
	const machine = new Machine(scenarios["idle"]);
	// The idle scenario deliberately mistunes the hotend so the UI's
	// running-hot states are reachable on the bench. This test measures the
	// approach law itself, so it takes the quirk back out.
	machine.om.heat.heaters[1].overshoot = 0;
	const heater = machine.om.heat.heaters[1];

	machine.execute("M568 P0 S210");
	machine.execute("M568 P0 A2");
	assert.equal(heater.state, "active");

	for (let i = 0; i < 120; i++) machine.advance(1_000);
	assert.ok(Math.abs(heater.current - 210) < 5, `got ${heater.current}`);
});

test("M568 A1 tracks the standby setpoint, A0 lets it fall back to ambient", () => {
	const machine = new Machine(scenarios["idle"]);
	// The idle scenario deliberately mistunes the hotend so the UI's
	// running-hot states are reachable on the bench. This test measures the
	// approach law itself, so it takes the quirk back out.
	machine.om.heat.heaters[1].overshoot = 0;
	const heater = machine.om.heat.heaters[1];

	machine.execute("M568 P0 S210 R120");
	machine.execute("M568 P0 A1");
	assert.equal(heater.state, "standby");
	for (let i = 0; i < 200; i++) machine.advance(1_000);
	assert.ok(Math.abs(heater.current - 120) < 5, `standby target; got ${heater.current}`);

	machine.execute("M568 P0 A0");
	assert.equal(heater.state, "off");
	for (let i = 0; i < 600; i++) machine.advance(1_000);
	assert.ok(heater.current < 40, `off must cool; got ${heater.current}`);
});

/**
 * P is not decoration. The card sends M568 P<n> for the row you pressed, which
 * is usually NOT the current tool — routing every one of them to tool 0 made
 * the mock look like it worked while heating the wrong heater.
 */
test("M568 P addresses that tool, not the current one", () => {
	const machine = new Machine(scenarios["idle"]);
	const tools = machine.om.tools.filter((t: { heaters: number[] } | null) => t !== null);
	if (tools.length < 2) return; // single-tool scenario has nothing to mis-route

	const [first, second] = tools as { heaters: number[] }[];
	const other = machine.om.heat.heaters[second!.heaters[0]!];
	const mine = machine.om.heat.heaters[first!.heaters[0]!];
	const untouched = mine.active;

	machine.execute("M568 P1 S185 A2");
	assert.equal(other.active, 185);
	assert.equal(other.state, "active");
	assert.equal(mine.active, untouched, "tool 0 must not move when P1 was addressed");
});

/**
 * The Filament card reads move.extruders[].filament back to decide what is
 * loaded and whether Unload is live at all. A mock that accepted M701 silently
 * left every row reading "nothing loaded" and every Unload permanently dead.
 */
test("M701 loads onto the current tool's extruder, M702 clears it", () => {
	const machine = new Machine(scenarios["idle"]);
	const tool = machine.om.tools.find((t: { filamentExtruder: number } | null) => t !== null && t.filamentExtruder >= 0);
	if (!tool) return;
	const extruder = machine.om.move.extruders[tool.filamentExtruder];

	machine.execute(`T${tool.number}\nM701 S"PETG"\nM703`);
	assert.equal(extruder.filament, "PETG");

	machine.execute("M702");
	assert.equal(extruder.filament, "", "unload leaves the extruder empty, not holding the old name");
});

/**
 * filament rides the rarely-changing projection, so a client sees it ONLY by
 * refetching move — which it only does on a seqs.move bump. Loading without
 * the bump is invisible to the UI, which looks exactly like a failed load.
 */
test("loading filament bumps seqs.move so the change is fetchable", () => {
	const machine = new Machine(scenarios["idle"]);
	const tool = machine.om.tools.find((t: { filamentExtruder: number } | null) => t !== null && t.filamentExtruder >= 0);
	if (!tool) return;

	// seqs is a Record keyed by subtree name, so nothing in the type says
	// `move` is there. Assert it instead of defaulting: a missing counter would
	// make every comparison below trivially true against 0.
	const before = machine.seqs.move;
	assert.ok(typeof before === "number", "seqs.move must exist on a fresh machine");

	machine.execute('M701 S"PLA"');
	const afterLoad = machine.seqs.move;
	assert.ok(typeof afterLoad === "number", "seqs.move must exist after loading");
	assert.ok(afterLoad > before, `seqs.move must advance; stayed at ${before}`);

	machine.execute("M702");
	const afterUnload = machine.seqs.move;
	assert.ok(typeof afterUnload === "number", "seqs.move must exist after unloading");
	assert.ok(afterUnload > afterLoad, "unloading is just as invisible without a bump");
});

test("the T-code ahead of M701 decides which extruder gets it", () => {
	const machine = new Machine(scenarios["idle"]);
	const feeders = machine.om.tools.filter(
		(t: { filamentExtruder: number } | null) => t !== null && t.filamentExtruder >= 0,
	) as { number: number; filamentExtruder: number }[];
	if (feeders.length < 2) return; // one extruder in this scenario: nothing to mis-route

	const [a, b] = feeders;
	machine.execute(`T${b!.number}\nM701 S"ABS"\nM703`);
	assert.equal(machine.om.move.extruders[b!.filamentExtruder].filament, "ABS");
	assert.equal(machine.om.move.extruders[a!.filamentExtruder].filament, "", "the other extruder is untouched");
});

test("mid-print scenario: processing status and advancing progress", () => {
	const machine = new Machine(scenarios["mid-print"]);
	assert.equal(machine.om.state.status, "processing");
	assert.ok(machine.om.job.file !== null);

	const pos = machine.om.job.filePosition;
	const duration = machine.om.job.duration;
	machine.advance(10_000);
	assert.ok(machine.om.job.filePosition > pos);
	assert.ok(machine.om.job.duration >= duration + 10);
	assert.ok(machine.om.job.layer >= 1);
	assert.ok(machine.om.job.timesLeft.file > 0);
});

test("mid-print: currentMove reports a requested speed the achieved speed falls short of", () => {
	const machine = new Machine(scenarios["mid-print"]);
	const seen: Array<{ requested: number; top: number }> = [];
	// Sample the way the UI does — repeatedly, across the simulated toolpath.
	for (let i = 0; i < 40; i++) {
		machine.advance(500);
		const cm = machine.om.move.currentMove;
		seen.push({ requested: cm.requestedSpeed, top: cm.topSpeed });
	}

	assert.ok(seen.every(s => s.requested > 0), "a running job always has a requested speed");
	assert.ok(seen.every(s => s.top <= s.requested), "the planner never exceeds what was asked for");
	// The point of the pair: they must not be the same number every sample, or
	// a UI showing them stacked would look correct while reading nothing live.
	assert.ok(seen.some(s => s.top < s.requested), "achieved falls below requested where the path turns");
	assert.ok(new Set(seen.map(s => s.top)).size > 1, "the achieved speed varies across the path");
});

test("M220 moves the requested speed, and a finished job zeroes the pair", () => {
	const machine = new Machine(scenarios["mid-print"]);
	machine.advance(500);
	const before = machine.om.move.currentMove.requestedSpeed;

	machine.execute("M220 S50");
	machine.advance(500);
	assert.ok(
		machine.om.move.currentMove.requestedSpeed < before,
		`halving the speed factor must lower requested (${before} -> ${machine.om.move.currentMove.requestedSpeed})`,
	);

	machine.finishJob(true);
	assert.equal(machine.om.move.currentMove.requestedSpeed, 0);
	assert.equal(machine.om.move.currentMove.topSpeed, 0);
	assert.equal(machine.om.move.currentMove.extrusionRate, 0);
});

test("a print runs to completion and returns to idle", () => {
	const machine = new Machine(scenarios["mid-print"]);
	const jobSeq = machine.seqs.job!;
	machine.om.job.filePosition = machine.om.job.file.size - 1;
	machine.advance(2_000);

	assert.equal(machine.om.state.status, "idle");
	assert.equal(machine.om.job.file, null);
	assert.equal(machine.om.job.lastFileName, "0:/gcodes/benchy.gcode");
	assert.equal(machine.om.job.lastFileCancelled, false);
	assert.ok(machine.seqs.job! > jobSeq, "job completion bumps seqs.job");
});

test("pause and cancel via M25/M0", () => {
	const machine = new Machine(scenarios["mid-print"]);
	machine.execute("M25");
	assert.equal(machine.om.state.status, "paused");
	machine.execute("M24");
	assert.equal(machine.om.state.status, "processing");
	machine.execute("M25");
	machine.execute("M0");
	assert.equal(machine.om.state.status, "idle");
	assert.equal(machine.om.job.lastFileCancelled, true);
});

test("heater-fault scenario: fault fires at 15 s, bumps heat seq, emits error", () => {
	const machine = new Machine(scenarios["heater-fault"]);
	const heatSeq = machine.seqs.heat!;
	const replySeq = machine.replySeq;
	const replies: string[] = [];
	machine.onReply = text => replies.push(text);

	machine.advance(14_000);
	assert.equal(machine.om.heat.heaters[1].state, "active");

	machine.advance(2_000);
	assert.equal(machine.om.heat.heaters[1].state, "fault");
	assert.ok(machine.seqs.heat! > heatSeq, "fault must bump seqs.heat");
	assert.ok(machine.replySeq > replySeq);
	assert.ok(replies.some(r => r.startsWith("Error: Heater 1 fault")));

	// A faulted heater cools even though active is still set
	const temp = machine.om.heat.heaters[1].current;
	machine.advance(60_000);
	assert.ok(machine.om.heat.heaters[1].current < temp);
});

test("disconnect scenario: outage window opens and closes", () => {
	const machine = new Machine(scenarios["disconnect"]);
	machine.advance(19_000);
	assert.equal(machine.outageActive, false);
	machine.advance(2_000);
	assert.equal(machine.outageActive, true);
	machine.advance(8_000);
	assert.equal(machine.outageActive, false);
});

test("disconnect scenario over HTTP: requests fail during the outage, recover after", async t => {
	const mock = await startMock({ scenario: "disconnect" });
	t.after(() => mock.close());
	const key = await mock.connect();

	mock.machine.advance(21_000); // into the outage
	await assert.rejects(mock.getRaw("rr_model?key=seqs", key), "connections drop during an outage");

	mock.machine.advance(10_000); // outage over; sessions were cleared
	assert.equal((await mock.getRaw("rr_model?key=seqs", key)).status, 401, "old session died with the outage");
	const fresh = await mock.connect();
	assert.equal((await mock.getRaw("rr_model?key=seqs", fresh)).status, 200);
});

test("G28 homes axes; T0/T-1 selects and deselects the tool", () => {
	const machine = new Machine(scenarios["idle"]);
	assert.equal(machine.om.move.axes[0].homed, false);
	machine.execute("G28");
	assert.ok(machine.om.move.axes.every((a: any) => a.homed));

	machine.execute("T0");
	assert.equal(machine.om.state.currentTool, 0);
	assert.equal(machine.om.tools[0].state, "active");
	machine.execute("T-1");
	assert.equal(machine.om.state.currentTool, -1);
	assert.equal(machine.om.tools[0].state, "off");
});

test("a tool change parks the carriage, and re-selecting the same tool does nothing", () => {
	// The one consequence of a tool change anything driving this machine has to
	// plan around: `tfree`/`tpre`/`tpost` take the head to the dock, so after a
	// change it is NOT where it was. A mock that left the carriage put could not
	// tell a caller that plans its own approach from one that assumes a tool
	// change is free.
	const machine = new Machine(scenarios["idle"]);
	machine.execute("G28");
	machine.execute("T0");
	machine.execute("G90");
	machine.execute("G1 X100 Y100");
	const at = () => machine.om.move.axes
		.filter((a: any) => a.letter === "X" || a.letter === "Y")
		.map((a: any) => a.userPosition);
	assert.deepEqual(at(), [100, 100]);

	// Already active: RRF documents `T0` here as doing nothing at all.
	machine.execute("T0");
	assert.deepEqual(at(), [100, 100], "re-selecting the mounted tool moved the carriage");

	// T-1 is a change like any other — RRF saves the coordinates and runs
	// `tfree` for the outgoing tool — and this scenario has only one head.
	machine.execute("T-1");
	const max = machine.om.move.axes
		.filter((a: any) => a.letter === "X" || a.letter === "Y")
		.map((a: any) => a.max);
	assert.deepEqual(at(), max, "a real tool change left the carriage where it was");
});

test("G28 bare homes every axis the object model declares, not a fixed three", () => {
	const machine = new Machine(undefined, loadCaptureFile(TOOLCHANGER));
	const axes = () => machine.om.move.axes as Array<{ letter: string; homed: boolean; userPosition: number; machinePosition: number; min: number }>;
	assert.deepEqual(axes().map(a => a.letter), ["X", "Y", "Z", "U", "V", "W", "C"]);
	assert.ok(axes().every(a => !a.homed), "starts unhomed");

	machine.execute("G28");

	assert.ok(axes().every(a => a.homed), "bare G28 homes all seven axes, including U/V/W/C");
	for (const axis of axes()) {
		assert.equal(axis.userPosition, axis.min, `${axis.letter}.userPosition lands on min`);
		assert.equal(axis.machinePosition, axis.min, `${axis.letter}.machinePosition lands on min`);
	}
});

test("G28 U homes U only and leaves X/Y/Z untouched (regression: used to home X/Y/Z instead)", () => {
	const machine = new Machine(undefined, loadCaptureFile(TOOLCHANGER));
	const byLetter = (letter: string) => machine.om.move.axes.find((a: any) => a.letter === letter);

	machine.execute("G28 U");

	assert.equal(byLetter("U").homed, true, "U was homed");
	for (const letter of ["X", "Y", "Z", "V", "W", "C"]) {
		assert.equal(byLetter(letter).homed, false, `${letter} must stay unhomed`);
	}
});

test("G28 X Y homes exactly those two axes, not the home-everything fallback", () => {
	const machine = new Machine(undefined, loadCaptureFile(TOOLCHANGER));
	const byLetter = (letter: string) => machine.om.move.axes.find((a: any) => a.letter === letter);

	machine.execute("G28 X Y");

	assert.equal(byLetter("X").homed, true);
	assert.equal(byLetter("Y").homed, true);
	for (const letter of ["Z", "U", "V", "W", "C"]) {
		assert.equal(byLetter(letter).homed, false, `${letter} must stay unhomed`);
	}
});

test("G28 Q errors on a machine with no Q axis and homes nothing", () => {
	const machine = new Machine(undefined, loadCaptureFile(TOOLCHANGER));

	const reply = machine.execute("G28 Q");

	assert.match(reply, /Error/, "an unknown axis letter must be reported, not silently redirected");
	assert.ok(machine.om.move.axes.every((a: any) => !a.homed), "no axis was homed on error");
});

test("multi-line gcode runs every line; G91 jogs relative without moving other axes", () => {
	const machine = new Machine(scenarios["idle"]);
	const x = () => machine.om.move.axes[0].userPosition;
	const y = () => machine.om.move.axes[1].userPosition;

	// Absolute positioning: a bare axis word is an absolute target.
	machine.execute("G90\nG1 X100 Y50");
	assert.equal(x(), 100, "second line of a multi-line command must execute");
	assert.equal(y(), 50);

	// The jog the Control view emits: M120 push, G91 relative +10 on X, M121 pop.
	const y0 = y();
	machine.execute("M120\nG91\nG1 X10 F6000\nM121");
	assert.equal(x(), 110, "relative jog accumulates onto the current position");
	assert.equal(y(), y0, "a single-axis jog must not move other axes (no diagonal)");

	// M121 restored the pre-jog (absolute) mode for the next command.
	machine.execute("G1 X5");
	assert.equal(x(), 5, "mode is back to absolute after the jog");
});

test("unread replies expire (RRF drops them after ~1 s)", async t => {
	const mock = await startMock({ replyExpiryMs: 50 });
	t.after(() => mock.close());
	const key = await mock.connect();

	await mock.getJson("rr_gcode?gcode=M114", key);
	await new Promise(resolve => setTimeout(resolve, 120));
	const reply = await (await mock.getRaw("rr_reply", key)).text();
	assert.equal(reply, "", "stale replies must be gone");
});

test("M118 echoes its message — the mock must speak like Gabe's macros do", () => {
	const machine = new Machine(scenarios["idle"]);
	const seen: string[] = [];
	machine.onReply = text => seen.push(text);

	machine.execute('M118 S"tool detection start"');
	machine.execute('M118 S"T1 docked" P0 L3');
	// no message → nothing useful to say
	machine.execute("M118");

	assert.deepEqual(seen, ["tool detection start", "T1 docked", ""]);
});
