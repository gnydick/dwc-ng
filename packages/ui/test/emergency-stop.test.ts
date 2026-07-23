/**
 * The e-stop invariant (audit H1/H8): the STOP payload has ONE definition,
 * the guard always lets it through, and the transport never queues or
 * status-gates it. These tests are the welds — the button's payload is
 * pinned to the matcher, and the unblockable path is proven against a held
 * queue slot, a disconnected session, and a culled (401) session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMERGENCY_STOP, isEmergencyStop } from "../src/connector/emergency.ts";
import { cmd } from "../src/control/commands.ts";
import { PollConnector } from "../src/connector/PollConnector.ts";

test("the weld: what the STOP button sends is exactly what the guard lets through", () => {
	assert.equal(cmd.emergencyStop(), EMERGENCY_STOP);
	assert.equal(isEmergencyStop(cmd.emergencyStop()), true);
});

/** Run `fn` with fetch replaced; always restores. */
async function withFetch(
	impl: (url: string) => Promise<Response> | Response,
	fn: (calls: string[]) => Promise<void>,
): Promise<void> {
	const calls: string[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		return impl(url);
	}) as typeof fetch;
	try {
		await fn(calls);
	} finally {
		globalThis.fetch = original;
	}
}

test("e-stop fires even when the connector was never connected", async () => {
	await withFetch(() => new Response("{}", { status: 200 }), async calls => {
		const c = new PollConnector({ baseUrl: "http://board", autoPoll: false });
		// A normal command in this state throws DisconnectedError; the e-stop
		// must not — a reconnecting session still needs to halt the machine.
		const out = await c.sendCode(cmd.emergencyStop());
		assert.equal(out, "");
		assert.equal(calls.length, 1);
		assert.match(calls[0] ?? "", /rr_gcode\?gcode=M112%0AM999/);
	});
});

test("e-stop does not wait for the queue slot an in-flight request holds", async () => {
	await withFetch(
		url => url.includes("rr_download")
			? new Promise<Response>(() => undefined) // holds the single slot forever
			: new Response("{}", { status: 200 }),
		async calls => {
			const c = new PollConnector({ baseUrl: "http://board", autoPoll: false });
			// Occupy the one queue slot with a request that never settles.
			void c.download("0:/gcodes/big.gcode").catch(() => undefined);
			// If the e-stop were queued this await would hang until the test
			// runner's timeout — resolving at all proves the bypass.
			await c.sendCode(cmd.emergencyStop());
			assert.ok(calls.some(u => u.includes("rr_gcode?gcode=M112%0AM999")));
		},
	);
});

test("e-stop re-auths once through a culled session and fires again", async () => {
	let gcodeCalls = 0;
	await withFetch(
		url => {
			if (url.includes("rr_gcode")) {
				gcodeCalls++;
				return new Response("", { status: gcodeCalls === 1 ? 401 : 200 });
			}
			if (url.includes("rr_connect")) {
				return new Response(JSON.stringify({ err: 0, sessionKey: 7 }), { status: 200 });
			}
			return new Response("{}", { status: 200 });
		},
		async calls => {
			const c = new PollConnector({ baseUrl: "http://board", autoPoll: false });
			await c.sendCode(cmd.emergencyStop());
			const order = calls.map(u => (u.includes("rr_gcode") ? "gcode" : u.includes("rr_connect") ? "connect" : "other"));
			assert.deepEqual(order, ["gcode", "connect", "gcode"]);
		},
	);
});

test("a failed e-stop surfaces as a rejection — never a silent no-op", async () => {
	await withFetch(() => new Response("", { status: 500 }), async () => {
		const c = new PollConnector({ baseUrl: "http://board", autoPoll: false });
		await assert.rejects(() => c.sendCode(cmd.emergencyStop()), /emergency stop: HTTP 500/);
	});
});
