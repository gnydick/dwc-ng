import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionSlot, sessionRefusal, assertGoodbyeDelivered } from "../src/session.ts";
import { releaseSessionWhileHidden, type PageLifecycleHost } from "../src/pageSession.ts";
import type { Connector, ConnectionStatus } from "../src/types.ts";

/**
 * The session slot and the page-lifecycle handler, at the seam rather than
 * through a transport: the end-to-end proof that a flapping link stops eating
 * board slots lives in connector.test.ts and dsf-connector.test.ts, and what is
 * checked here is the mechanism those two rely on — that replacing a session IS
 * releasing it, and that a goodbye nobody can deliver costs the caller nothing.
 */

test("acquiring releases the key it replaces, in that order", async () => {
	const events: string[] = [];
	const slot = new SessionSlot<string>(async key => { events.push(`release:${key}`); });

	await slot.acquire(async () => { events.push("open:a"); return "a"; });
	assert.equal(slot.key, "a");
	await slot.acquire(async () => { events.push("open:b"); return "b"; });
	assert.equal(slot.key, "b");

	assert.deepEqual(events, ["open:a", "release:a", "open:b"],
		"the goodbye for the old key precedes the request for the new one");
});

test("a goodbye that fails is swallowed, and the new session is taken anyway", async () => {
	const opened: string[] = [];
	let attempts = 0;
	const slot = new SessionSlot<string>(async () => {
		attempts++;
		throw new Error("network is gone");
	});

	await slot.acquire(async () => { opened.push("a"); return "a"; });
	await slot.acquire(async () => { opened.push("b"); return "b"; });

	assert.equal(attempts, 1, "not-releasing is not the default path — the goodbye was attempted");
	assert.deepEqual(opened, ["a", "b"], "the failed goodbye did not stop the reconnect");
	assert.equal(slot.key, "b");
});

/**
 * The case the mock UAT found and the unit tests above did not. A flapping link
 * fails the goodbye and the connect TOGETHER: the first attempt cannot deliver
 * either, and if the key is dropped at that point the board keeps that slot
 * until its idle sweep — one slot per reconnect, which is the starvation this
 * ticket exists for. Measured in the real UI before this test existed: 3 free
 * slots of 4, then 2, then 1, then 0 and permanent thrash.
 */
test("a goodbye that could not be delivered is retried, not forgotten", async () => {
	let live = false;
	const delivered: string[] = [];
	const slot = new SessionSlot<string>(async key => {
		if (!live) throw new Error("link is down");
		delivered.push(key);
	});

	await slot.acquire(async () => "a");
	// The link is down: the goodbye fails and so does the connect.
	await assert.rejects(slot.acquire(async () => { throw new Error("connect failed"); }));
	assert.deepEqual(delivered, [], "nothing reached the board");

	// The link returns. The next attempt owes the board a goodbye for "a", and
	// pays it before asking for anything new.
	live = true;
	await slot.acquire(async () => "b");
	assert.deepEqual(delivered, ["a"], "the orphan was handed back once the link came back");
	assert.equal(slot.key, "b");

	await slot.acquire(async () => "c");
	assert.deepEqual(delivered, ["a", "b"], "and nothing is owed twice");
});

test("a slot whose open() throws holds nothing — never the key it already gave back", async () => {
	const released: string[] = [];
	const slot = new SessionSlot<string>(async key => { released.push(key); });
	await slot.acquire(async () => "a");

	await assert.rejects(slot.acquire(async () => { throw new Error("refused"); }));
	assert.equal(slot.key, null);
	assert.deepEqual(released, ["a"]);
});

test("release hands the key back and leaves the slot empty; a second release is a no-op", async () => {
	const released: string[] = [];
	const slot = new SessionSlot<string>(async key => { released.push(key); });
	await slot.acquire(async () => "a");

	await slot.release();
	assert.equal(slot.key, null);
	await slot.release();
	assert.deepEqual(released, ["a"], "nothing to hand back the second time");
});

test("two callers racing cannot each open a session and orphan one", async () => {
	// A Connect click landing on top of a ladder attempt. Without the slot's
	// internal chain both would find an empty key, both would open, and one of
	// the two sessions would be held by nobody.
	const released: string[] = [];
	const opened: string[] = [];
	const slot = new SessionSlot<string>(async key => { released.push(key); });
	await slot.acquire(async () => "a");

	await Promise.all([
		slot.acquire(async () => { opened.push("b"); return "b"; }),
		slot.acquire(async () => { opened.push("c"); return "c"; }),
	]);

	assert.deepEqual(opened, ["b", "c"], "both callers got their session");
	assert.deepEqual(released, ["a", "b"], "and each one released what it replaced");
	assert.equal(slot.key, "c");
});

test("reauth takes a new key WITHOUT a goodbye — and needs a refusing status to exist", async () => {
	const released: string[] = [];
	const slot = new SessionSlot<string>(async key => { released.push(key); });
	await slot.acquire(async () => "a");

	const refusal = sessionRefusal(401);
	assert.notEqual(refusal, null);
	await slot.reauth(refusal!, async () => "b");

	assert.deepEqual(released, [], "a key the board has already refused frees nothing");
	assert.equal(slot.key, "b");

	// The token is the whole mechanism: no refusal, no route. 200/404/503 are
	// not the board saying the session is gone, so they mint nothing, and
	// `reauth` cannot be reached from them without a compile error.
	assert.equal(sessionRefusal(403) === null, false);
	for (const status of [200, 404, 500, 503]) {
		assert.equal(sessionRefusal(status), null, `HTTP ${status} is not a refusal`);
	}
});

/**
 * A resolved fetch is not a delivered goodbye. This is the exact shape the mock
 * UAT caught: with the link down, vite's dev proxy answered the goodbye with
 * its OWN 502, the fetch resolved, the key was treated as handed back — and the
 * board went on holding that slot. A reverse proxy in front of a real board
 * does the same thing.
 */
test("only an answer from the far end counts as a delivered goodbye", () => {
	for (const status of [200, 204, 401, 403, 404]) {
		assertGoodbyeDelivered({ status }); // the session is accepted, or already gone
	}
	for (const status of [500, 502, 503, 504]) {
		assert.throws(() => assertGoodbyeDelivered({ status }), /not delivered/,
			`HTTP ${status} left the session on the board`);
	}
});

// ---- the page-lifecycle release ----

interface FakeHost extends PageLifecycleHost {
	fire(type: string): void;
	setVisibility(state: string): void;
	listenerCount(): number;
}

function createFakeHost(): FakeHost {
	const windowListeners = new Map<string, Set<() => void>>();
	const docListeners = new Map<string, Set<() => void>>();
	let visibility = "visible";
	const add = (map: Map<string, Set<() => void>>) => (type: string, fn: () => void) => {
		const set = map.get(type) ?? new Set();
		set.add(fn);
		map.set(type, set);
	};
	const remove = (map: Map<string, Set<() => void>>) => (type: string, fn: () => void) => {
		map.get(type)?.delete(fn);
	};
	return {
		addEventListener: add(windowListeners),
		removeEventListener: remove(windowListeners),
		document: {
			get visibilityState() { return visibility; },
			addEventListener: add(docListeners),
			removeEventListener: remove(docListeners),
		},
		fire(type) {
			for (const fn of [...(windowListeners.get(type) ?? []), ...(docListeners.get(type) ?? [])]) fn();
		},
		setVisibility(state) { visibility = state; },
		listenerCount: () => [...windowListeners.values(), ...docListeners.values()]
			.reduce((n, set) => n + set.size, 0),
	};
}

function createFakeConnector(): Connector & { calls: string[] } {
	const calls: string[] = [];
	let status: ConnectionStatus = "connected";
	return {
		calls,
		get status() { return status; },
		async connect() { calls.push("connect"); status = "connected"; },
		async disconnect() { calls.push("disconnect"); status = "disconnected"; },
	} as unknown as Connector & { calls: string[] };
}

/** The handlers run their work on an internal chain; let it drain. */
const settle = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

test("pagehide releases the session — the tab that closes does not keep a board slot", async () => {
	const host = createFakeHost();
	const connector = createFakeConnector();
	const stop = releaseSessionWhileHidden(connector, host);

	host.fire("pagehide");
	await settle();

	assert.deepEqual(connector.calls, ["disconnect"]);
	stop();
	assert.equal(host.listenerCount(), 0, "unsubscribing leaves nothing armed");
});

test("visibilitychange releases while hidden and takes the session back on return", async () => {
	const host = createFakeHost();
	const connector = createFakeConnector();
	const stop = releaseSessionWhileHidden(connector, host);
	try {
		host.setVisibility("hidden");
		host.fire("visibilitychange");
		await settle();
		assert.deepEqual(connector.calls, ["disconnect"], "a backgrounded phone gives the slot back");

		// A second hidden event (pagehide follows visibilitychange on a real
		// unload) must not fire a second goodbye.
		host.fire("pagehide");
		await settle();
		assert.deepEqual(connector.calls, ["disconnect"]);

		host.setVisibility("visible");
		host.fire("visibilitychange");
		await settle();
		assert.deepEqual(connector.calls, ["disconnect", "connect"], "and takes it back when the operator returns");
	} finally {
		stop();
	}
});

test("a page that was already disconnected is not reconnected behind the operator", async () => {
	const host = createFakeHost();
	const connector = createFakeConnector();
	await connector.disconnect();
	connector.calls.length = 0;

	const stop = releaseSessionWhileHidden(connector, host);
	try {
		host.setVisibility("hidden");
		host.fire("visibilitychange");
		host.setVisibility("visible");
		host.fire("visibilitychange");
		await settle();
		assert.deepEqual(connector.calls, [], "nothing was released, so nothing is resumed");
	} finally {
		stop();
	}
});

test("no page (node, SSR): wiring is a no-op rather than a crash", () => {
	const connector = createFakeConnector();
	const stop = releaseSessionWhileHidden(connector, null);
	stop();
	assert.deepEqual(connector.calls, []);
});
