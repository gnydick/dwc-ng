/**
 * Machine identity. Getting this wrong is not a cosmetic bug: the key decides
 * whose motion ENVELOPE the app reads, and a second machine inheriting the
 * first machine's envelope is a crash (spec §3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMachineId, isIdentified, machineKeySegment, describeMachineId } from "../src/config/machineId.ts";

const om = (boards: unknown[], interfaces: unknown[]) =>
	({ boards, network: { interfaces } }) as never;

test("uniqueId of the main board wins", () => {
	const id = resolveMachineId(om(
		[{ shortName: "MB6HC", canAddress: 0, uniqueId: "0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1" }],
		[{ mac: "2C:CF:67:CF:F5:50" }],
	));
	assert.deepEqual(id, { kind: "board", uniqueId: "0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1" });
});

test("the MAIN board is the one with canAddress 0 or absent, not boards[0]", () => {
	// A toolboard-first ordering must not key the machine to a toolboard: swap
	// a toolboard and the machine would read as a different machine.
	const id = resolveMachineId(om(
		[{ canAddress: 121, uniqueId: "TOOL-BOARD-ID" }, { canAddress: 0, uniqueId: "MAIN-BOARD-ID" }],
		[],
	));
	assert.deepEqual(id, { kind: "board", uniqueId: "MAIN-BOARD-ID" });
});

test("no uniqueId falls back to the first interface that HAS a mac", () => {
	// Gabe, 2026-08-25. The real capture's second interface is a disabled wifi
	// radio; a board with no ethernet serves a null mac at index 0, so
	// interfaces[0].mac would resolve to no identity on a machine that has one.
	const id = resolveMachineId(om(
		[{ canAddress: 0, shortName: "MB6HC" }],
		[{ mac: null, type: "ethernet" }, { mac: "2C:CF:67:CF:F5:51", type: "wifi" }],
	));
	assert.deepEqual(id, { kind: "mac", mac: "2C:CF:67:CF:F5:51" });
});

test("a blank or whitespace mac is not a mac", () => {
	const id = resolveMachineId(om([{ canAddress: 0 }], [{ mac: "   " }, { mac: "" }]));
	assert.equal(id.kind, "unidentified");
});

test("null board and null interface entries are skipped, not read through", () => {
	const id = resolveMachineId(om([null, { canAddress: 0, uniqueId: "X1" }], [null]));
	assert.deepEqual(id, { kind: "board", uniqueId: "X1" });
});

test("nothing to key on is unidentified, and says why", () => {
	const id = resolveMachineId(om([], []));
	assert.equal(id.kind, "unidentified");
	assert.match((id as { why: string }).why, /uniqueId/i);
	assert.equal(isIdentified(id), false);
});

test("the boot model — before any key has landed — is unidentified, not a crash", () => {
	assert.equal(resolveMachineId({ boards: [], network: { interfaces: [] } } as never).kind, "unidentified");
});

test("key segments are distinct across kinds and safe in a storage key", () => {
	const board = machineKeySegment({ kind: "board", uniqueId: "0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1" });
	const mac = machineKeySegment({ kind: "mac", mac: "2C:CF:67:CF:F5:50" });
	assert.equal(board, "b.0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1");
	// Colons are lowercased and stripped so the segment cannot collide with the
	// dot-delimited key format, and case from the wire cannot make two keys.
	assert.equal(mac, "m.2ccf67cff550");
	assert.notEqual(board, mac);
	// A uniqueId that arrived with a dot cannot forge a second key segment.
	assert.equal(machineKeySegment({ kind: "board", uniqueId: "A.B" }), "b.A-B");
});

test("a mac id and a board id never produce the same segment", () => {
	assert.notEqual(
		machineKeySegment({ kind: "board", uniqueId: "2ccf67cff550" }),
		machineKeySegment({ kind: "mac", mac: "2C:CF:67:CF:F5:50" }),
	);
});

test("describeMachineId is human text for the card, and names the fallback", () => {
	assert.match(describeMachineId({ kind: "board", uniqueId: "X1" }), /X1/);
	assert.match(describeMachineId({ kind: "mac", mac: "2C:CF:67:CF:F5:50" }), /MAC/i);
	assert.match(describeMachineId({ kind: "unidentified", why: "no uniqueId" }), /not identified/i);
});
