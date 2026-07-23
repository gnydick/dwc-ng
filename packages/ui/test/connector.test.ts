import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockServer, type MockServer, type MockServerOptions } from "../../mock-duet/src/server.ts";
import { loadCaptureFile } from "../../mock-duet/src/capture.ts";
import { PollConnector } from "../src/connector/PollConnector.ts";
import type { ConnectionStatus } from "../src/connector/types.ts";

const CAPTURE = new URL("../../mock-duet/captures/om-snapshot-2026-07-12.json", import.meta.url);

/**
 * End-to-end connector tests: a real PollConnector talking HTTP to an
 * in-process mock-duet with the simulation timer disabled — tests drive
 * the machine clock and the poll loop deterministically.
 */

interface Harness {
	mock: MockServer;
	connector: PollConnector;
	keys: Map<string, unknown>;
	patches: Array<Record<string, unknown>>;
	replies: string[];
	statuses: ConnectionStatus[];
	filesChanged: number[];
	layerEvents: unknown[][];
	close(): Promise<void>;
}

async function startHarness(mockOptions: MockServerOptions = {}): Promise<Harness> {
	const mock = createMockServer({ tickMs: 0, ...mockOptions });
	const port = await mock.listen(0);

	const keys = new Map<string, unknown>();
	const patches: Array<Record<string, unknown>> = [];
	const replies: string[] = [];
	const statuses: ConnectionStatus[] = [];
	const filesChanged: number[] = [];
	const layerEvents: unknown[][] = [];

	const connector = new PollConnector({
		baseUrl: `http://127.0.0.1:${port}`,
		autoPoll: false,
		retryDelayMs: 10,
		maxRetries: 3,
		requestTimeoutMs: 2000,
		events: {
			onModelKey: (key, value) => keys.set(key, value),
			onModelPatch: patch => patches.push(patch),
			onReply: text => replies.push(text),
			onStatusChange: status => statuses.push(status),
			onFilesChanged: volume => filesChanged.push(volume),
			onJobLayers: layers => layerEvents.push(layers),
		},
	});

	return {
		mock, connector, keys, patches, replies, statuses, filesChanged, layerEvents,
		async close() {
			await connector.disconnect().catch(() => undefined);
			await mock.close();
		},
	};
}

test("connect performs a full sync: every polled key arrives wholesale", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		assert.deepEqual(h.statuses, ["connecting", "connected"]);
		for (const key of ["boards", "heat", "move", "state", "tools", "volumes"]) {
			assert.ok(h.keys.has(key), `full sync delivered ${key}`);
		}
		const move = h.keys.get("move") as any;
		assert.equal(move.axes.length, 3, "synthetic base machine has XYZ");
		assert.ok(!h.keys.has("sbc") && !h.keys.has("plugins"), "skipped keys never fetched");
	} finally {
		await h.close();
	}
});

test("live poll emits sparse patches without touching full subtrees", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.keys.clear();

		h.mock.machine.advance(3000);
		await h.connector.pollOnce();

		assert.equal(h.patches.length, 1);
		const patch = h.patches[0] as any;
		assert.equal(patch.state.upTime, 3, "live values travel in the patch");
		assert.ok(!("seqs" in patch), "seqs is stripped before the patch is emitted");
		assert.equal(h.keys.size, 0, "no seqs changed → no subtree re-fetches");
	} finally {
		await h.close();
	}
});

test("a seqs bump triggers exactly the changed subtree to be re-fetched", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.keys.clear();

		h.mock.machine.faultHeater(1); // bumps seqs.heat, emits an error reply
		await h.connector.pollOnce();

		assert.deepEqual([...h.keys.keys()], ["heat"], "only heat was re-fetched");
		const heat = h.keys.get("heat") as any;
		assert.equal(heat.heaters[1].state, "fault");
		assert.equal(h.replies.length, 1);
		assert.match(h.replies[0]!, /Heater 1 fault/);
	} finally {
		await h.close();
	}
});

test("sendCode returns the G-code reply text", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const reply = await h.connector.sendCode("M115");
		assert.match(reply, /FIRMWARE/i);
		assert.deepEqual(h.replies, [reply], "reply also reached the event stream");
	} finally {
		await h.close();
	}
});

test("503 busy responses are retried transparently", async () => {
	// Every 2nd rr_model/rr_filelist request gets a 503 from the mock
	const h = await startHarness({ busyEvery: 2 });
	try {
		await h.connector.connect(); // full sync alone spans many rr_model calls
		for (let i = 0; i < 4; i++) {
			h.mock.machine.advance(1000);
			await h.connector.pollOnce();
		}
		assert.equal(h.connector.status, "connected");
		assert.ok(h.patches.length === 4, "every poll cycle completed despite 503s");
	} finally {
		await h.close();
	}
});

test("a culled session re-authenticates transparently (401 path)", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.mock.sessions.clear(); // firmware restarted / idle-culled our session

		h.mock.machine.advance(1000);
		await h.connector.pollOnce(); // must re-auth + replay, not throw

		assert.equal(h.connector.status, "connected");
		assert.equal((h.patches.at(-1) as any).state.upTime, 1);
	} finally {
		await h.close();
	}
});

test("upload → download round-trip with CRC32 verification", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const content = "; test macro\nM117 hello from dwc-ng\n";
		await h.connector.upload("0:/macros/dwc-ng-test.g", content);
		assert.equal(await h.connector.download("0:/macros/dwc-ng-test.g"), content);
	} finally {
		await h.close();
	}
});

test("list stitches rr_filelist pages", async () => {
	// chunkSize 2 forces pagination on any directory with >2 entries
	const h = await startHarness({ chunkSize: 2 });
	try {
		await h.connector.connect();
		for (const name of ["a.g", "b.g", "c.g"]) {
			await h.connector.upload(`0:/gcodes/${name}`, `; ${name}\n`);
		}
		const entries = await h.connector.list("0:/gcodes");
		assert.ok(entries.length >= 5, `directory spans 3 pages (${entries.length} entries)`);
		for (const name of ["a.g", "b.g", "c.g", "benchy.gcode"]) {
			assert.ok(entries.some(e => e.name === name), `${name} present after stitching`);
		}
	} finally {
		await h.close();
	}
});

test("an upload bumps volChanges and surfaces as onFilesChanged", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.upload("0:/gcodes/new-file.g", "G28\n");
		await h.connector.pollOnce();
		assert.deepEqual(h.filesChanged, [0]);
	} finally {
		await h.close();
	}
});

test("move fetch at the reportedAxes cap re-fetches move.axes (7-axis toolchanger)", async () => {
	// The real machine: 7 axes but limits.reportedAxes = 5, so a `move`
	// fetch inlines only 5 axes (RRF >= 3.5) — the connector must notice
	// and fetch move.axes separately (regression: W and C were missing)
	const h = await startHarness({ model: loadCaptureFile(CAPTURE) });
	try {
		await h.connector.connect();
		const move = h.keys.get("move") as any;
		assert.deepEqual(
			move.axes.map((a: any) => a.letter),
			["X", "Y", "Z", "U", "V", "W", "C"],
			"all axes present despite the reportedAxes cap",
		);

		// The same rule applies to seqs-driven re-fetches of `move`
		h.keys.clear();
		h.mock.machine.bump("move");
		await h.connector.pollOnce();
		assert.equal((h.keys.get("move") as any).axes.length, 7);
	} finally {
		await h.close();
	}
});

test("network outage: polling fails, then recovery re-auths and resyncs", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		h.keys.clear();

		h.mock.machine.requestOutage(5000); // drops connections + kills sessions
		await assert.rejects(h.connector.pollOnce(), "requests die during the outage");

		h.mock.machine.advance(6000); // outage window passes
		await h.connector.pollOnce(); // 401 (session gone) → re-auth → success
		assert.equal(h.connector.status, "connected");
	} finally {
		await h.close();
	}
});

const SEAT_SUPPORT = "0:/gcodes/seat support - PLA.gcode";

test("getFileInfo returns typed job metadata with thumbnail descriptors", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const info = await h.connector.getFileInfo(SEAT_SUPPORT);

		assert.equal(info.fileName, SEAT_SUPPORT);
		assert.equal(info.numLayers, 94);
		assert.equal(info.printTime, 2992);
		assert.deepEqual(info.filament, [15463.9]);
		assert.match(info.generatedBy, /PrusaSlicer 2\.9\.6/);
		assert.equal(info.thumbnails.length, 1);
		const thumb = info.thumbnails[0];
		assert.ok(thumb);
		assert.equal(thumb.format, "qoi");
		assert.deepEqual([thumb.width, thumb.height], [160, 160]);
	} finally {
		await h.close();
	}
});

test("getThumbnail stitches rr_thumbnail chunks and returns decoded image bytes", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const info = await h.connector.getFileInfo(SEAT_SUPPORT);
		const thumb = info.thumbnails[0];
		assert.ok(thumb);
		const bytes = await h.connector.getThumbnail(SEAT_SUPPORT, thumb.offset);

		// Raw QOI stream: 'qoif' magic, 160x160, 17079 bytes (not base64 text).
		assert.equal(bytes.length, 17079);
		assert.deepEqual([...bytes.slice(0, 4)], [0x71, 0x6f, 0x69, 0x66]);
	} finally {
		await h.close();
	}
});

test("getFileInfo surfaces a missing file as a rejection, not empty data", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await assert.rejects(h.connector.getFileInfo("0:/gcodes/does-not-exist.gcode"));
	} finally {
		await h.close();
	}
});

// --- file management: rr_mkdir / rr_move / rr_delete ---
// These are the only mutating file operations besides upload. Every one of
// them returns { err } in the body with HTTP 200, so a connector that only
// checks res.ok reports success for every failure. That is the bug these
// tests exist to prevent.

test("mkdir creates a directory that then lists", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.mkdir("0:/gcodes/parts");
		const entries = await h.connector.list("0:/gcodes");
		assert.ok(entries.some(e => e.name === "parts" && e.type === "d"), "new directory must appear");
	} finally {
		await h.close();
	}
});

test("mkdir surfaces a firmware error instead of resolving silently", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.mkdir("0:/gcodes/parts");
		// Creating the same directory twice fails on the board — err 1, HTTP 200.
		await assert.rejects(() => h.connector.mkdir("0:/gcodes/parts"));
	} finally {
		await h.close();
	}
});

test("move renames a file", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.upload("0:/gcodes/before.gcode", "G28\n");
		await h.connector.move("0:/gcodes/before.gcode", "0:/gcodes/after.gcode");

		const names = (await h.connector.list("0:/gcodes")).map(e => e.name);
		assert.ok(names.includes("after.gcode"), "renamed file present");
		assert.ok(!names.includes("before.gcode"), "old name gone");
	} finally {
		await h.close();
	}
});

test("move refuses to clobber unless told to", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.upload("0:/gcodes/a.gcode", "G28\n");
		await h.connector.upload("0:/gcodes/b.gcode", "G29\n");

		await assert.rejects(
			() => h.connector.move("0:/gcodes/a.gcode", "0:/gcodes/b.gcode"),
			"overwriting must not be the default",
		);
		await h.connector.move("0:/gcodes/a.gcode", "0:/gcodes/b.gcode", true);
		assert.equal(await h.connector.download("0:/gcodes/b.gcode"), "G28\n");
	} finally {
		await h.close();
	}
});

test("remove deletes a file", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.upload("0:/gcodes/doomed.gcode", "G28\n");
		await h.connector.remove("0:/gcodes/doomed.gcode");
		const names = (await h.connector.list("0:/gcodes")).map(e => e.name);
		assert.ok(!names.includes("doomed.gcode"));
	} finally {
		await h.close();
	}
});

// A non-empty directory must NOT vanish because the caller forgot a flag.
test("remove needs recursive to delete a non-empty directory", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		await h.connector.mkdir("0:/gcodes/batch");
		await h.connector.upload("0:/gcodes/batch/one.gcode", "G28\n");

		await assert.rejects(() => h.connector.remove("0:/gcodes/batch"));
		await h.connector.remove("0:/gcodes/batch", true);

		const names = (await h.connector.list("0:/gcodes")).map(e => e.name);
		assert.ok(!names.includes("batch"));
	} finally {
		await h.close();
	}
});

/**
 * A command that produces no reply must settle promptly. sendCode once waited
 * requestTimeoutMs (5s) for a reply that was never coming, conflating the HTTP
 * request budget with the reply budget - so every silent command (M140, M106,
 * M220) left its caller hanging. Nothing awaited sendCode at the time, so the
 * stall was invisible until a button tried to report when its command landed.
 */
test("a command with no reply settles quickly instead of stalling", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const started = Date.now();
		const reply = await h.connector.sendCode("M140 P0 S40");
		const elapsed = Date.now() - started;
		assert.equal(reply, "", "a silent command reports no reply text");
		assert.ok(
			elapsed < 1500,
			`sendCode took ${elapsed}ms for a silent command - it must not wait out the request timeout`,
		);
	} finally {
		await h.close();
	}
});

// ---- layer history: the connector is the one producer of job.layers ----

test("emulated (SBC) mode: layer history is fetched from DSF's /machine/model", async () => {
	const h = await startHarness({ emulated: true, scenario: "mid-print" });
	try {
		const dsfLayers = [
			{ duration: 61, filament: [2.5], fractionPrinted: 0.01, height: 0.2, temperatures: [210] },
			{ duration: 58, filament: [2.4], fractionPrinted: 0.01, height: 0.2, temperatures: [211] },
		];
		(h.mock.machine.om.job as Record<string, unknown>).layers = dsfLayers;
		await h.connector.connect();
		// The fetch is fire-and-forget off the poll path — give it a beat.
		for (let i = 0; i < 20 && h.layerEvents.length === 0; i++) {
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		assert.ok(h.layerEvents.length >= 1, "a mid-print connect backfills from DSF immediately");
		assert.deepEqual(h.layerEvents.at(-1), dsfLayers, "DSF's genuine history, not a synthesis");
	} finally {
		await h.close();
	}
});

test("standalone mode: layers are synthesized from observed polls", async () => {
	const h = await startHarness({ scenario: "mid-print" });
	try {
		await h.connector.connect();
		const job = h.mock.machine.om.job as Record<string, unknown>;
		await h.connector.pollOnce(); // baseline tick (0→current pseudo-transition)
		const startLayer = job.layer as number;
		job.layer = startLayer + 1;
		job.duration = (job.duration as number) + 30;
		await h.connector.pollOnce();
		const last = h.layerEvents.at(-1);
		assert.ok(Array.isArray(last) && last.length === startLayer, "layers 1..current-1 synthesized");
	} finally {
		await h.close();
	}
});

test("standalone mode never touches /machine/model", async () => {
	// The mock 404s the endpoint when not emulating - a standalone connector
	// asking for it would surface as a failed request somewhere; instead the
	// synthesis path must simply never ask.
	const h = await startHarness({ scenario: "mid-print" });
	try {
		await h.connector.connect();
		await h.connector.pollOnce();
		assert.equal(h.connector.status, "connected");
	} finally {
		await h.close();
	}
});
