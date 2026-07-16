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
		},
	});

	return {
		mock, connector, keys, patches, replies, statuses, filesChanged,
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
		assert.equal(info.thumbnails[0].format, "qoi");
		assert.deepEqual([info.thumbnails[0].width, info.thumbnails[0].height], [160, 160]);
	} finally {
		await h.close();
	}
});

test("getThumbnail stitches rr_thumbnail chunks and returns decoded image bytes", async () => {
	const h = await startHarness();
	try {
		await h.connector.connect();
		const info = await h.connector.getFileInfo(SEAT_SUPPORT);
		const bytes = await h.connector.getThumbnail(SEAT_SUPPORT, info.thumbnails[0].offset);

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
