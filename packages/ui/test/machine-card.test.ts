/**
 * The System card that says which machine this is (#84/#85 Task 11).
 *
 * Per the brief: test the card's text-producing helpers as pure functions
 * rather than mounting it (compose/cards.tsx is JSX and cannot be
 * type-stripped by node:test — see its own header comment).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMachineId, type MachineId } from "../src/config/machineId.ts";
import {
	claimedProfileText, droppedSectionsText, identityKey, identityRow, identitySourceNote,
} from "../src/cards/machineIdentityText.ts";
import { CARD_DEFS } from "../src/compose/defs.ts";
import { SYSTEM_COMPOSITION } from "../src/compose/screens.ts";

// ---- registration: the card exists and is placed ----

test("machine-identity is registered and placed on the System screen", () => {
	assert.ok("machine-identity" in CARD_DEFS, "registered as a card def");
	assert.ok("machine-identity" in SYSTEM_COMPOSITION, "placed on System's composition");
});

// ---- identity: unidentified renders no key ----

test("an unidentified machine says so and does not render a key", () => {
	const id: MachineId = { kind: "unidentified", why: "no board uniqueId and no network interface MAC" };
	assert.match(describeMachineId(id), /not identified/);
	assert.equal(identityKey(id), null, "nothing to derive a storage key from");
	assert.equal(identitySourceNote(id), null, "nothing to explain about a source that doesn't exist yet");
});

// ---- identity: board-derived ----

test("a board-derived identity names its source and has a key", () => {
	const id: MachineId = { kind: "board", uniqueId: "0xDEADBEEF" };
	assert.match(describeMachineId(id), /board 0xDEADBEEF/);
	assert.equal(identityKey(id), "b.0xDEADBEEF");
	assert.match(identitySourceNote(id) ?? "", /own unique ID/);
});

// ---- identity: MAC fallback ----

test("a MAC-derived identity says the fallback was used", () => {
	const id: MachineId = { kind: "mac", mac: "AA:BB:CC:DD:EE:FF" };
	assert.match(describeMachineId(id), /MAC/);
	assert.equal(identityKey(id), "m.aabbccddeeff");
	const note = identitySourceNote(id);
	assert.match(note ?? "", /fallback/i);
	assert.match(note ?? "", /new identity/i, "says what changes if this board later gains a uniqueId");
});

// ---- identity row: label/value split for the house .field row ----
// (the identity row must be a genuine .field row — bold label, plain value,
// no colon — not describeMachineId's one prose string; see SystemCards.tsx)

test("an unidentified machine's identity row carries no board/mac prose in its label", () => {
	const id: MachineId = { kind: "unidentified", why: "no board uniqueId and no network interface MAC" };
	const row = identityRow(id);
	assert.equal(row.label, "Not identified");
	assert.equal(row.value, "no board uniqueId and no network interface MAC");
	assert.doesNotMatch(row.label, /:/, "label must not carry a colon — no other card does");
});

test("a board-derived identity row splits label from the bare uniqueId", () => {
	const id: MachineId = { kind: "board", uniqueId: "0xDEADBEEF" };
	const row = identityRow(id);
	assert.equal(row.label, "Board");
	assert.equal(row.value, "0xDEADBEEF", "value is the bare id, not label+value glued together");
});

test("a MAC-derived identity row splits label from the fallback explanation", () => {
	const id: MachineId = { kind: "mac", mac: "AA:BB:CC:DD:EE:FF" };
	const row = identityRow(id);
	assert.equal(row.label, "MAC");
	assert.match(row.value, /^AA:BB:CC:DD:EE:FF/);
	assert.match(row.value, /no uniqueId/);
});

// ---- claimed profile ----

test("no claimed profile renders nothing", () => {
	assert.equal(claimedProfileText(null), null);
});

test("a claimed profile names the board it was written for", () => {
	const text = claimedProfileText({ writtenFor: "b.A", sections: ["shaping"] });
	assert.match(text ?? "", /b\.A/);
	assert.match(text ?? "", /claimed, not in effect/);
});

test("a claimed profile with no recorded origin still says so, not silently", () => {
	const text = claimedProfileText({ writtenFor: null, sections: [] });
	assert.match(text ?? "", /unrecorded machine/);
});

// ---- dropped sections (v2 -> v3 migration report) ----

test("no dropped sections renders nothing", () => {
	assert.equal(droppedSectionsText([]), null);
});

test("dropped sections name what was re-read from this board's card", () => {
	const text = droppedSectionsText(["axisRoles", "shaping"]);
	assert.match(text ?? "", /re-read from this board's card/);
	assert.match(text ?? "", /axisRoles/);
	assert.match(text ?? "", /shaping/);
});
