import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { copyText } from "../src/shell/copyText.ts";

/**
 * These run in node, with hand-built stand-ins for the two browser APIs
 * involved. That is the point: the case that matters is an INSECURE ORIGIN,
 * where navigator.clipboard does not exist — and no browser the tests could
 * run in would reproduce it, which is precisely why the original bug survived
 * a "verified in Chrome" check.
 */

interface FakeArea {
	value: string;
	style: Record<string, string>;
	focus(): void;
	select(): void;
	remove(): void;
	setAttribute(name: string, value: string): void;
}

/** Install a minimal document whose execCommand outcome we control. */
function fakeDocument(copyWorks: boolean): { commands: string[]; attached: number; detached: number } {
	const log = { commands: [] as string[], attached: 0, detached: 0 };
	const doc = {
		createElement: (): FakeArea => ({
			value: "",
			style: {},
			focus: () => undefined,
			select: () => undefined,
			remove: () => { log.detached++; },
			setAttribute: () => undefined,
		}),
		body: { appendChild: () => { log.attached++; } },
		execCommand: (command: string): boolean => { log.commands.push(command); return copyWorks; },
		getSelection: () => null,
	};
	define("document", doc);
	return log;
}

/**
 * defineProperty, not assignment: node >= 21 ships its own `navigator` as a
 * getter-only global, so `globalThis.navigator = ...` throws outright.
 */
function define(name: string, value: unknown): void {
	Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const setClipboard = (clipboard: unknown): void => {
	define("navigator", clipboard === undefined ? {} : { clipboard });
};

afterEach(() => {
	delete (globalThis as { document?: unknown }).document;
	delete (globalThis as { navigator?: unknown }).navigator;
});

test("uses the modern API when it is available", async () => {
	const written: string[] = [];
	setClipboard({ writeText: async (t: string) => { written.push(t); } });
	const log = fakeDocument(true);
	assert.equal(await copyText("M568 P0"), true);
	assert.deepEqual(written, ["M568 P0"]);
	assert.deepEqual(log.commands, [], "must not also run the fallback");
});

test("INSECURE ORIGIN: navigator.clipboard is undefined and the fallback copies", async () => {
	// The whole reason this module exists. Reading .writeText off an undefined
	// clipboard throws synchronously, so an implementation that is not
	// optional-chained fails here rather than falling back.
	setClipboard(undefined);
	const log = fakeDocument(true);
	assert.equal(await copyText("0:/sys/config.g"), true);
	assert.deepEqual(log.commands, ["copy"]);
});

test("a rejected modern write still falls through to the fallback", async () => {
	// The API can exist and refuse: denied permission, or an unfocused document.
	setClipboard({ writeText: async () => { throw new Error("NotAllowedError"); } });
	const log = fakeDocument(true);
	assert.equal(await copyText("G29 S1"), true);
	assert.deepEqual(log.commands, ["copy"]);
});

test("returns FALSE when nothing worked — never a silent success", async () => {
	// The defect being fixed: the old code swallowed this into a bare catch, so
	// a dead clipboard looked exactly like a dead button.
	setClipboard(undefined);
	fakeDocument(false);
	assert.equal(await copyText("heat.heaters"), false);
});

test("the offscreen textarea is always removed, even when the copy fails", async () => {
	setClipboard(undefined);
	const log = fakeDocument(false);
	await copyText("x");
	assert.equal(log.attached, 1);
	assert.equal(log.detached, 1, "a failed copy must not leak the element into the document");
});

test("never throws, whatever the environment does", async () => {
	// A browser that has the property but blows up on access must still leave
	// the caller with a boolean rather than an exception mid-render.
	setClipboard({ get writeText(): never { throw new Error("boom"); } });
	fakeDocument(false);
	await assert.doesNotReject(async () => { await copyText("y"); });
});
