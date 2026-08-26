/**
 * Which machine is this? Every machine-scoped byte is keyed by the answer, so
 * a wrong answer attaches one machine's motion envelope to another (spec §3).
 *
 * @invariant machine-identity-single-resolution
 * @rung 6  choke-point — resolveMachineId is the ONLY function that decides
 *          identity, and machineKeySegment is the only way to turn one into a
 *          storage key. The key format is not spelled anywhere else, so a
 *          second scheme has nowhere to come from
 * @why identity resolved twice is identity resolved two ways: a caller that
 *      reached for boards[0].uniqueId instead of the main board would key the
 *      machine to a toolboard, and swapping that toolboard would silently
 *      present a different machine's settings
 * @debt IdentifiedMachine is a discriminated union, not a branded type, so a
 *       caller can still hand-write { kind: "mac", mac: "" }. Promote by
 *       making the segment a branded string only this module can mint and
 *       having MachineStore accept only that.
 */
import type { Board, NetworkInterface, ObjectModel } from "../om/types.ts";

export type MachineId =
	| { readonly kind: "board"; readonly uniqueId: string }
	| { readonly kind: "mac"; readonly mac: string }
	| { readonly kind: "unidentified"; readonly why: string };

/** An id something can actually be stored under. */
export type IdentifiedMachine = Extract<MachineId, { kind: "board" } | { kind: "mac" }>;

export const isIdentified = (id: MachineId): id is IdentifiedMachine => id.kind !== "unidentified";

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The main board is canAddress 0 or absent (om/types.ts:237-239) — NOT
 * boards[0]. On a toolchanger the array carries five other boards, each with
 * its own uniqueId, and keying to one of those means a swapped toolboard reads
 * as a different machine.
 */
const mainBoard = (boards: readonly (Board | null)[]): Board | undefined =>
	boards.find((b): b is Board => b !== null && typeof b === "object" && (b.canAddress ?? 0) === 0);

export function resolveMachineId(om: Pick<ObjectModel, "boards" | "network">): MachineId {
	// `?? []` here and on `ifaces` below are NOT defensive padding against a
	// state ObjectModel's non-optional array types already forbid — they are
	// live enforcement. `conformModelKey` (om/types.ts) gates a full-subtree
	// replacement, but `onModelPatch` (om/store.ts's every-tick d99fn live
	// projection) deep-merges the board's raw JSON straight into the store
	// with NO gate at all, so `om.boards` reaching this function as `undefined`
	// or a sparse/malformed array is a real, reachable input, not a type-system
	// impossibility. This function IS part of the real enforcement for machine
	// identity, not a caller downstream of one.
	const board = mainBoard(om.boards ?? []);
	const uniqueId = (board as { uniqueId?: unknown } | undefined)?.uniqueId;
	if (nonEmpty(uniqueId)) return { kind: "board", uniqueId };

	// Gabe, 2026-08-25: the MAC of the first interface that has one. "First
	// found" is first CARRYING a mac — the field is nullable and the real
	// board's wifi radio is disabled with a mac while ethernet may have none.
	// Same reasoning as `om.boards` above: `om.network?.interfaces` reaching
	// here as `undefined` is a real input via the onModelPatch bypass, not a
	// theoretical one this `?? []` merely guards against out of caution.
	const ifaces = (om.network?.interfaces ?? []) as readonly (NetworkInterface | null)[];
	for (const iface of ifaces) {
		if (iface !== null && nonEmpty(iface.mac)) return { kind: "mac", mac: iface.mac };
	}

	return { kind: "unidentified", why: "no board uniqueId and no network interface MAC" };
}

/**
 * The storage-key segment. Kind-prefixed so a uniqueId that happens to look
 * like a normalised MAC cannot land on the same key, and dot-free so a value
 * from the wire cannot forge an extra level in the dot-delimited key format.
 */
export function machineKeySegment(id: IdentifiedMachine): string {
	return id.kind === "board"
		? `b.${id.uniqueId.replace(/[.\s]/g, "-")}`
		: `m.${id.mac.toLowerCase().replace(/[^0-9a-f]/g, "")}`;
}

export function describeMachineId(id: MachineId): string {
	switch (id.kind) {
		case "board": return `board ${id.uniqueId}`;
		case "mac": return `MAC ${id.mac} (this board reports no uniqueId)`;
		case "unidentified": return `not identified — ${id.why}`;
	}
}
