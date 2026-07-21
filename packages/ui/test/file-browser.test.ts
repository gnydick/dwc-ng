import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
import { createFileBrowser, type FileBrowser } from "../src/files/browser.ts";
import type { Connector, FileListEntry } from "../src/connector/types.ts";

const ROOT = "0:/gcodes";

interface Calls {
	list: string[];
	mkdir: string[];
	upload: string[];
	move: [string, string][];
	remove: [string, boolean | undefined][];
}

/** Minimal Connector double — only the members the browser is allowed to touch. */
function fakeConnector(opts: { entries?: FileListEntry[]; fail?: string } = {}) {
	const calls: Calls = { list: [], mkdir: [], upload: [], move: [], remove: [] };
	const reject = async (op: string): Promise<void> => {
		if (opts.fail === op) throw new Error("board said no");
	};
	const connector = {
		list: async (dir: string) => {
			calls.list.push(dir);
			return opts.entries ?? [];
		},
		mkdir: async (path: string) => { calls.mkdir.push(path); await reject("mkdir"); },
		upload: async (path: string) => { calls.upload.push(path); await reject("upload"); },
		move: async (from: string, to: string) => { calls.move.push([from, to]); await reject("move"); },
		remove: async (path: string, recursive?: boolean) => {
			calls.remove.push([path, recursive]);
			await reject("remove");
		},
	} as unknown as Connector;
	return { connector, calls };
}

/** Run a browser inside a reactive root, letting pending resource work settle. */
async function withBrowser(
	fn: (browser: FileBrowser, calls: Calls) => Promise<void>,
	opts: Parameters<typeof fakeConnector>[0] = {},
): Promise<void> {
	const { connector, calls } = fakeConnector(opts);
	let dispose = (): void => {};
	const browser = createRoot(d => {
		dispose = d;
		return createFileBrowser(ROOT, () => true, connector);
	});
	await settle();
	try {
		await fn(browser, calls);
	} finally {
		dispose();
	}
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

// --- I2: the listing is re-read after EVERY mutation, success or failure ---

/**
 * Enumerated rather than spot-checked: this is the regression test for the
 * invariant itself. A mutation added to FileBrowser without a refetch fails
 * here as soon as it is listed, and leaving it unlisted is itself the finding.
 */
const MUTATIONS: { name: string; run: (b: FileBrowser) => Promise<unknown> }[] = [
	{ name: "createDir", run: b => b.createDir("newdir") },
	{ name: "createFile", run: b => b.createFile("new.g") },
	{ name: "rename", run: b => b.rename({ type: "f", name: "a.g", size: 1 }, "b.g") },
	{ name: "remove", run: async b => b.remove(await b.planRemove({ type: "f", name: "a.g", size: 1 })) },
];

for (const mutation of MUTATIONS) {
	test(`${mutation.name} re-reads the listing after it succeeds`, async () => {
		await withBrowser(async (browser, calls) => {
			const before = calls.list.length;
			const result = await mutation.run(browser);
			await settle();
			assert.deepEqual(result, { ok: true });
			assert.ok(
				calls.list.length > before,
				`${mutation.name} did not refresh the listing`,
			);
		});
	});
}

test("a failed mutation still re-reads the listing and reports why", async () => {
	await withBrowser(
		async (browser, calls) => {
			const before = calls.list.length;
			const result = await browser.createDir("newdir");
			await settle();
			assert.equal(result.ok, false);
			assert.match((result as { error: string }).error, /board said no/);
			assert.ok(calls.list.length > before, "a failure must not leave a stale listing");
		},
		{ fail: "mkdir" },
	);
});

// --- I4: a name that could escape never reaches the connector ---

test("a traversing name is refused before any request is made", async () => {
	await withBrowser(async (browser, calls) => {
		const result = await browser.createDir("../../sys");
		assert.equal(result.ok, false);
		assert.equal(calls.mkdir.length, 0, "no request may be issued for an unusable name");
	});
});

test("a name with a separator is refused for every name-taking operation", async () => {
	await withBrowser(async (browser, calls) => {
		assert.equal((await browser.createFile("a/b.g")).ok, false);
		assert.equal((await browser.rename({ type: "f", name: "a.g", size: 1 }, "x/y.g")).ok, false);
		assert.equal(calls.upload.length, 0);
		assert.equal(calls.move.length, 0);
	});
});

// --- operation semantics ---

test("createDir builds the path from the current directory", async () => {
	await withBrowser(async (browser, calls) => {
		await browser.createDir("  spare  ");
		assert.deepEqual(calls.mkdir, ["0:/gcodes/spare"]);
	});
});

test("renaming an entry to its own name touches nothing", async () => {
	await withBrowser(async (browser, calls) => {
		const result = await browser.rename({ type: "f", name: "a.g", size: 1 }, "a.g");
		assert.deepEqual(result, { ok: true });
		assert.equal(calls.move.length, 0);
	});
});

test("deleting a directory is recursive; deleting a file is not", async () => {
	await withBrowser(async (browser, calls) => {
		await browser.remove(await browser.planRemove({ type: "d", name: "sub", size: 0 }));
		await browser.remove(await browser.planRemove({ type: "f", name: "a.g", size: 1 }));
		assert.deepEqual(calls.remove, [
			["0:/gcodes/sub", true],
			["0:/gcodes/a.g", false],
		]);
	});
});

// --- data-loss guards: what a delete would actually destroy ---

test("planning a directory delete counts what is inside it", async () => {
	await withBrowser(
		async browser => {
			const plan = await browser.planRemove({ type: "d", name: "sub", size: 0 });
			assert.equal(plan.itemCount, 3, "the operator must be told how much is at stake");
			assert.equal(plan.recursive, true);
		},
		{
			entries: [
				{ type: "f", name: "a.g", size: 1 },
				{ type: "f", name: "b.g", size: 1 },
				{ type: "f", name: "c.g", size: 1 },
			],
		},
	);
});

test("a file's plan is never recursive and counts nothing", async () => {
	await withBrowser(async browser => {
		const plan = await browser.planRemove({ type: "f", name: "a.g", size: 1 });
		assert.equal(plan.recursive, false);
		assert.equal(plan.itemCount, 0);
		assert.equal(plan.protectedReason, null);
	});
});

test("an unreadable directory reports unknown contents rather than empty", async () => {
	// Guessing "empty" here is exactly how a silent recursive wipe happens.
	const { connector } = fakeConnector();
	let calls = 0;
	const failing = {
		...connector,
		list: async (dir: string) => {
			calls++;
			if (calls > 1) throw new Error("unreadable");
			return [];
		},
	} as unknown as Connector;
	let dispose = (): void => {};
	const browser = createRoot(d => {
		dispose = d;
		return createFileBrowser(ROOT, () => true, failing);
	});
	await settle();
	const plan = await browser.planRemove({ type: "d", name: "sub", size: 0 });
	assert.equal(plan.itemCount, -1, "unknown must not be reported as empty");
	dispose();
});

test("a protected file refuses to delete without its name typed back", async () => {
	await withBrowser(async (browser, calls) => {
		const plan = await browser.planRemove({ type: "f", name: "config.g", size: 1 });
		assert.ok(plan.protectedReason !== null);

		const bare = await browser.remove(plan);
		assert.equal(bare.ok, false);
		assert.equal(calls.remove.length, 0, "no request may reach the board");

		const wrong = await browser.remove(plan, "config");
		assert.equal(wrong.ok, false);
		assert.equal(calls.remove.length, 0);

		const right = await browser.remove(plan, "config.g");
		assert.deepEqual(right, { ok: true });
		assert.deepEqual(calls.remove, [["0:/gcodes/config.g", false]]);
	});
});

test("an ordinary file needs no typed name", async () => {
	await withBrowser(async (browser, calls) => {
		const plan = await browser.planRemove({ type: "f", name: "benchy.gcode", size: 1 });
		assert.deepEqual(await browser.remove(plan), { ok: true });
		assert.equal(calls.remove.length, 1);
	});
});

// --- navigation ---

test("entries list directories first, then case-insensitively by name", async () => {
	await withBrowser(
		async browser => {
			// "Alpha" sorts before "beta" only because the comparison ignores case;
			// a plain localeCompare would strand capitals in their own block.
			assert.deepEqual(browser.entries().map(e => e.name), ["sub", "Alpha", "beta", "zeta"]);
		},
		{
			entries: [
				{ type: "f", name: "zeta", size: 1 },
				{ type: "f", name: "beta", size: 1 },
				{ type: "d", name: "sub", size: 0 },
				{ type: "f", name: "Alpha", size: 1 },
			],
		},
	);
});

test("recent sort puts the newest file first but keeps directories alphabetical", async () => {
	const { connector } = fakeConnector({
		entries: [
			{ type: "f", name: "old.gcode", size: 1, date: "2026-07-01T10:00:00" },
			{ type: "d", name: "zeta", size: 0 },
			{ type: "f", name: "new.gcode", size: 1, date: "2026-07-20T10:00:00" },
			{ type: "d", name: "alpha", size: 0 },
		],
	});
	let dispose = (): void => {};
	const browser = createRoot(d => {
		dispose = d;
		return createFileBrowser(ROOT, () => true, connector, "recent");
	});
	await settle();
	assert.deepEqual(browser.entries().map(e => e.name), ["alpha", "zeta", "new.gcode", "old.gcode"]);
	dispose();
});

test("recent sort keeps a total order when dates are missing", async () => {
	const { connector } = fakeConnector({
		entries: [
			{ type: "f", name: "b.gcode", size: 1 },
			{ type: "f", name: "dated.gcode", size: 1, date: "2026-07-01T10:00:00" },
			{ type: "f", name: "a.gcode", size: 1 },
		],
	});
	let dispose = (): void => {};
	const browser = createRoot(d => {
		dispose = d;
		return createFileBrowser(ROOT, () => true, connector, "recent");
	});
	await settle();
	// Dated first, then the undated pair alphabetically — never transport order.
	assert.deepEqual(browser.entries().map(e => e.name), ["dated.gcode", "a.gcode", "b.gcode"]);
	dispose();
});

test("entering a file does nothing; entering a directory descends", async () => {
	await withBrowser(async browser => {
		browser.enter({ type: "f", name: "a.g", size: 1 });
		assert.equal(browser.dir(), ROOT);
		browser.enter({ type: "d", name: "sub", size: 0 });
		assert.equal(browser.dir(), "0:/gcodes/sub");
	});
});

test("goUp climbs back and then clamps at the domain root", async () => {
	await withBrowser(async browser => {
		browser.goTo("0:/gcodes/a/b");
		browser.goUp();
		assert.equal(browser.dir(), "0:/gcodes/a");
		browser.goUp();
		assert.equal(browser.dir(), ROOT);
		browser.goUp();
		assert.equal(browser.dir(), ROOT, "the root is the floor");
	});
});

test("crumbs describe the path below the root", async () => {
	await withBrowser(async browser => {
		browser.goTo("0:/gcodes/a/b");
		assert.deepEqual(browser.crumbs(), [
			{ name: "a", path: "0:/gcodes/a" },
			{ name: "b", path: "0:/gcodes/a/b" },
		]);
	});
});
