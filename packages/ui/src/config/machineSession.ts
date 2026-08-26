/**
 * Identity arrives about one poll after boot: PollConnector fetches every seqs
 * key at full sync (packages/connector/src/PollConnector.ts:190-204), boards
 * and network among them. Until it does, `store()` is null and every
 * machine-scoped consumer has nothing to read — which is the correct, stated
 * cost (spec §3): a refusal that clears in about a second, rather than an
 * envelope belonging to a different machine.
 */
import { createMemo, type Accessor } from "solid-js";
import type { ObjectModel } from "../om/types.ts";
import { resolveMachineId, type MachineId } from "./machineId.ts";
import { machineStoreFor, type MachineStore } from "./machineStore.ts";

export function createMachineSession(om: ObjectModel): {
	readonly id: Accessor<MachineId>;
	readonly store: Accessor<MachineStore | null>;
} {
	// Property reads inside the memo, so the store proxy tracks them.
	const id = createMemo(
		() => resolveMachineId({ boards: om.boards, network: om.network }),
		undefined,
		{ equals: (a: MachineId, b: MachineId) => a.kind === b.kind && keyOf(a) === keyOf(b) },
	);
	// Keyed off the memo, so a poll that changes mcuTemp does not mint a new
	// handle and re-run every consumer's hydrate effect.
	const store = createMemo<MachineStore | null>(() => machineStoreFor(id()));
	return { id, store };
}

const keyOf = (id: MachineId): string =>
	id.kind === "board" ? id.uniqueId : id.kind === "mac" ? id.mac : id.why;
