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
	assert.equal(all.length, 9, "0:/sys is seeded with 9 files");
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

test("rr_fileinfo without a name describes the file being printed", async t => {
	const mock = await startMock({ scenario: "mid-print" });
	t.after(() => mock.close());
	const key = await mock.connect();

	const info = await mock.getJson("rr_fileinfo", key);
	assert.equal(info.err, 0);
	assert.equal(info.fileName, "0:/gcodes/benchy.gcode");
});
