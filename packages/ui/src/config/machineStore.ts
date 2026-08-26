/**
 * Machine-scoped localStorage. A handle exists only for an IDENTIFIED machine,
 * which is what makes the hazard unrepresentable: before identity resolves
 * there is no object to read or write through, so "we forgot to wait for the
 * id" is not a mistake a caller can make — there is nothing to call.
 *
 * @invariant machine-scoped-storage
 * @rung 6  choke-point — openMachineStore is the only producer of a
 *          MachineStore, its argument type admits no unidentified machine, and
 *          MachineKeyName is a closed union so a new machine-scoped key cannot
 *          be introduced without appearing here. Task 4 adds a lint that fails
 *          the suite if a machine-scoped key literal appears anywhere else in
 *          src/, which is what makes this the ONLY door rather than merely a
 *          convenient one.
 * @why this is the entire safety case for #76 phase 1. dwc-ng.config was
 *      origin-global: point the browser at a second Duet and it read the first
 *      machine's envelope — the box the head is driven inside — with nothing
 *      in the app in a position to doubt it
 * @debt the lint added in Task 4 is a test, and a test is not a construction.
 *       The promotion is a branded MachineKey type produced only here that
 *       localStorage access is typed against; that needs a storage facade the
 *       person-scoped keys also go through, which is out of phase 1's scope.
 */
import { machineKeySegment, type IdentifiedMachine } from "./machineId.ts";

export const MACHINE_KEY_PREFIX = "dwc-ng.m.";

/**
 * Every machine-scoped value in the app. Closed on purpose: adding a name is a
 * decision about scope, and it should have to be made here, in front of the
 * spec's key table, rather than by typing a new string at a call site.
 */
export type MachineKeyName = "config" | "drafts" | "cmdHistory" | "console" | "canvas";

export interface MachineStore {
	readonly id: IdentifiedMachine;
	get(name: MachineKeyName, suffix?: string): string | null;
	set(name: MachineKeyName, value: string, suffix?: string): void;
	remove(name: MachineKeyName, suffix?: string): void;
}

/** Dots delimit the key's levels, so a suffix from user config may not contain one. */
const safeSuffix = (s: string): string => s.replace(/[.\s]/g, "-");

export function openMachineStore(id: IdentifiedMachine): MachineStore {
	const base = `${MACHINE_KEY_PREFIX}${machineKeySegment(id)}`;
	const keyFor = (name: MachineKeyName, suffix?: string): string =>
		suffix === undefined ? `${base}.${name}` : `${base}.${name}.${safeSuffix(suffix)}`;
	const ls = (): Storage | null => (typeof localStorage === "undefined" ? null : localStorage);
	return {
		id,
		get: (name, suffix) => ls()?.getItem(keyFor(name, suffix)) ?? null,
		set: (name, value, suffix) => ls()?.setItem(keyFor(name, suffix), value),
		remove: (name, suffix) => ls()?.removeItem(keyFor(name, suffix)),
	};
}
