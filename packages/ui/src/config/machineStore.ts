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
import { isIdentified, machineKeySegment, type IdentifiedMachine, type MachineId } from "./machineId.ts";

export const MACHINE_KEY_PREFIX = "dwc-ng.m.";

/**
 * Every machine-scoped value in the app. Closed on purpose: adding a name is a
 * decision about scope, and it should have to be made here, in front of the
 * spec's key table, rather than by typing a new string at a call site.
 *
 * `canvasParked` / `canvasOrientation` / `canvasLabels` are the canvas's own
 * derived siblings (Task 10) — a hidden card's remembered spot, a screen's
 * per-card content direction, and which cards have their label column
 * hidden. Each is suffixed by the same screen id as `canvas` itself, so they
 * are four independent records per screen rather than one record encoding
 * four meanings in its suffix string — deliberately, since a suffix is
 * escaped as ONE opaque value (see safeSuffix below): concatenating a
 * screen id with a hand-rolled marker (e.g. `${screenId}.parked`) would
 * reintroduce, one level up, the exact ambiguity safeSuffix exists to rule
 * out for the screen id itself (a screen id ending in ".parked" would land
 * on the same key as a different screen's parked record).
 */
export type MachineKeyName =
	| "config" | "drafts" | "cmdHistory" | "console" | "canvas"
	| "canvasParked" | "canvasOrientation" | "canvasLabels" | "snapshots";

export interface MachineStore {
	readonly id: IdentifiedMachine;
	get(name: MachineKeyName, suffix?: string): string | null;
	set(name: MachineKeyName, value: string, suffix?: string): void;
	remove(name: MachineKeyName, suffix?: string): void;
}

/**
 * Dots delimit the key's levels, so a suffix from user config may not contain
 * one unescaped. Fixed-width hex escaping (`-XXXX`, the char's UTF-16 code
 * unit) rather than a bare substitution: substituting "." and "-" both to "-"
 * is NOT injective — "a.b" and "a-b" collide on "a-b", and escaping "-" to
 * "--" before the substitution still collides one level deeper ("a--b" and
 * "a.-.b" both land on "a----b", since the escape char and the substitution
 * target are the same character). Every "-" in the output is provably the
 * start of a 5-char escape sequence (never a leftover literal), which is what
 * makes decoding unambiguous and therefore the encoding injective: distinct
 * suffixes cannot land on the same key.
 */
const safeSuffix = (s: string): string =>
	s.replace(/[-.\s]/g, c => `-${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

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

/**
 * `openMachineStore`, gated on whether there is anyone to open it for.
 * Everywhere a consumer holds a `MachineId` (a screen, a card, the console)
 * rather than the `Accessor<MachineStore | null>` App.tsx builds once, this
 * is how it gets a handle — the SAME choke point, not a second one: it never
 * resolves identity itself, only turns an already-resolved one into a store.
 * `machineSession.ts`'s own `store` memo calls this too, so the
 * identified-or-null branch is written once rather than at every call site.
 */
export function machineStoreFor(id: MachineId): MachineStore | null {
	return isIdentified(id) ? openMachineStore(id) : null;
}
