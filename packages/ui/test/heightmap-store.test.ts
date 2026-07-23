import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoot } from "solid-js";
import { createHeightMapStore, HEIGHTMAP_FILE } from "../src/heightmap/store.ts";
import type { Connector } from "../src/connector/types.ts";

const CAPTURE = new URL(
	"../../mock-duet/captures/duet3-real-2026-07-15/heightmap.csv",
	import.meta.url,
);

interface Calls { download: string[]; upload: [string, string][]; codes: string[] }

function fakeConnector(opts: { failUpload?: boolean; failReload?: boolean } = {}) {
	const calls: Calls = { download: [], upload: [], codes: [] };
	const connector = {
		download: async (path: string) => { calls.download.push(path); return readFileSync(CAPTURE, "utf8"); },
		upload: async (path: string, content: Uint8Array | string) => {
			calls.upload.push([path, String(content)]);
			if (opts.failUpload) throw new Error("board said no");
		},
		sendCode: async (code: string) => {
			calls.codes.push(code);
			if (opts.failReload) throw new Error("reload refused");
			return "";
		},
	} as unknown as Connector;
	return { connector, calls };
}

async function withStore(
	fn: (store: ReturnType<typeof createHeightMapStore>, calls: Calls) => Promise<void>,
	opts: Parameters<typeof fakeConnector>[0] = {},
): Promise<void> {
	const { connector, calls } = fakeConnector(opts);
	let dispose = (): void => {};
	const store = createRoot(d => { dispose = d; return createHeightMapStore(connector); });
	try { await fn(store, calls); } finally { dispose(); }
}

test("load reads the height map from the machine", async () => {
	await withStore(async (store, calls) => {
		await store.load();
		assert.deepEqual(calls.download, [HEIGHTMAP_FILE]);
		assert.equal(store.map()?.meta.num0, 16);
		assert.equal(store.dirty(), false);
	});
});

test("an unreadable map reports an error rather than a blank grid", async () => {
	const { connector } = fakeConnector();
	const broken = { ...connector, download: async () => "not a height map" } as unknown as Connector;
	let dispose = (): void => {};
	const store = createRoot(d => { dispose = d; return createHeightMapStore(broken); });
	await store.load();
	assert.equal(store.map(), null);
	assert.match(store.error(), /height map/i);
	dispose();
});

test("an edit is pending, not applied to the loaded map", async () => {
	await withStore(async store => {
		await store.load();
		const before = store.map()!.rows[0]?.[0];
		store.edit(0, 0, 0.123);
		assert.equal(store.dirty(), true);
		assert.equal(store.valueAt(0, 0), 0.123, "the pending value is what the UI shows");
		assert.equal(store.map()!.rows[0]?.[0], before, "the loaded map is untouched until save");
		assert.deepEqual(store.pending().get("0,0"), { row: 0, col: 0, from: before, to: 0.123 });
	});
});

test("editing a cell back to its original value clears the edit", async () => {
	await withStore(async store => {
		await store.load();
		const original = store.valueAt(0, 0);
		store.edit(0, 0, 0.123);
		assert.equal(store.dirty(), true);
		store.edit(0, 0, original);
		assert.equal(store.dirty(), false, "a no-op edit must not leave the map dirty");
	});
});

test("discard drops every pending edit", async () => {
	await withStore(async store => {
		await store.load();
		const before = store.valueAt(0, 0);
		store.edit(0, 0, 9);
		store.edit(1, 1, 9);
		store.discard();
		assert.equal(store.dirty(), false);
		assert.equal(store.pending().size, 0);
		assert.equal(store.valueAt(0, 0), before);
	});
});

test("save uploads the edited map AND reloads it on the machine", async () => {
	// Uploading alone changes nothing: RRF keeps using the map it already
	// loaded. The two must not be separable.
	await withStore(async (store, calls) => {
		await store.load();
		store.edit(0, 0, 0.123);
		const result = await store.save();
		assert.deepEqual(result, { ok: true });
		assert.equal(calls.upload.length, 1);
		assert.equal(calls.upload[0]?.[0], HEIGHTMAP_FILE);
		assert.match(calls.upload[0]?.[1] ?? "", /0\.123/, "the edit reached the file");
		assert.deepEqual(calls.codes, ["G29 S1"], "the machine must reload the map");
	});
});

test("many edits produce exactly one upload", async () => {
	await withStore(async (store, calls) => {
		await store.load();
		store.edit(0, 0, 0.1);
		store.edit(1, 1, 0.2);
		store.edit(2, 2, 0.3);
		await store.save();
		assert.equal(calls.upload.length, 1);
	});
});

test("a save that fails leaves the edits pending", async () => {
	await withStore(async (store, calls) => {
		await store.load();
		store.edit(0, 0, 0.123);
		const result = await store.save();
		assert.equal(result.ok, false);
		assert.equal(store.dirty(), true, "edits must survive a failed write");
		assert.equal(calls.codes.length, 0, "no reload after a failed upload");
	}, { failUpload: true });
});

test("a reload that fails is reported, and does not claim the map is clean", async () => {
	// The file is on the card but the machine is still compensating with the old
	// map. Saying "saved" here would be a lie the operator acts on.
	await withStore(async (store, calls) => {
		await store.load();
		store.edit(0, 0, 0.123);
		const result = await store.save();
		assert.equal(result.ok, false);
		assert.equal(calls.upload.length, 1, "the upload did happen");
		assert.equal(store.dirty(), true, "not clean: the machine never took it");
	}, { failReload: true });
});

test("save clears the pending set once it has succeeded", async () => {
	await withStore(async store => {
		await store.load();
		store.edit(0, 0, 0.123);
		await store.save();
		assert.equal(store.dirty(), false);
		assert.equal(store.valueAt(0, 0), 0.123, "the saved value is now the loaded value");
	});
});
