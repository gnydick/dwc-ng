import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock } from "./helpers.ts";
import { crc32 } from "../src/crc32.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

test("rr_filelist lists seeded gcodes with RRF-style dates", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const res = await mock.getJson("rr_filelist?dir=0:/gcodes&first=0", key);
	assert.equal(res.err, 0);
	const benchy = res.files.find((f: any) => f.name === "benchy.gcode");
	assert.ok(benchy);
	assert.equal(benchy.type, "f");
	assert.ok(benchy.size > 0);
	assert.match(benchy.date, DATE_RE);
});

test("rr_filelist paginates via first/next", async t => {
	const mock = await startMock({ chunkSize: 4 });
	t.after(() => mock.close());
	const key = await mock.connect();

	const all: any[] = [];
	let next = 0;
	do {
		const page = await mock.getJson(`rr_filelist?dir=0:/sys&first=${next}`, key);
		assert.equal(page.err, 0);
		assert.ok(page.files.length <= 4);
		all.push(...page.files);
		next = page.next;
	} while (next !== 0);
	assert.equal(all.length, 10, "0:/sys is seeded with 10 files (incl. dwc-ng-config.json)");
});

test("mock SD seeds dwc-ng-config.json at the current version, stamped and mapped", async t => {
	// The UI's dock indicator and axis-role labels are opt-in: they only
	// render when the machine's SD carries a mapping. Seeding it here keeps
	// those working out of the box (and across mock restarts, since the SD is
	// rebuilt from this seed every start — an in-memory VirtualSD).
	//
	// GIT_90 round 5: the default moved 1 -> 3 (current) and gained a
	// machineId stamp and an accelByTool mapping — the gate that kept every
	// Shaping step disabled ("no accelerometer chosen for this tool") on a
	// fresh mock, per Gabe's live UAT.
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const down = await mock.getRaw("rr_download?name=0:/sys/dwc-ng-config.json", key);
	assert.equal(down.status, 200);
	const parsed = JSON.parse(await down.text());
	assert.equal(parsed.version, 3);
	// Stamped for the mainboard uniqueId this same snapshot reports
	// (om-snapshot-2026-07-12.json boards[0]), machineKeySegment's "b." form
	// (packages/ui/src/config/machineId.ts) — a bare uniqueId here would fail
	// every claimed-not-adopted check against a live connection to this mock.
	assert.equal(parsed.machineId, "b.0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1");

	// Dock sensors: tools 0..3 map to gpIn 10..13 (real machine wiring).
	for (let tool = 0; tool <= 3; tool++) {
		assert.equal(parsed.overlay.dockSensors[String(tool)].gpIn, 10 + tool);
	}
	// Axis roles: U/V/W are the individual Z-leadscrew motors, C is the coupler.
	assert.equal(parsed.overlay.axisRoles.C, "Coupler");
	assert.match(parsed.overlay.axisRoles.U, /Z motor/);

	// The accelerometer mapping: tools 0..3 on the four TOOL1LC boards this
	// snapshot's toolchanger carries, CAN 20..23, device 0 each.
	for (let tool = 0; tool <= 3; tool++) {
		assert.equal(parsed.overlay.shaping.accelByTool[String(tool)], `${20 + tool}.0`);
	}
});

test("--config-version 1 seeds the byte-identical pre-v3 shape (no stamp, no accelByTool)", async t => {
	// GIT_92 requirement 3: the pre-v3 migration path a real board's SD can
	// still carry must stay reachable on a live mock, not only in the UI's
	// own synthetic parser fixtures (config-parse.test.ts). This is that
	// path, on purpose, not an accident of a version bump.
	const mock = await startMock({ configVersion: 1 });
	t.after(() => mock.close());
	const key = await mock.connect();

	const down = await mock.getRaw("rr_download?name=0:/sys/dwc-ng-config.json", key);
	const parsed = JSON.parse(await down.text());
	assert.equal(parsed.version, 1);
	assert.equal(parsed.machineId, undefined, "v1 predates the machineId stamp");
	assert.equal(parsed.overlay.shaping, undefined, "v1 never carried a shaping section");
	assert.equal(parsed.overlay.axisRoles.C, "Coupler");
	assert.equal(parsed.overlay.dockSensors["0"].gpIn, 10);
});

test("--config-version 2 carries the current overlay shape under the pre-split version number", async t => {
	// v2 and v3 read identically in config/parse.ts's parseOverlayPayload —
	// the v2 -> v3 change was to STORAGE LAYOUT (machine/person split), not
	// the overlay shape — so this is legitimately the same overlay as the
	// default, just unstamped and under version 2. See files.ts
	// buildConfigSeed's own doc comment for why this does not need (and
	// should not invent) a distinct shape.
	const mock = await startMock({ configVersion: 2 });
	t.after(() => mock.close());
	const key = await mock.connect();

	const down = await mock.getRaw("rr_download?name=0:/sys/dwc-ng-config.json", key);
	const parsed = JSON.parse(await down.text());
	assert.equal(parsed.version, 2);
	assert.equal(parsed.machineId, undefined, "only a v3 payload is stamped");
	assert.equal(parsed.overlay.shaping.accelByTool["0"], "20.0");
});

test("--frozen-screen seeds a pre-#86 screen override, and the default seeds none", async t => {
	// #86: a built-in screen's saved layout used to REPLACE its coded
	// composition, so an operator who ever pressed Save never saw a card
	// shipped to that screen again. The state only exists for a machine whose
	// SD carries an override, so a fresh mock cannot show the fix at all —
	// this flag is how the degraded machine is presented ON PURPOSE (GIT_92's
	// own rule about reachable states).
	const mock = await startMock({ frozenScreen: true });
	t.after(() => mock.close());
	const key = await mock.connect();

	const down = await mock.getRaw("rr_download?name=0:/sys/dwc-ng-config.json", key);
	const parsed = JSON.parse(await down.text());
	const machine = parsed.overlay.screens.layouts.machine;
	assert.deepEqual(Object.keys(machine).sort(), ["position", "tools-heaters"]);
	// The whole point of the pre-#86 shape: no tombstone anywhere. An override
	// written before they existed cannot carry one, and seeding one would be
	// testing the NEW path while claiming to be the old state.
	for (const value of Object.values(machine)) {
		assert.notEqual(value, null, "a pre-tombstone override holds rects only");
	}
});

test("the default mock seeds NO screen override, so nothing is frozen out of the box", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const down = await mock.getRaw("rr_download?name=0:/sys/dwc-ng-config.json", key);
	const parsed = JSON.parse(await down.text());
	assert.equal(parsed.overlay.screens, undefined, "the ordinary machine is not degraded");
});

test("rr_filelist reports err 1 (unmounted) and err 2 (missing)", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	assert.equal((await mock.getJson("rr_filelist?dir=1:/gcodes&first=0", key)).err, 1);
	assert.equal((await mock.getJson("rr_filelist?dir=0:/nope&first=0", key)).err, 2);
});

test("rr_files returns names only and flags directories", async t => {
	const mock = await startMock({ chunkSize: 32 });
	t.after(() => mock.close());
	const key = await mock.connect();

	const res = await mock.getJson("rr_files?dir=0:/&first=0&flagDirs=1", key);
	assert.ok(res.files.includes("*gcodes"));
	assert.ok(res.files.includes("*sys"));
});

test("rr_upload verifies CRC32 and stores the file; rr_download round-trips", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const body = new TextEncoder().encode("G28\nG1 X10 Y10 F3000\n");
	const checksum = crc32(body).toString(16);
	const volBefore = mock.machine.volSeqs[0];

	const up = await fetch(`${mock.base}/rr_upload?name=0:/gcodes/test.g&time=2026-07-12T13:00:00&crc32=${checksum}`, {
		method: "POST",
		headers: { "X-Session-Key": String(key), "Content-Type": "application/octet-stream" },
		body,
	});
	assert.equal(((await up.json()) as any).err, 0);
	assert.equal(mock.machine.volSeqs[0], volBefore! + 1, "upload bumps volChanges");

	const down = await mock.getRaw("rr_download?name=0:/gcodes/test.g", key);
	assert.equal(down.status, 200);
	assert.deepEqual(new Uint8Array(await down.arrayBuffer()), body);
});

test("rr_upload rejects a bad CRC32 with err 1 and stores nothing", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const up = await fetch(`${mock.base}/rr_upload?name=0:/gcodes/corrupt.g&crc32=deadbeef`, {
		method: "POST",
		headers: { "X-Session-Key": String(key) },
		body: "not the right bytes",
	});
	assert.equal(((await up.json()) as any).err, 1);
	assert.equal((await mock.getRaw("rr_download?name=0:/gcodes/corrupt.g", key)).status, 404);
});

test("rr_mkdir, rr_move and rr_delete manage the virtual SD", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	assert.equal((await mock.getJson("rr_mkdir?dir=0:/gcodes/subdir", key)).err, 0);
	assert.equal((await mock.getJson("rr_mkdir?dir=0:/gcodes/subdir", key)).err, 1, "mkdir on existing dir fails");

	assert.equal(
		(await mock.getJson("rr_move?old=0:/gcodes/calibration-cube.gcode&new=0:/gcodes/subdir/cube.gcode&deleteexisting=no", key)).err,
		0,
	);
	assert.equal((await mock.getRaw("rr_download?name=0:/gcodes/subdir/cube.gcode", key)).status, 200);

	assert.equal((await mock.getJson("rr_delete?name=0:/gcodes/subdir", key)).err, 1, "non-empty dir needs recursive=yes");
	assert.equal((await mock.getJson("rr_delete?name=0:/gcodes/subdir&recursive=yes", key)).err, 0);
	assert.equal((await mock.getRaw("rr_download?name=0:/gcodes/subdir/cube.gcode", key)).status, 404);
});

test("rr_fileinfo returns job metadata; rr_thumbnail pages base64 chunks", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const info = await mock.getJson("rr_fileinfo?name=0:/gcodes/benchy.gcode", key);
	assert.equal(info.err, 0);
	assert.equal(info.numLayers, 240);
	assert.ok(info.thumbnails.length > 0);

	const thumb = info.thumbnails[0];
	let data = "";
	let offset = thumb.offset;
	do {
		const chunk = await mock.getJson(`rr_thumbnail?name=0:/gcodes/benchy.gcode&offset=${offset}`, key);
		assert.equal(chunk.err, 0);
		assert.match(chunk.data, /^[A-Za-z0-9+/=]+$/, "DWC validates base64 strictly");
		data += chunk.data;
		offset = chunk.next;
	} while (offset !== 0);
	assert.ok(data.length >= thumb.size);
});

test("rr_thumbnail serves the real seat-support QOI across multiple chunks", async t => {
	const mock = await startMock();
	t.after(() => mock.close());
	const key = await mock.connect();

	const name = "0:/gcodes/seat support - PLA.gcode";
	const info = await mock.getJson(`rr_fileinfo?name=${encodeURIComponent(name)}`, key);
	assert.equal(info.err, 0);
	assert.equal(info.thumbnails[0].format, "qoi");
	assert.deepEqual([info.thumbnails[0].width, info.thumbnails[0].height], [160, 160]);

	let data = "";
	let offset = info.thumbnails[0].offset;
	let chunks = 0;
	do {
		const chunk = await mock.getJson(`rr_thumbnail?name=${encodeURIComponent(name)}&offset=${offset}`, key);
		assert.equal(chunk.err, 0);
		assert.match(chunk.data, /^[A-Za-z0-9+/=]+$/, "DWC validates base64 strictly");
		data += chunk.data;
		offset = chunk.next;
		chunks++;
	} while (offset !== 0);

	assert.ok(chunks > 1, `real QOI should span multiple chunks (got ${chunks})`);
	const raw = Buffer.from(data, "base64");
	assert.equal(raw.subarray(0, 4).toString("latin1"), "qoif", "decodes to a QOI stream");
	assert.equal(raw.readUInt32BE(4), 160);
	assert.equal(raw.readUInt32BE(8), 160);
});

test("rr_fileinfo without a name describes the file being printed", async t => {
	const mock = await startMock({ scenario: "mid-print" });
	t.after(() => mock.close());
	const key = await mock.connect();

	const info = await mock.getJson("rr_fileinfo", key);
	assert.equal(info.err, 0);
	assert.equal(info.fileName, "0:/gcodes/benchy.gcode");
});
