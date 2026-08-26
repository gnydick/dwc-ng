/**
 * Pure text for the System card that answers "which machine is this?"
 * (SystemCards.tsx). Kept apart from that JSX so node's type-stripped
 * `node:test` can import it directly — see compose/cards.tsx's own header
 * comment for why a card body cannot be loaded the same way.
 *
 * Every fact here is read off Task 2's choke point (config/machineId.ts):
 * this module reformats nothing itself, it only decides WHETHER and WHEN a
 * fact is shown.
 */
import { isIdentified, machineKeySegment, type MachineId } from "../config/machineId.ts";
// The canonical shape lives on ConfigStore (config/store.ts) — imported (and
// re-exported below for SystemCards.tsx) rather than re-declared here, so a
// shape change there is a compile error at every consumer of this alias
// instead of a silent divergence a test would have to happen to catch.
import type { ClaimedProfile } from "../config/store.ts";
export type { ClaimedProfile };

/**
 * The storage key this identity resolves to (machineKeySegment, Task 2's
 * only door to one), or null before there is an identity to derive one
 * from. An unidentified machine renders no key — there is nothing it could
 * honestly show.
 */
export function identityKey(id: MachineId): string | null {
	return isIdentified(id) ? machineKeySegment(id) : null;
}

/**
 * Label/value split for the identity row rendered as a house `.field` (a
 * bold `.field-label` plus a plain-value sibling — SystemCards.tsx). Every
 * other card in this repo follows that pattern with the label holding ONLY
 * the label; `describeMachineId` (config/machineId.ts) instead returns one
 * prose string ("board X") because that reads correctly inline inside
 * `claimedProfileText`'s claim sentence, so it stays as-is for that caller
 * and this function exists to give the card row its own two pieces instead
 * of reshaping that shared string.
 */
export function identityRow(id: MachineId): { label: string; value: string } {
	switch (id.kind) {
		case "board":
			return { label: "Board", value: id.uniqueId };
		case "mac":
			return { label: "MAC", value: `${id.mac} (this board reports no uniqueId)` };
		case "unidentified":
			return { label: "Not identified", value: id.why };
	}
}

/**
 * What this identity's proof actually is, and — for the MAC fallback only —
 * what changes the day this board starts reporting a uniqueId: a NEW
 * identity and a NEW storage key, so today's settings do not just follow
 * along. Null for `unidentified`: there is no source to explain yet.
 */
export function identitySourceNote(id: MachineId): string | null {
	switch (id.kind) {
		case "board":
			return "Identified by this board's own unique ID — stable across reboots and firmware updates.";
		case "mac":
			return "Identified by network MAC address, the fallback used because this board reports no unique ID. "
				+ "If a firmware update later adds one, this machine gets a new identity and a new settings key — "
				+ "today's saved settings will not carry over on their own.";
		case "unidentified":
			return null;
	}
}

/** Names the board a claimed profile was written for, so "claimed, not
 *  adopted" is something the operator reads rather than infers. */
export function claimedProfileText(claimed: ClaimedProfile | null): string | null {
	if (claimed === null) return null;
	const board = claimed.writtenFor ?? "an unrecorded machine";
	return `A settings profile was written for ${board}, not this machine — it is claimed, not in effect. `
		+ "Adopt to use it here, or Clear to discard it.";
}

/**
 * The v2 -> v3 migration's report (config/store.ts `droppedMachineSections`,
 * Task 8): which machine-scoped sections were re-read from this board's own
 * card because the browser's copy carried no proof of which machine it
 * belonged to.
 */
export function droppedSectionsText(sections: readonly string[]): string | null {
	if (sections.length === 0) return null;
	return "Machine settings from before this update were re-read from this board's card: "
		+ `${sections.join(", ")}.`;
}
