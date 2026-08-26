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

/**
 * A settings profile read off the SD card but not yet known to belong to
 * THIS machine — config/migrateStorage.ts's `readStampedMachineOverlay`
 * (Task 8), rendered by Task 9 as `store.meta.claimedProfile`. Not yet
 * wired to a live store (Task 9 has not landed — see SystemCards.tsx's own
 * comment), but the shape matches what Task 9's brief commits to, so this
 * function is ready for it rather than guessing at it later.
 */
export interface ClaimedProfile {
	readonly writtenFor: string | null;
	readonly sections: readonly string[];
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
