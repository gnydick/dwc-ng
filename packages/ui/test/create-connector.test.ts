/**
 * The transport seam (design D9, invariant C1): one construction site, a
 * closed transport union, and no way to end up half-switched between
 * dialects.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnector, probeTransport } from "../src/connector/createConnector.ts";
import { PollConnector } from "../src/connector/PollConnector.ts";
import { DsfConnector } from "../src/connector/DsfConnector.ts";
import { BACKENDS } from "../src/dev/backend.ts";
import { createMockServer } from "../../mock-duet/src/server.ts";

test("the factory maps each transport to its connector class", () => {
	const rr = createConnector({ transport: "rr", baseUrl: "", password: "" }, {});
	assert.ok(rr instanceof PollConnector);
	const dsf = createConnector({ transport: "dsf", baseUrl: "", password: "" }, {});
	assert.ok(dsf instanceof DsfConnector);
});

test("no connector exposes an in-place endpoint switch (C14)", () => {
	// A transport change is a different class; re-pointing cannot express it,
	// so the dev toggle reloads instead and the half-switched state has no
	// representation. If someone re-adds switchEndpoint, this fails.
	for (const c of [
		createConnector({ transport: "rr", baseUrl: "", password: "" }, {}),
		createConnector({ transport: "dsf", baseUrl: "", password: "" }, {}),
	]) {
		assert.equal((c as unknown as Record<string, unknown>)["switchEndpoint"], undefined);
	}
});

test("every dev backend declares a transport and its own real-ness", () => {
	// The write guard reads `real` from the record rather than comparing the
	// id against "real" — with two real backends a string test would silently
	// unguard one of them.
	assert.ok(BACKENDS.length >= 4, "mock and real, each in both dialects");
	for (const b of BACKENDS) {
		assert.ok(b.transport === "rr" || b.transport === "dsf", b.id);
		assert.equal(typeof b.real, "boolean", b.id);
		assert.equal(b.real, b.baseUrl === "/real", `${b.id}: real-ness matches the proxy target`);
	}
	assert.equal(BACKENDS.filter(b => b.real).length, 2, "both real dialects are guarded");
});

test("probeTransport answers dsf only where /machine/status lives", async t => {
	const dsfMock = createMockServer({ tickMs: 0, dsf: true });
	const dsfPort = await dsfMock.listen(0);
	const rrMock = createMockServer({ tickMs: 0 });
	const rrPort = await rrMock.listen(0);
	t.after(async () => { await dsfMock.close(); await rrMock.close(); });

	assert.equal(await probeTransport(`http://127.0.0.1:${dsfPort}`), "dsf");
	assert.equal(await probeTransport(`http://127.0.0.1:${rrPort}`), "rr", "standalone has no /machine routes");
	// Unreachable origins fall back to rr_ — the historical default, and the
	// one that also works when the probe is merely slow.
	assert.equal(await probeTransport("http://127.0.0.1:1", 200), "rr");
});
