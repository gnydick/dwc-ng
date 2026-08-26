/**
 * The v2 → v3 storage transform (spec §4, campaign #76 phase 1 task 8).
 *
 * Two artefacts once carried the whole (unsplit) overlay, and they get
 * different treatment here because they carry different EVIDENCE:
 *  - the SD file (config/store.ts CONFIG_FILE) is self-attributing — reading
 *    it back over a live connection to board X IS proof it is board X's;
 *  - the pre-split localStorage cache this module migrates carries no such
 *    proof. It is exactly the mechanism of the cross-machine bug this whole
 *    campaign exists to close, so its machine-scoped bytes are DROPPED,
 *    never guessed at.
 *
 * @invariant legacy-key-single-mention
 * @rung 6  choke-point — test/storage-keys.test.ts (skipped until Task 10,
 *          which unskips it) fails the suite if the string "dwc-ng.config"
 *          appears anywhere under packages/ui/src outside this file. Every
 *          other module reaches the legacy cache only through
 *          readAndClearLegacyPersonCache below, never the literal itself.
 * @why dwc-ng.config is the pre-split, origin-global key Task 6/7 retired.
 *      A second file spelling it out is a second door a future edit could
 *      read — or worse, write — through, re-introducing the exact key this
 *      migration exists to retire
 */
import { isPlainObject } from "@dwc-ng/connector";
import { parseOverlay } from "./parse.ts";
import {
	CONFIG_VERSION, MACHINE_SECTIONS, splitOverlay,
	type ConfigOverlay, type DeepPartial, type MachineConfig, type PersonConfig,
} from "./types.ts";
import { machineKeySegment, type IdentifiedMachine } from "./machineId.ts";

/**
 * Which machine sections an (untrusted) overlay names — not the validated
 * result. A key that is present but malformed (a garbled `axisRoles`) is
 * still named: the caller's overlay DID carry an axisRoles section, whether
 * or not its content also failed validation. `screens` is reported as
 * `screens.layouts` (never bare `screens`) because that is the only part of
 * it that is ever machine-scoped — see types.ts's splitOverlay.
 *
 * Two callers, one naming rule: config/store.ts's v2 → v3 migration report
 * (what a legacy cache carried and could not be carried forward) and its
 * claimed-profile report (what a mismatched SD file's machine half names,
 * pending Adopt/Clear — Task 9). Exported rather than duplicated so the two
 * reports can never drift on what counts as a "section".
 */
export function overlaySectionNames(rawOverlay: Record<string, unknown>): string[] {
	const names: string[] = [];
	for (const key of MACHINE_SECTIONS) {
		if (key in rawOverlay) names.push(key);
	}
	if (isPlainObject(rawOverlay.screens) && "layouts" in rawOverlay.screens) names.push("screens.layouts");
	return names;
}

/**
 * The live overlay's half of the v2 → v3 transform. Pure and total — a
 * hand-mangled cache, a foreign version, or no cache at all all return the
 * SAME shape rather than throwing, exactly like migrateOverlayColumns
 * (parse.ts) before it: the caller (config/store.ts) needs no separate
 * failure path for "this wasn't actually migratable".
 *
 * Only version 2 is handled — v1 payloads never lived under the legacy
 * origin-global key this reads (see readAndClearLegacyPersonCache), and a v3
 * (or later) payload has nothing left to migrate.
 */
export function migratePersonCacheToV3(raw: string | null): { person: ConfigOverlay; droppedMachineSections: string[] } {
	const empty = { person: {}, droppedMachineSections: [] };
	if (raw === null) return empty;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return empty;
	}
	if (!isPlainObject(parsed) || parsed.version !== 2 || !isPlainObject(parsed.overlay)) return empty;
	const { person } = splitOverlay(parseOverlay(parsed.overlay));
	return { person, droppedMachineSections: overlaySectionNames(parsed.overlay) };
}

/**
 * Split each PRE-v3 snapshot's overlay the same way migratePersonCacheToV3
 * splits the live overlay (Ruling 17): person half kept, machine half
 * returned separately for the caller to keep or drop. v2 snapshots carry no
 * `id` (revert addressed them by array index only) — one is minted here, the
 * join key config/store.ts uses to reunite a migrated person half with its
 * machine half on whichever machine the caller decides to attribute it to.
 *
 * No attribution decision is made HERE: a legacy snapshot's machine half
 * proves no more about its origin than the live overlay's did, so "keep or
 * drop" depends on whether the CALLER currently knows a machine — knowledge
 * this module has no way to have.
 */
export function migrateLegacySnapshots(raw: unknown): {
	id: string;
	takenAt: number;
	label: string;
	person: DeepPartial<PersonConfig>;
	machine: DeepPartial<MachineConfig>;
}[] {
	if (!Array.isArray(raw)) return [];
	const out: ReturnType<typeof migrateLegacySnapshots> = [];
	for (const entry of raw) {
		if (!isPlainObject(entry) || typeof entry.takenAt !== "number" || typeof entry.label !== "string") continue;
		const { machine, person } = splitOverlay(parseOverlay(isPlainObject(entry.overlay) ? entry.overlay : {}));
		out.push({ id: mintLegacySnapshotId(), takenAt: entry.takenAt, label: entry.label, person, machine });
	}
	return out;
}

function mintLegacySnapshotId(): string {
	return `ls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const LEGACY_PERSON_CACHE_KEY = "dwc-ng.config";

/**
 * Read (and immediately remove) the pre-split localStorage cache — the ONLY
 * place this repo may spell "dwc-ng.config" (see this module's own
 * invariant). Removing it on read, rather than leaving that to the caller
 * once migration "succeeds", is what keeps a partial run harmless: the very
 * next boot finds nothing here no matter what happens after this call
 * returns, so the transform can never run twice against the same bytes.
 * config/store.ts persists whatever this produces before doing anything
 * else, which is what makes the remaining risk — an engine crash in the
 * handful of synchronous statements between this call and that write —
 * the only way to lose it.
 */
export function readAndClearLegacyPersonCache(): string | null {
	if (typeof localStorage === "undefined") return null;
	const raw = localStorage.getItem(LEGACY_PERSON_CACHE_KEY);
	if (raw !== null) localStorage.removeItem(LEGACY_PERSON_CACHE_KEY);
	return raw;
}

/**
 * Stamp a machine overlay with the machine it was written FROM. The SOLE
 * producer, so a stamp's shape ({ machineId, overlay }) is spelled in
 * exactly one place — readStampedMachineOverlay is the only consumer, and a
 * hand-built object literal at a third site would have to know this exact
 * shape to pass as one, which is what makes forging a stamp at least
 * effortful rather than free.
 */
export function stampMachineOverlay(
	overlay: DeepPartial<MachineConfig>,
	id: IdentifiedMachine,
): { machineId: string; overlay: DeepPartial<MachineConfig> } {
	return { machineId: machineKeySegment(id), overlay };
}

/**
 * Read a (possibly stamped) machine overlay back, checking the stamp against
 * the CURRENTLY connected machine before trusting a single byte of it.
 *
 * `claimed: true` means "bytes exist but are not in effect" — an SD card
 * moved to a different board, or a v3 payload old enough (or corrupt enough)
 * to carry no stamp at all (absence of proof is not proof: treated
 * identically to a mismatch, never adopted). Only a stamp that names THIS
 * machine returns its overlay; every other CLAIMED outcome returns `{}`, so
 * a caller that forgets to check `claimed` still gets nothing rather than a
 * silent wrong-machine value.
 *
 * `version` is the top-level payload's `CONFIG_VERSION` field, supplied by
 * the caller rather than read off `raw` itself: a pre-v3 machine half (spec
 * §4's `stampMachineOverlay` shape) never carried a sibling version field —
 * versioning lives on the OUTER `{version, machineId, overlay}` envelope,
 * not on this inner shape — so there is nothing here to infer it from.
 *
 * `migrated: true` (version !== CONFIG_VERSION) is spec §3's one-time
 * amnesty, and the THIRD, distinct outcome this function can report: a
 * pre-v3 file never had a stamp to check in the first place, and per spec
 * §4 that is not evidence AGAINST it — reading it back over a live
 * connection to THIS board is itself proof of origin ("split the v2
 * overlay, stamp the machine half with the currently connected MachineId,
 * write v3 back"). So it is adopted, exactly like a matched v3 stamp, never
 * quarantined as `claimed` the way a missing v3 stamp is — the two "no
 * machineId field" cases look identical byte-for-byte and only `version`
 * tells them apart.
 */
export function readStampedMachineOverlay(
	raw: unknown,
	id: IdentifiedMachine,
	version: number,
): { overlay: DeepPartial<MachineConfig>; claimed: boolean; writtenFor: string | null; migrated: boolean } {
	if (!isPlainObject(raw) || !isPlainObject(raw.overlay)) {
		return { overlay: {}, claimed: true, writtenFor: null, migrated: false };
	}
	if (version !== CONFIG_VERSION) {
		return { overlay: splitOverlay(parseOverlay(raw.overlay)).machine, claimed: false, writtenFor: null, migrated: true };
	}
	const writtenFor = typeof raw.machineId === "string" ? raw.machineId : null;
	if (writtenFor === null || writtenFor !== machineKeySegment(id)) {
		return { overlay: {}, claimed: true, writtenFor, migrated: false };
	}
	return { overlay: splitOverlay(parseOverlay(raw.overlay)).machine, claimed: false, writtenFor, migrated: false };
}
