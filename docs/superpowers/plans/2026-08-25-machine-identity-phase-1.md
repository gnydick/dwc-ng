# Machine Identity and the Machine/Person Split — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible for a browser pointed at a second Duet to read the first Duet's machine settings — above all its motion envelope — by giving the app a machine identity and keying every machine-scoped byte to it.

**Architecture:** Identity is resolved from the object model (`boards[main].uniqueId`, else the first `network.interfaces[].mac` that has one, else `unidentified`). Every machine-scoped localStorage value moves behind a single `MachineStore` handle that can only be minted from an *identified* machine, so "no identity yet" is not a case a caller can forget — there is simply no handle to read through. `UiConfig` splits into a machine half and a person half; the person half still boots from cache, the machine half hydrates only once identity lands.

**Tech Stack:** SolidJS + TypeScript (strict), `node:test`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-machine-profile-design.md` — read §3 (identity), §4 (the split and the migration) and §7 (phasing) before Task 1. This plan implements phase 1 of that table and nothing else.

## Global Constraints

- **No new dependencies.** CLAUDE.md dependency policy; nothing here needs one.
- **Typecheck is `cd packages/ui && ./node_modules/.bin/tsc -b --force`.** `npx tsc` and `pnpm exec tsc` both fail in this repo (memory: `typecheck-command-gotcha`).
- **Tests are `cd packages/ui && pnpm test`** (`node --conditions=browser --test "test/*.test.ts"`). Tests use tabs, `node:test`, `assert/strict`, and import source with an explicit `.ts` extension.
- **Falsification is mandatory before any task is called done:** revert the implementation (not the test), confirm the new test goes RED, restore, confirm GREEN. A test that cannot fail has proved nothing (memory: `verify-before-touching-hardware`).
- **Solid rules:** never destructure props; `<Show>`/`<For>` not early returns or `.map` in JSX; store reads inside tracking scopes only. `Object.hasOwn` on a store proxy is **not reactive** — use a property read or `in` (memory: `solid-hasown-not-reactive`).
- **Eager-payload budget is enforced at `pnpm ship`, not `pnpm build`,** with roughly 2 KB of headroom. Read `packages/deploy/eager-budget.json`'s note before even thinking about raising it. Everything in this plan is on the boot path and therefore eager — Task 12 measures it.
- **Reference source is read-only.** Never copy from `reference/`; cite it by file:line.
- **Every commit message carries the marker `GIT_<issue>`** for the ticket pair this plan runs under (see "Ticket pair" below).
- **All lengths in any CSS added here use `calc(n * var(--u))`; borders are inset box-shadow, never `border:`.** `test/unit-lengths.test.ts` fails the suite otherwise.

## Ticket pair

This plan runs under its ticket pair #84 (parent) / #85 (Context) against campaign #76, per `docs/github-issue-rules.md`: a full engineer-stranger parent plus one `Context: #N` child, both labelled `GIT_86`, and both added as "added" tickets on #76 / #77 respectively. The pair exists; use `GIT_86` as the commit marker.

---

### Task 1: Type and conform `network`, so identity does not rest on an ungated subtree

`network` is not in `KnownModel` (`packages/ui/src/om/types.ts:361-370`). It reaches the store through the open `Record<string, unknown>` arm, meaning nothing checks its shape. Identity is about to be read out of it, and a shape gate that does not cover the field identity depends on is not a gate.

**Files:**
- Modify: `packages/ui/src/om/types.ts` (add `NetworkInterface` + `Network` interfaces near `Board` at :229-250; add `network` to `KnownModel` :361-370; add to `emptyModel()` :375-395; add a `case "network"` to `conformModelKey` :528)
- Test: `packages/ui/test/om-conform.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface NetworkInterface { readonly mac: string | null; readonly type?: string; readonly state?: string | null; readonly actualIP?: string | null }`, `export interface Network { readonly interfaces: (NetworkInterface | null)[]; readonly hostname?: string; readonly name?: string }`, and `KnownModel["network"]: Network`. Task 2 reads `om.network.interfaces`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/test/om-conform.test.ts`:

```ts
test("network is gated: interfaces is always an array, entries are objects or null", () => {
	// The real capture's shape (duet3-real-2026-07-15/model/verbose-network.json).
	const ok = conformModelKey("network", {
		hostname: "duet3",
		name: "Duet 3",
		interfaces: [{ mac: "2C:CF:67:CF:F5:50", type: "ethernet", state: "active" }],
	});
	assert.equal(ok.ok, true);
	assert.deepEqual((ok as { value: { interfaces: unknown[] } }).value.interfaces, [
		{ mac: "2C:CF:67:CF:F5:50", type: "ethernet", state: "active" },
	]);

	// A board that serves network WITHOUT interfaces must not be rejected —
	// conform, don't refuse (the layerStats lesson). It gets an empty list.
	const sparse = conformModelKey("network", { hostname: "duet3" });
	assert.equal(sparse.ok, true);
	assert.deepEqual((sparse as { value: { interfaces: unknown[] } }).value.interfaces, []);

	// interfaces present but not an array is the shape identity would trip on.
	const bad = conformModelKey("network", { interfaces: { 0: { mac: "x" } } });
	assert.deepEqual((bad as { value: { interfaces: unknown[] } }).value.interfaces, []);

	// A non-object network key is unusable: reject, keep the last good subtree.
	assert.deepEqual(conformModelKey("network", "garbage"), { ok: false });
});

test("a non-object interface entry becomes null, never a string read for .mac", () => {
	const out = conformModelKey("network", { interfaces: ["nope", { mac: null }] });
	assert.deepEqual((out as { value: { interfaces: unknown[] } }).value.interfaces, [null, { mac: null }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | grep -A5 "network is gated"`
Expected: FAIL — `conformModelKey("network", …)` currently falls through to the default arm and returns the value untouched, so `interfaces` is not filled in and the `"garbage"` case is not rejected.

- [ ] **Step 3: Write minimal implementation**

In `packages/ui/src/om/types.ts`, after the `Board` interface (:250):

```ts
/** reference/objectmodel/src/network/NetworkInterface.ts */
export interface NetworkInterface {
	/**
	 * null on an interface that has none — the vendored type declares it
	 * `string | null` (reference/objectmodel/src/network/NetworkInterface.ts:38),
	 * and the real board serves a disabled wifi radio alongside the ethernet.
	 * Machine identity's MAC fallback must therefore look for the first
	 * interface CARRYING one, never interfaces[0].
	 */
	readonly mac: string | null;
	readonly type?: string;
	readonly state?: string | null;
	readonly actualIP?: string | null;
}

/** reference/objectmodel/src/network/Network.ts */
export interface Network {
	readonly interfaces: (NetworkInterface | null)[];
	/** M550 — an operator renames this. Display, never a key. */
	readonly hostname?: string;
	readonly name?: string;
}
```

Add to `KnownModel`:

```ts
	network: Network;
```

Add to `emptyModel()`'s returned object:

```ts
		network: { interfaces: [] },
```

Add a case to `conformModelKey`, alongside the `boards` case (:525-528):

```ts
		// network is gated for one reason: machine IDENTITY is read out of it
		// (config/machineId.ts). An ungated subtree cannot carry a key.
		case "network": {
			if (!isObject(value)) return { ok: false };
			return { ok: true, value: {
				...value,
				interfaces: arrayOr(value.interfaces, []).map(e => (isObject(e) ? e : null)),
			} };
		}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && pnpm test`
Expected: PASS, whole suite green (the count rises by 2 from the current baseline).

- [ ] **Step 5: Falsify**

Comment out the `case "network"` block, re-run, confirm RED with the `interfaces` assertions failing. Restore, confirm GREEN.

- [ ] **Step 6: Typecheck and commit**

```bash
cd packages/ui && ./node_modules/.bin/tsc -b --force
cd ../.. && git add packages/ui/src/om/types.ts packages/ui/test/om-conform.test.ts
git commit -m "feat(om): network is a gated key, because identity is read out of it GIT_86"
```

---

### Task 2: Resolve the machine id

**Files:**
- Create: `packages/ui/src/config/machineId.ts`
- Test: `packages/ui/test/machine-id.test.ts`

**Interfaces:**
- Consumes: `Network`, `Board`, `ObjectModel` from Task 1 / `om/types.ts`.
- Produces:
  - `export type MachineId = { readonly kind: "board"; readonly uniqueId: string } | { readonly kind: "mac"; readonly mac: string } | { readonly kind: "unidentified"; readonly why: string }`
  - `export type IdentifiedMachine = Extract<MachineId, { kind: "board" } | { kind: "mac" }>`
  - `export function resolveMachineId(om: Pick<ObjectModel, "boards" | "network">): MachineId`
  - `export function isIdentified(id: MachineId): id is IdentifiedMachine`
  - `export function machineKeySegment(id: IdentifiedMachine): string`
  - `export function describeMachineId(id: MachineId): string`

Task 3 takes `IdentifiedMachine`; Task 11's card calls `describeMachineId`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/machine-id.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../src/config/machineId.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ui/src/config/machineId.ts`:

```ts
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
 * The main board is canAddress 0 or absent (om/types.ts:236-238) — NOT
 * boards[0]. On a toolchanger the array carries five other boards, each with
 * its own uniqueId, and keying to one of those means a swapped toolboard reads
 * as a different machine.
 */
const mainBoard = (boards: readonly (Board | null)[]): Board | undefined =>
	boards.find((b): b is Board => b !== null && typeof b === "object" && (b.canAddress ?? 0) === 0);

export function resolveMachineId(om: Pick<ObjectModel, "boards" | "network">): MachineId {
	const board = mainBoard(om.boards ?? []);
	const uniqueId = (board as { uniqueId?: unknown } | undefined)?.uniqueId;
	if (nonEmpty(uniqueId)) return { kind: "board", uniqueId };

	// Gabe, 2026-08-25: the MAC of the first interface that has one. "First
	// found" is first CARRYING a mac — the field is nullable and the real
	// board's wifi radio is disabled with a mac while ethernet may have none.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && pnpm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Falsify the two load-bearing cases**

Change `mainBoard` to `boards[0]` — the toolboard-ordering test must go RED. Restore. Change the MAC loop to `ifaces[0]?.mac` — the "first interface that HAS a mac" test must go RED. Restore. Confirm GREEN. Both of these are the actual hazard; a green suite that survives either edit is not testing identity.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config/machineId.ts packages/ui/test/machine-id.test.ts
git commit -m "feat(config): resolve a machine id, uniqueId then first MAC GIT_86"
```

---

### Task 3: `MachineStore` — the one door machine-scoped bytes go through

**Files:**
- Create: `packages/ui/src/config/machineStore.ts`
- Test: `packages/ui/test/machine-store.test.ts`

**Interfaces:**
- Consumes: `IdentifiedMachine`, `machineKeySegment` (Task 2).
- Produces:
  - `export type MachineKeyName = "config" | "drafts" | "cmdHistory" | "console" | "canvas"`
  - `export interface MachineStore { readonly id: IdentifiedMachine; get(name: MachineKeyName, suffix?: string): string | null; set(name: MachineKeyName, value: string, suffix?: string): void; remove(name: MachineKeyName, suffix?: string): void }`
  - `export function openMachineStore(id: IdentifiedMachine): MachineStore`
  - `export const MACHINE_KEY_PREFIX = "dwc-ng.m."`

Tasks 5, 7, 8 and 10 consume `MachineStore`. Nothing else may build a machine key.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/machine-store.test.ts`:

```ts
/**
 * The single door for machine-scoped localStorage. The property under test is
 * negative and is the whole point of phase 1: bytes written for machine A are
 * not reachable while connected to machine B.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openMachineStore, MACHINE_KEY_PREFIX } from "../src/config/machineStore.ts";
import type { IdentifiedMachine } from "../src/config/machineId.ts";

const A: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-A" };
const B: IdentifiedMachine = { kind: "board", uniqueId: "MACHINE-B" };

function withLocalStorage(run: () => void): void {
	const backing = new Map<string, string>();
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	g.localStorage = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => void backing.set(k, v),
		removeItem: (k: string) => void backing.delete(k),
		get length() { return backing.size; },
		key: (i: number) => [...backing.keys()][i] ?? null,
	};
	try { run(); } finally { g.localStorage = prior; }
}

test("what machine A wrote, machine B cannot read", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("config", '{"envelope":"A"}');
		assert.equal(openMachineStore(B).get("config"), null);
		assert.equal(openMachineStore(A).get("config"), '{"envelope":"A"}');
	});
});

test("keys carry the machine segment and the prefix", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("config", "x");
		const keys = [...Array(localStorage.length).keys()].map(i => localStorage.key(i)!);
		assert.equal(keys.length, 1);
		assert.ok(keys[0].startsWith(MACHINE_KEY_PREFIX), keys[0]);
		assert.ok(keys[0].includes("MACHINE-A"), keys[0]);
		assert.ok(keys[0].endsWith(".config"), keys[0]);
	});
});

test("a suffix scopes per-screen values without escaping the machine", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("canvas", "layoutA", "machine");
		assert.equal(openMachineStore(A).get("canvas", "machine"), "layoutA");
		assert.equal(openMachineStore(A).get("canvas", "control"), null);
		assert.equal(openMachineStore(B).get("canvas", "machine"), null);
	});
});

test("a suffix cannot climb out of its level", () => {
	// A screen id reaches this from user config; a dotted one must not be able
	// to address another key name.
	withLocalStorage(() => {
		const s = openMachineStore(A);
		s.set("canvas", "sneaky", "x.config");
		assert.equal(s.get("config"), null, "a dotted suffix must not land on the config key");
	});
});

test("remove clears only that machine's value", () => {
	withLocalStorage(() => {
		openMachineStore(A).set("console", "a");
		openMachineStore(B).set("console", "b");
		openMachineStore(A).remove("console");
		assert.equal(openMachineStore(A).get("console"), null);
		assert.equal(openMachineStore(B).get("console"), "b");
	});
});

test("no localStorage (SSR, a locked-down browser) is not a crash", () => {
	const g = globalThis as { localStorage?: unknown };
	const prior = g.localStorage;
	delete g.localStorage;
	try {
		const s = openMachineStore(A);
		assert.equal(s.get("config"), null);
		s.set("config", "x");
		s.remove("config");
	} finally { g.localStorage = prior; }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ui/src/config/machineStore.ts`:

```ts
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
 *          be introduced without appearing here. test/storage-keys.test.ts
 *          fails the suite if a machine-scoped key literal appears anywhere
 *          else in src/
 * @why this is the entire safety case for #76 phase 1. dwc-ng.config was
 *      origin-global: point the browser at a second Duet and it read the first
 *      machine's envelope — the box the head is driven inside — with nothing
 *      in the app in a position to doubt it
 * @debt the lint in step 4 is a test, and a test is not a construction. The
 *       promotion is a branded MachineKey type produced only here that
 *       localStorage access is typed against; that needs a storage facade the
 *       person-scoped keys also go through, which is out of phase 1's scope.
 */
import { machineKeySegment, type IdentifiedMachine } from "./machineId.ts";

export const MACHINE_KEY_PREFIX = "dwc-ng.m.";

/**
 * Every machine-scoped value in the app. Closed on purpose: adding a name is a
 * decision about scope, and it should have to be made here, in front of the
 * spec §4 table, rather than by typing a new string at a call site.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && pnpm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Falsify**

Drop the machine segment from `base` (make it `` `${MACHINE_KEY_PREFIX}shared` ``). The "what machine A wrote, machine B cannot read" test must go RED — that assertion IS the safety case. Restore, confirm GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config/machineStore.ts packages/ui/test/machine-store.test.ts
git commit -m "feat(config): machine-scoped storage exists only for an identified machine GIT_86"
```

---

### Task 4: The lint that keeps the door the only door

A choke-point that anything can route around is not a choke-point. This is the same enforcement shape as `test/unit-lengths.test.ts` (the px lint), and it is what lets Task 3's `@rung 6` claim stand.

**Files:**
- Create: `packages/ui/test/storage-keys.test.ts`

**Interfaces:**
- Consumes: nothing at runtime; reads `packages/ui/src` off disk.
- Produces: nothing importable. It fails `pnpm test` when violated.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/storage-keys.test.ts`:

```ts
/**
 * Machine-scoped storage has exactly one door (config/machineStore.ts). This
 * lint is what stops a future module from opening a second one — a
 * localStorage key literal for machine-scoped state anywhere else means a
 * value that a second Duet would inherit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

/** Names spec §4 puts on the machine side. Person keys are unrestricted. */
const MACHINE_SCOPED = ["dwc-ng.config", "dwc-ng.drafts", "dwc-ng.cmdHistory", "dwc-ng.console", "dwc-ng.canvas."];

/** The door itself, plus the migration that must name the old keys to retire them. */
const ALLOWED = ["config/machineStore.ts", "config/migrateStorage.ts"];

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.tsx?$/.test(entry)) out.push(full);
	}
	return out;
}

test("no machine-scoped storage key literal lives outside config/machineStore.ts", () => {
	const offenders: string[] = [];
	for (const file of walk(SRC)) {
		const rel = file.slice(SRC.length).replace(/\\/g, "/");
		if (ALLOWED.some(a => rel.endsWith(a))) continue;
		const text = readFileSync(file, "utf8");
		for (const key of MACHINE_SCOPED) {
			if (text.includes(`"${key}`)) offenders.push(`${rel}: ${key}`);
		}
	}
	assert.deepEqual(offenders, [], `machine-scoped keys must go through openMachineStore():\n${offenders.join("\n")}`);
});

test("the lint can actually see a violation", () => {
	// Falsification, in the suite: the matcher above is exercised against a
	// known-bad string so a broken walk() cannot pass by finding nothing.
	const text = 'const k = "dwc-ng.console";';
	assert.ok(MACHINE_SCOPED.some(key => text.includes(`"${key}`)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | grep -A12 "no machine-scoped storage key"`
Expected: FAIL, listing the current offenders — `config/types.ts` (`dwc-ng.config`), `editor/drafts.ts`, `om/commandHistory.ts`, `om/consoleLog.ts`, `shell/panelCanvas.ts`. **This failing list is the work-list for Tasks 7 and 10.** Record it in the commit message.

- [ ] **Step 3: Make it pass the only legitimate way — do not**

The lint stays RED until Task 10. Commit it RED-but-skipped: mark both tests with `{ skip: "unskipped in Task 10 once every key has moved" }` so the suite stays green between tasks, and put the offender list in the skip reason.

```ts
test("no machine-scoped storage key literal lives outside config/machineStore.ts", { skip: "Task 10 moves the last key; offenders: config/types.ts, editor/drafts.ts, om/commandHistory.ts, om/consoleLog.ts, shell/panelCanvas.ts" }, () => {
```

- [ ] **Step 4: Run the suite**

Run: `cd packages/ui && pnpm test 2>&1 | tail -5`
Expected: PASS with 1 skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/test/storage-keys.test.ts
git commit -m "test(config): lint that machine-scoped keys have one door (skipped until GIT_86 task 10) GIT_86"
```

---

### Task 5: The machine session — identity as it arrives, not as it is assumed

Identity is not known at boot. It lands when `onModelKey("boards")` / `("network")` arrive at full sync (`packages/connector/src/PollConnector.ts:190-204`). This task publishes that transition once, reactively, so every consumer waits the same way.

**Files:**
- Create: `packages/ui/src/config/machineSession.ts`
- Test: `packages/ui/test/machine-session.test.ts`

**Interfaces:**
- Consumes: `resolveMachineId`, `isIdentified`, `MachineId` (Task 2); `openMachineStore`, `MachineStore` (Task 3); the OM store's `om` from `om/store.ts`.
- Produces:
  - `export function createMachineSession(om: ObjectModel): { readonly id: Accessor<MachineId>; readonly store: Accessor<MachineStore | null> }`

Tasks 7, 10 and 11 read these accessors.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/machine-session.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
import { createMachineSession } from "../src/config/machineSession.ts";
import { createOmStore } from "../src/om/store.ts";

test("before boards land, there is no store to write through", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		assert.equal(session.id().kind, "unidentified");
		assert.equal(session.store(), null, "no handle means no machine-scoped read is even expressible");
		dispose();
	});
});

test("identity appears when the boards key lands, and the store follows", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null }]);
		assert.deepEqual(session.id(), { kind: "board", uniqueId: "LIVE-1" });
		assert.equal(session.store()?.id.kind, "board");
		dispose();
	});
});

test("the MAC fallback lands from the network key alone", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, accelerometer: null }]);
		assert.equal(session.id().kind, "unidentified");
		om.events.onModelKey?.("network", { interfaces: [{ mac: "2C:CF:67:CF:F5:50" }] });
		assert.deepEqual(session.id(), { kind: "mac", mac: "2C:CF:67:CF:F5:50" });
		dispose();
	});
});

test("the store handle is stable while the id is unchanged", () => {
	// Consumers key effects off it; a new object per poll would re-run every
	// hydrate and thrash the console and the layouts.
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null }]);
		const first = session.store();
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null, mcuTemp: { current: 41 } }]);
		assert.equal(session.store(), first, "same machine, same handle");
		dispose();
	});
});

test("a mainboard swap re-keys rather than carrying settings over", () => {
	createRoot(dispose => {
		const om = createOmStore();
		const session = createMachineSession(om.om);
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-1", accelerometer: null }]);
		const first = session.store();
		om.events.onModelKey?.("boards", [{ canAddress: 0, uniqueId: "LIVE-2", accelerometer: null }]);
		assert.notEqual(session.store(), first);
		assert.deepEqual(session.id(), { kind: "board", uniqueId: "LIVE-2" });
		dispose();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ui/src/config/machineSession.ts`:

```ts
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
import { isIdentified, resolveMachineId, type MachineId } from "./machineId.ts";
import { openMachineStore, type MachineStore } from "./machineStore.ts";

export function createMachineSession(om: ObjectModel): {
	readonly id: Accessor<MachineId>;
	readonly store: Accessor<MachineStore | null>;
} {
	// Property reads inside the memo, so the store proxy tracks them.
	const id = createMemo<MachineId>(
		() => resolveMachineId({ boards: om.boards, network: om.network }),
		undefined,
		{ equals: (a, b) => a.kind === b.kind && keyOf(a) === keyOf(b) },
	);
	// Keyed off the memo, so a poll that changes mcuTemp does not mint a new
	// handle and re-run every consumer's hydrate effect.
	const store = createMemo<MachineStore | null>(() => {
		const current = id();
		return isIdentified(current) ? openMachineStore(current) : null;
	});
	return { id, store };
}

const keyOf = (id: MachineId): string =>
	id.kind === "board" ? id.uniqueId : id.kind === "mac" ? id.mac : id.why;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && pnpm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Falsify**

Remove the `equals` comparator from the `id` memo. The "store handle is stable" test must go RED (a fresh `MachineId` object per poll makes a fresh handle). Restore, confirm GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config/machineSession.ts packages/ui/test/machine-session.test.ts
git commit -m "feat(config): publish machine identity as it arrives GIT_86"
```

---

### Task 6: Split `UiConfig` into a machine half and a person half

Types first, storage second (Task 7): the split has to exist before anything can be stored by half. Readers keep reading `config().axisRoles` — the merged type is unchanged for them.

**Files:**
- Modify: `packages/ui/src/config/types.ts` (`UiConfig` :240-273, `DEFAULT_CONFIG` :~285-308, `CameraConfig`)
- Modify: `packages/ui/src/config/parse.ts` (`parseOverlay` — split-aware)
- Modify: the three `camera.pinned` call sites (`grep -rn "camera.pinned" packages/ui/src`)
- Test: `packages/ui/test/config-scope.test.ts` (new), `packages/ui/test/config.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export interface MachineConfig { axisRoles; heaterColors; dockSensors; camera: { streamUrl: string }; sensorNames; bed: BedConfig; pins: PinnedCommand[]; shaping: ShapingConfig; screens: { layouts: ScreenLayouts } }`
  - `export interface PersonConfig { thermalColors; cameraPrefs: { pinned: boolean }; macros: MacrosConfig; screens: { custom; renames; hidden }; cards }`
  - `export type UiConfig = MachineConfig & PersonConfig` (readers unchanged)
  - `export const MACHINE_SECTIONS: readonly (keyof MachineConfig)[]`, `export const PERSON_SECTIONS: readonly (keyof PersonConfig)[]`
  - `export function splitOverlay(o: ConfigOverlay): { machine: DeepPartial<MachineConfig>; person: DeepPartial<PersonConfig> }`
  - `export function joinOverlay(machine, person): ConfigOverlay`

Tasks 7 and 8 use `splitOverlay`/`joinOverlay`.

**Note on `screens`.** It is the one section that spans both halves: `layouts` is machine (spec §4, open question 1 closed), `custom`/`renames`/`hidden` are person. `splitOverlay` handles it explicitly rather than by whole-section assignment — the split is per leaf there, and Step 1's test pins exactly that.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/config-scope.test.ts`:

```ts
/**
 * The machine/person split (spec §4). The rule that decides every row: if the
 * KEY SPACE belongs to the machine, the section belongs to the machine. A
 * colour keyed by heater index is a fact about which heater.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitOverlay, joinOverlay, MACHINE_SECTIONS, PERSON_SECTIONS } from "../src/config/types.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";

test("every section of the effective config is assigned to exactly one half", () => {
	const all = [...MACHINE_SECTIONS, ...PERSON_SECTIONS] as string[];
	const keys = Object.keys(DEFAULT_CONFIG).sort();
	assert.deepEqual([...all].sort(), keys, "a new section must be given a scope, not defaulted into one");
	assert.equal(new Set(all).size, all.length, "no section may be in both halves");
});

test("the safety-critical sections are machine", () => {
	for (const k of ["shaping", "dockSensors", "axisRoles", "pins", "bed", "heaterColors", "sensorNames"]) {
		assert.ok((MACHINE_SECTIONS as string[]).includes(k), `${k} must be machine-scoped`);
	}
});

test("camera is split: the URL is the machine's, the pin is a habit", () => {
	assert.ok((MACHINE_SECTIONS as string[]).includes("camera"));
	assert.ok((PERSON_SECTIONS as string[]).includes("cameraPrefs"));
});

test("splitOverlay puts screens.layouts on the machine side and the rest on the person side", () => {
	const { machine, person } = splitOverlay({
		screens: { layouts: { machine: { c1: { row: 0 } } }, hidden: ["jobs"], renames: { machine: "Mach" } },
		shaping: { envelope: { x: [0, 300], y: [0, 300] } },
		thermalColors: { hot: "#f00" },
	} as never);
	assert.deepEqual(machine.screens, { layouts: { machine: { c1: { row: 0 } } } });
	assert.deepEqual(person.screens, { hidden: ["jobs"], renames: { machine: "Mach" } });
	assert.ok(machine.shaping, "shaping is machine");
	assert.equal(person.shaping, undefined, "shaping must not appear in the person half");
	assert.ok(person.thermalColors, "thermalColors is person");
	assert.equal(machine.thermalColors, undefined);
});

test("split then join is the identity — nothing is lost across the boundary", () => {
	const overlay = {
		axisRoles: { U: "Z motor 1" },
		thermalColors: { hot: "#f00" },
		camera: { streamUrl: "http://cam/" },
		cameraPrefs: { pinned: true },
		screens: { layouts: { machine: { c1: { row: 2 } } }, hidden: ["macros"] },
		shaping: { defaults: { distMm: 100, speedMmS: 400, repeats: 3 } },
	} as never;
	const { machine, person } = splitOverlay(overlay);
	assert.deepEqual(joinOverlay(machine, person), overlay);
});

test("an empty screens half is omitted, not written as {}", () => {
	// An empty object in the overlay is not "no override" to a later merge —
	// keep the overlay meaning exactly what it meant.
	const { machine, person } = splitOverlay({ screens: { hidden: ["jobs"] } } as never);
	assert.equal(machine.screens, undefined);
	assert.deepEqual(person.screens, { hidden: ["jobs"] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | tail -20`
Expected: FAIL — `splitOverlay` / `MACHINE_SECTIONS` are not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/ui/src/config/types.ts`, restructure `UiConfig` into the two interfaces above and keep `export type UiConfig = MachineConfig & PersonConfig` so no reader changes. Rename `camera.pinned` → `cameraPrefs.pinned`, updating the three call sites found by `grep -rn "camera\.pinned" packages/ui/src`. Split `DEFAULT_CONFIG` into `DEFAULT_MACHINE_CONFIG` and `DEFAULT_PERSON_CONFIG` and keep `DEFAULT_CONFIG` as their merge, so existing imports of it are untouched.

```ts
/**
 * @invariant config-section-scope
 * @rung 6  choke-point — MACHINE_SECTIONS and PERSON_SECTIONS partition
 *          keyof UiConfig, and test/config-scope.test.ts fails if their union
 *          is not exactly Object.keys(DEFAULT_CONFIG). A new section cannot be
 *          added without being given a scope
 * @why an unscoped section defaults to whichever half the code happens to
 *      write, and the half it must not default into is the machine one: that
 *      is how an envelope crosses machines
 */
export const MACHINE_SECTIONS = ["axisRoles", "heaterColors", "dockSensors", "camera", "sensorNames", "bed", "pins", "shaping"] as const satisfies readonly (keyof MachineConfig)[];
export const PERSON_SECTIONS = ["thermalColors", "cameraPrefs", "macros", "cards"] as const satisfies readonly (keyof PersonConfig)[];
```

`screens` belongs to neither list, because it is the one section split per leaf. Declare it as its own third list rather than pretending it fits in one half:

```ts
/** The one section that spans both halves — layouts machine, the rest person. */
export const SPLIT_SECTIONS = ["screens"] as const;
```

The first test in Step 1 compares `[...MACHINE_SECTIONS, ...PERSON_SECTIONS, ...SPLIT_SECTIONS]` against `Object.keys(DEFAULT_CONFIG)`. Write it that way in Step 1 — the version above is the final form, not a draft.

```ts
export function splitOverlay(o: ConfigOverlay): { machine: DeepPartial<MachineConfig>; person: DeepPartial<PersonConfig> } {
	const machine: Record<string, unknown> = {};
	const person: Record<string, unknown> = {};
	for (const k of MACHINE_SECTIONS) if (k in o) machine[k] = o[k];
	for (const k of PERSON_SECTIONS) if (k in o) person[k] = o[k];
	const screens = o.screens;
	if (screens !== undefined) {
		const { layouts, ...rest } = screens;
		if (layouts !== undefined) machine.screens = { layouts };
		if (Object.keys(rest).length > 0) person.screens = rest;
	}
	return { machine: machine as DeepPartial<MachineConfig>, person: person as DeepPartial<PersonConfig> };
}

export function joinOverlay(machine: DeepPartial<MachineConfig>, person: DeepPartial<PersonConfig>): ConfigOverlay {
	const { screens: mScreens, ...m } = machine as Record<string, unknown> & { screens?: object };
	const { screens: pScreens, ...p } = person as Record<string, unknown> & { screens?: object };
	const screens = { ...(pScreens ?? {}), ...(mScreens ?? {}) };
	const out = { ...m, ...p } as Record<string, unknown>;
	if (Object.keys(screens).length > 0) out.screens = screens;
	return out as ConfigOverlay;
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && pnpm test` and `cd packages/ui && ./node_modules/.bin/tsc -b --force`
Expected: PASS, and the typecheck flags every `camera.pinned` reader you have not moved to `cameraPrefs.pinned` — fix each.

- [ ] **Step 5: Falsify**

Move `"shaping"` from `MACHINE_SECTIONS` to `PERSON_SECTIONS`. "the safety-critical sections are machine" must go RED. Restore, confirm GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config packages/ui/test/config-scope.test.ts packages/ui/test/config.test.ts
git commit -m "feat(config): UiConfig splits into a machine half and a person half GIT_86"
```

---

### Task 7: Store the two halves separately

**Files:**
- Modify: `packages/ui/src/config/store.ts` (`loadCache` :617-641, `writeCache` :640-641, `persistCache` :212, `commit` :~540, `createConfigStore` signature, `loadFromMachine` :518)
- Modify: `packages/ui/src/config/types.ts` (`CONFIG_CACHE_KEY` becomes person-only; add a comment saying so)
- Test: `packages/ui/test/config-cache-scope.test.ts` (new)

**Interfaces:**
- Consumes: `splitOverlay`/`joinOverlay` (Task 6), `MachineStore` (Task 3).
- Produces: `createConfigStore` gains a `machineStore: Accessor<MachineStore | null>` argument; `store.hydrateMachine()` is called by the store itself via an effect on that accessor. The person cache stays at `dwc-ng.config`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/config-cache-scope.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { MachineStore } from "../src/config/machineStore.ts";

// (reuse the withLocalStorage helper from machine-store.test.ts — copy it in;
// these tests must not share mutable module state.)

test("the person cache survives a boot with no identity; the machine half does not appear", () => {
	withLocalStorage(() => {
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			store.setThermalColor("hot", "#ff0000");   // person
			store.setAxisRole("U", "Z motor 1");        // machine
			dispose();

			// Fresh boot, still no identity.
			createRoot(d2 => {
				const [ms2] = createSignal<MachineStore | null>(null);
				const s2 = createConfigStore({ machineStore: ms2 });
				assert.equal(s2.config.thermalColors.hot, "#ff0000", "person state boots from cache");
				assert.equal(s2.config.axisRoles.U, undefined, "machine state is not readable without a machine");
				d2();
			});
			setMs(null);
		});
	});
});

test("machine state written on A is not visible on B", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			setMs(A);
			store.setAxisRole("U", "A's Z motor");
			assert.equal(store.config.axisRoles.U, "A's Z motor");
			setMs(B);
			assert.equal(store.config.axisRoles.U, undefined, "B must not inherit A's machine state");
			dispose();
		});
	});
});

test("the envelope is the case that matters and behaves the same way", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			setMs(A);
			store.setEnvelope({ x: [0, 300], y: [0, 300] });
			setMs(B);
			assert.equal(store.config.shaping.envelope, null, "an inherited envelope is the crash this campaign exists to stop");
			dispose();
		});
	});
});

test("person edits are not lost when identity arrives", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		createRoot(dispose => {
			const [ms, setMs] = createSignal<MachineStore | null>(null);
			const store = createConfigStore({ machineStore: ms });
			store.setThermalColor("hot", "#abcdef");
			setMs(A);
			assert.equal(store.config.thermalColors.hot, "#abcdef");
			dispose();
		});
	});
});
```

Use the store's real mutator names — read `packages/ui/src/config/store.ts`'s returned object and substitute the actual ones for `setThermalColor` / `setAxisRole` / `setEnvelope` before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | tail -20`
Expected: FAIL — `createConfigStore` takes no arguments and machine state currently boots from the origin-global cache, so "B must not inherit A's machine state" fails. **That failure is the bug this whole plan is about; read the output and confirm it is failing for that reason and not a signature error.**

- [ ] **Step 3: Write minimal implementation**

In `store.ts`:

- `createConfigStore({ machineStore })` takes the accessor.
- `loadCache()` reads `dwc-ng.config` and returns **only the person half** — run its parsed overlay through `splitOverlay` and discard `machine`.
- `writeCache()` writes only the person half to `dwc-ng.config`; the machine half goes to `machineStore()?.set("config", …)` and is skipped entirely when the handle is null.
- A `createEffect` on `machineStore()` re-reads the machine half for the new handle (or clears it to `{}` when null) and re-derives the effective config through the existing `commit` path — do not add a second assignment site for `overlay`; the `overlay-writes-persist` invariant at :215-233 depends on `commit` being the only one.
- `snapshots` stay in the person cache: a backup history is the operator's, and Task 8's migration does not touch them.

Keep the doc comment on `persistCache`'s `whole-cache-write` invariant accurate — it now writes two records, and the invariant becomes "both halves together, or neither".

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && pnpm test` — the whole suite, not just the new file. `config.test.ts` and `config-shaping.test.ts` construct the store; update their call sites to pass a `machineStore` accessor.
Expected: PASS.

- [ ] **Step 5: Falsify**

Make `writeCache` put the joined overlay back in `dwc-ng.config`. "B must not inherit A's machine state" and the envelope test must both go RED. Restore, confirm GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config packages/ui/test
git commit -m "feat(config): the machine half is stored per machine, the person half per origin GIT_86"
```

---

### Task 8: The v2 → v3 migration

Two artefacts, two different answers, because they carry different evidence (spec §4). The SD file is self-attributing — reading it over a connection to board X *is* proof it is board X's. The localStorage copy carries no such proof and is the exact mechanism of the bug.

**Files:**
- Create: `packages/ui/src/config/migrateStorage.ts`
- Modify: `packages/ui/src/config/types.ts` (`CONFIG_VERSION` 2 → 3)
- Modify: `packages/ui/src/config/parse.ts` (`parseOverlayPayload` :359-375 — add the v2 arm)
- Test: `packages/ui/test/config-migrate-v3.test.ts` (new)

**Interfaces:**
- Consumes: `splitOverlay` (Task 6), `machineKeySegment` (Task 2).
- Produces:
  - `export function migratePersonCacheToV3(raw: string | null): { person: ConfigOverlay; droppedMachineSections: string[] }`
  - `export function stampMachineOverlay(overlay: DeepPartial<MachineConfig>, id: IdentifiedMachine): { machineId: string; overlay: DeepPartial<MachineConfig> }`
  - `export function readStampedMachineOverlay(raw: unknown, id: IdentifiedMachine): { overlay: DeepPartial<MachineConfig>; claimed: boolean; writtenFor: string | null }`

Task 9 renders `claimed`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/config-migrate-v3.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { migratePersonCacheToV3, stampMachineOverlay, readStampedMachineOverlay } from "../src/config/migrateStorage.ts";
import { parseOverlayPayload } from "../src/config/parse.ts";

const v2 = JSON.stringify({
	version: 2,
	overlay: {
		thermalColors: { hot: "#f00" },
		axisRoles: { U: "Z motor 1" },
		shaping: { envelope: { x: [0, 300], y: [0, 300] } },
		screens: { hidden: ["jobs"], layouts: { machine: { c1: { row: 1 } } } },
	},
});

test("a v2 localStorage cache keeps the person half and DROPS the machine half", () => {
	const { person, droppedMachineSections } = migratePersonCacheToV3(v2);
	assert.deepEqual(person.thermalColors, { hot: "#f00" });
	assert.deepEqual(person.screens, { hidden: ["jobs"] });
	assert.equal(person.axisRoles, undefined);
	assert.equal(person.shaping, undefined, "an unattributed envelope is exactly the hazard — it must not survive");
	// Recorded, not silent: the card tells the operator what was re-read from SD.
	assert.deepEqual(droppedMachineSections.sort(), ["axisRoles", "screens.layouts", "shaping"]);
});

test("garbage and foreign versions migrate to nothing, never to a throw", () => {
	assert.deepEqual(migratePersonCacheToV3("{not json").person, {});
	assert.deepEqual(migratePersonCacheToV3(null).person, {});
	assert.deepEqual(migratePersonCacheToV3(JSON.stringify({ version: 99, overlay: { thermalColors: {} } })).person, {});
	assert.deepEqual(migratePersonCacheToV3(JSON.stringify({ version: 2, overlay: "nope" })).person, {});
});

test("the SD file's machine half is stamped with the machine it was read from", () => {
	const stamped = stampMachineOverlay({ shaping: { envelope: { x: [0, 300], y: [0, 300] } } } as never, { kind: "board", uniqueId: "A" });
	assert.equal(stamped.machineId, "b.A");
	const back = readStampedMachineOverlay(stamped, { kind: "board", uniqueId: "A" });
	assert.equal(back.claimed, false);
	assert.ok(back.overlay.shaping);
});

test("a stamp from another machine is CLAIMED, not adopted and not discarded", () => {
	const stamped = stampMachineOverlay({ shaping: { envelope: { x: [0, 300], y: [0, 300] } } } as never, { kind: "board", uniqueId: "A" });
	const back = readStampedMachineOverlay(stamped, { kind: "board", uniqueId: "B" });
	assert.equal(back.claimed, true, "an SD card moved to another board must not silently apply its envelope");
	assert.equal(back.writtenFor, "b.A");
	assert.deepEqual(back.overlay, {}, "claimed means NOT in effect until confirmed");
});

test("an unstamped v3 machine overlay is claimed too — absence of proof is not proof", () => {
	const back = readStampedMachineOverlay({ overlay: { shaping: {} } }, { kind: "board", uniqueId: "A" });
	assert.equal(back.claimed, true);
	assert.equal(back.writtenFor, null);
});

test("parseOverlayPayload still reads v1 and v2 files rather than dropping them", () => {
	assert.ok(parseOverlayPayload(v2), "a v2 SD file must still parse — a version bump that dropped it loses every saved layout");
	assert.equal(parseOverlayPayload(JSON.stringify({ version: 99, overlay: {} })), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `migrateStorage.ts` implementing the three functions. `migratePersonCacheToV3` must be a transform on the RAW json ahead of `parseOverlay`, exactly like `migrateOverlayColumns` (`config/parse.ts:338-355`), so a hand-mangled file cannot make it throw. Bump `CONFIG_VERSION` to 3 and add the v2 arm to `parseOverlayPayload`:

```ts
	if (parsed.version === 2) return parseOverlay(parsed.overlay);
	if (parsed.version === 1) return parseOverlay(migrateOverlayColumns(parsed.overlay));
```

(v2 → v3 is not a shape change to the overlay itself — it is a change to *where the halves live*, which is why the SD arm is a plain re-parse and the work happens in `migrateStorage.ts`.)

Wire `migratePersonCacheToV3` into `loadCache` (Task 7) and surface `droppedMachineSections` on the store's meta so Task 11's card can render the line.

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && pnpm test`
Expected: PASS.

- [ ] **Step 5: Falsify**

Make `migratePersonCacheToV3` return the whole overlay. The "DROPS the machine half" test must go RED on the `shaping` assertion. Restore. Then make `readStampedMachineOverlay` return `claimed: false` on a mismatch — the claimed test must go RED. Restore, confirm GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config packages/ui/test/config-migrate-v3.test.ts
git commit -m "feat(config): v2 to v3 — SD splits and stamps, the local cache drops its machine half GIT_86"
```

---

### Task 9: "Claimed, not adopted" on the SD load path

**Files:**
- Modify: `packages/ui/src/config/store.ts` (`loadFromMachine` :518-535, `saveToMachine` :508-517)
- Test: `packages/ui/test/config-claimed.test.ts` (new)

**Interfaces:**
- Consumes: `stampMachineOverlay` / `readStampedMachineOverlay` (Task 8).
- Produces: `store.meta.claimedProfile: { writtenFor: string | null; sections: string[] } | null`, and `store.adoptClaimedProfile()` / `store.clearClaimedProfile()`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/config-claimed.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import { createConfigStore } from "../src/config/store.ts";
import { openMachineStore } from "../src/config/machineStore.ts";
import type { MachineStore } from "../src/config/machineStore.ts";

/** A connector stub: download returns the given text, upload records it. */
function fakeConnector(text: string) {
	const uploads: { path: string; body: string }[] = [];
	return {
		uploads,
		download: async () => text,
		upload: async (path: string, body: string) => void uploads.push({ path, body }),
	} as never;
}

test("saveToMachine stamps the machine half with the connected machine", () => {
	withLocalStorage(() => {
		createRoot(async dispose => {
			const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "A" }));
			const store = createConfigStore({ machineStore: ms });
			store.setEnvelope({ x: [0, 300], y: [0, 300] });
			const conn = fakeConnector("");
			await store.saveToMachine(conn);
			const body = JSON.parse(conn.uploads[0].body);
			assert.equal(body.version, 3);
			assert.equal(body.machineId, "b.A");
			dispose();
		});
	});
});

test("a card from another board loads CLAIMED: the envelope is not in effect", () => {
	withLocalStorage(() => {
		createRoot(async dispose => {
			const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "B" }));
			const store = createConfigStore({ machineStore: ms });
			const written = JSON.stringify({
				version: 3,
				machineId: "b.A",
				overlay: { shaping: { envelope: { x: [0, 999], y: [0, 999] } } },
			});
			await store.loadFromMachine(fakeConnector(written));
			assert.equal(store.config.shaping.envelope, null, "a claimed envelope must NOT be driven against");
			assert.equal(store.meta.claimedProfile?.writtenFor, "b.A");
			dispose();
		});
	});
});

test("adopting a claimed profile applies it and clears the claim", () => {
	withLocalStorage(() => {
		createRoot(async dispose => {
			const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "B" }));
			const store = createConfigStore({ machineStore: ms });
			await store.loadFromMachine(fakeConnector(JSON.stringify({
				version: 3, machineId: "b.A", overlay: { shaping: { envelope: { x: [0, 200], y: [0, 200] } } },
			})));
			store.adoptClaimedProfile();
			assert.deepEqual(store.config.shaping.envelope, { x: [0, 200], y: [0, 200] });
			assert.equal(store.meta.claimedProfile, null);
			dispose();
		});
	});
});

test("a matching stamp is adopted with no claim at all", () => {
	withLocalStorage(() => {
		createRoot(async dispose => {
			const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "A" }));
			const store = createConfigStore({ machineStore: ms });
			await store.loadFromMachine(fakeConnector(JSON.stringify({
				version: 3, machineId: "b.A", overlay: { axisRoles: { U: "Z motor 1" } },
			})));
			assert.equal(store.config.axisRoles.U, "Z motor 1");
			assert.equal(store.meta.claimedProfile, null);
			dispose();
		});
	});
});

test("dirty still wins: a reconnect must not discard unsaved work", () => {
	// The existing guard at store.ts:518-524. Re-pinned here because this task
	// rewrites the function around it.
	withLocalStorage(() => {
		createRoot(async dispose => {
			const [ms] = createSignal<MachineStore | null>(openMachineStore({ kind: "board", uniqueId: "A" }));
			const store = createConfigStore({ machineStore: ms });
			store.setAxisRole("U", "unsaved");
			await store.loadFromMachine(fakeConnector(JSON.stringify({ version: 3, machineId: "b.A", overlay: { axisRoles: { U: "from SD" } } })));
			assert.equal(store.config.axisRoles.U, "unsaved");
			dispose();
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && pnpm test 2>&1 | tail -20`
Expected: FAIL — `machineId` is not in the payload and `meta.claimedProfile` does not exist.

- [ ] **Step 3: Write minimal implementation**

`saveToMachine` builds `{ version: CONFIG_VERSION, machineId, overlay }` — note the `@debt` already on that function at :503-507 about the hand-built literal; this task adds a field to it, so leave the debt note updated rather than stale. `loadFromMachine` splits the parsed overlay, runs the machine half through `readStampedMachineOverlay`, and commits person + (machine if not claimed). A claimed profile is held in meta, not in the overlay — that is what "not in effect" means.

Guard: `saveToMachine` while `machineStore()` is null must **refuse**, not write an unstamped file. Add that test if the write path allows it.

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && pnpm test`
Expected: PASS.

- [ ] **Step 5: Falsify**

Make `loadFromMachine` commit the machine half regardless of `claimed`. "a card from another board loads CLAIMED" must go RED on the envelope assertion. Restore, confirm GREEN.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/config packages/ui/test/config-claimed.test.ts
git commit -m "feat(config): a profile written for another board is claimed, not adopted GIT_86"
```

---

### Task 10: Move the four remaining machine-scoped keys, and turn the lint on

The offender list Task 4 recorded: `editor/drafts.ts` (`dwc-ng.drafts`), `om/commandHistory.ts` (`dwc-ng.cmdHistory`), `om/consoleLog.ts` (`dwc-ng.console`), `shell/panelCanvas.ts` (`canvasStorageKey`, :1848).

**Files:**
- Modify: `packages/ui/src/editor/drafts.ts` (:29 and its `loadSession`/`saveSession` :276-320)
- Modify: `packages/ui/src/om/commandHistory.ts` (:17, `loadCommandHistory` :50, `saveCommandHistory` :60)
- Modify: `packages/ui/src/om/consoleLog.ts` (:73, `loadConsole` :102, `saveConsole` :112)
- Modify: `packages/ui/src/shell/panelCanvas.ts` (`canvasStorageKey` :1848) and its callers
- Modify: `packages/ui/src/om/store.ts` (:60-66 `persistSoon` / `saveConsole`, and the boot-time `loadConsole`)
- Modify: `packages/ui/test/storage-keys.test.ts` (remove both `skip`s)
- Test: `packages/ui/test/console-log.test.ts`, `command-history.test.ts`, `editor-drafts.test.ts` (extend each with a cross-machine case)

**Interfaces:**
- Consumes: `MachineStore` (Task 3), `createMachineSession` (Task 5).
- Produces: each of the four load/save pairs takes a `MachineStore` parameter instead of reaching for `localStorage` itself. `canvasStorageKey` is deleted; `panelCanvas` takes the store and a screen id.

- [ ] **Step 1: Write the failing tests**

Add one test per module, all the same shape. Example for the console:

```ts
test("console lines do not cross machines", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		saveConsole(A, [{ receivedAt: 1, text: "A's reply" }]);
		assert.deepEqual(loadConsole(B), []);
		assert.equal(loadConsole(A).length, 1);
	});
});
```

And for the canvas, the one with a user-visible consequence:

```ts
test("a layout saved on one machine is not shown on another", () => {
	withLocalStorage(() => {
		const A = openMachineStore({ kind: "board", uniqueId: "A" });
		const B = openMachineStore({ kind: "board", uniqueId: "B" });
		saveCanvasLayout(A, "machine", [{ id: "c1", row: 3, col: 0, rowSpan: 4, colSpan: 12 }]);
		assert.equal(loadCanvasLayout(B, "machine"), null);
	});
});
```

Then delete both `skip` options in `test/storage-keys.test.ts`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/ui && pnpm test 2>&1 | tail -30`
Expected: FAIL on all four new tests plus the now-unskipped lint listing the four offenders.

- [ ] **Step 3: Write the implementation**

Thread `MachineStore` through each pair. Two things that are not mechanical and must be got right:

- **The console and command history load later than they used to.** Their boot-time `loadConsole()` in `om/store.ts:60-66` moves into an effect on `machineSession.store()`. Appending to an empty list and then hydrating would show a flash of empty console followed by a jump; hydrate by *prepending* the loaded lines to whatever arrived in the meantime, capped by the existing `capLines`.
- **The canvas must not render defaults and then snap.** A screen whose layout has not hydrated yet renders its skeleton, not the default arrangement — cards visibly rearranging under the operator is the exact jitter `uniformity-alignment-positional-stability` forbids. Gate on `machineSession.store() !== null`, using `<Show>`, and keep the container's reserved height so the page does not reflow when it fills.

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && pnpm test`
Expected: PASS, lint included and unskipped.

- [ ] **Step 5: Falsify the lint itself**

Add `const rogue = "dwc-ng.console";` to any src file outside the allowlist. The lint must go RED and name that file. Remove it, confirm GREEN. (Without this the lint may be passing because `walk()` found nothing.)

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src packages/ui/test
git commit -m "feat(storage): drafts, console, history and layouts are per machine; lint enforces it GIT_86"
```

---

### Task 11: A System card that says which machine this is

Without this, every behaviour above is invisible and the dropped-settings line from Task 8 goes unsaid — which is a settings screen that quietly forgot something.

**Files:**
- Modify: `packages/ui/src/cards/SystemCards.tsx` (or the registry file the System screen's cards live in — `grep -rn "System" packages/ui/src/compose/registry*`)
- Modify: the card registry so the card is available and placed
- Test: `packages/ui/test/machine-card.test.ts` (new)

**Interfaces:**
- Consumes: `describeMachineId`, `machineKeySegment` (Task 2); `store.meta.claimedProfile`, `store.meta.droppedMachineSections` (Tasks 8, 9).
- Produces: a registry card id; no exported API.

The card states, in this order: which machine this is (`describeMachineId`), whether identity came from `uniqueId` or the MAC fallback and what that means if the board later gains a `uniqueId`, the claimed-profile row with Adopt / Clear when `claimedProfile` is set, and the "machine settings from before this update were re-read from this board's card" line when `droppedMachineSections` is non-empty.

- [ ] **Step 1: Write the failing test**

Test the card's text-producing helpers as pure functions rather than mounting it — that is how the other card tests in this repo are written (see `test/card-scenarios.test.ts`). Pin: an unidentified machine says so and does not render a key; a MAC-derived identity says the fallback was used; a claimed profile names the board it was written for.

- [ ] **Step 2–4: Fail, implement, pass**

Run `cd packages/ui && pnpm test` at each step. All CSS added here uses `calc(n * var(--u))` and inset box-shadow, or `test/unit-lengths.test.ts` fails the suite.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/cards packages/ui/src/compose packages/ui/test/machine-card.test.ts
git commit -m "feat(system): a card that names the machine and what it forgot GIT_86"
```

---

### Task 12: Verify on the real machine, budget, deploy

**Files:** none — this is the falsification and delivery gate.

- [ ] **Step 1: Full suite and typecheck**

```bash
cd packages/ui && ./node_modules/.bin/tsc -b --force && pnpm test
cd ../mock-duet && pnpm test
```
Expected: everything green. Record the test count against the 1398 baseline.

- [ ] **Step 2: Invariant gate**

Run the repo's invariant register/ratchet gate (the one GIT_84 fixed). The four new `@invariant` blocks — `machine-identity-single-resolution`, `machine-scoped-storage`, `config-section-scope`, and the updated `whole-cache-write` — must register and parse. A row the gate cannot parse is a row that is not enforced (GIT_84's lesson).

- [ ] **Step 3: Eager budget**

```bash
pnpm build && pnpm ship --target http://duet3.nydick.net --mode dsf
```
All of this is boot-path code with roughly 2 KB of headroom. If it overruns, **do not raise the ceiling** — read `packages/deploy/eager-budget.json`'s note and split, the way `results.ts`/`resultsCodec.ts` was split. The migration and the claimed-profile UI are both candidates: neither runs on a normal boot.

- [ ] **Step 4: The falsifying check on real hardware**

Name the check that could FAIL before running it. This one:

1. Point the browser at `duet3.nydick.net`, set a distinctive axis role and an envelope, save to machine, reload, confirm both come back.
2. In the same browser, point at the mock (`pnpm mock` with the toolchanger snapshot, which has a different `uniqueId`).
3. **The envelope must read unset and the axis role must be absent.** If either carries over, phase 1 has not worked and nothing here should be merged.
4. Point back at the board. Both must return.

Step 3 is the falsifiable one. Before this change it would have carried over — that is the bug. Run it and record the observation, not the expectation.

- [ ] **Step 5: Ledger and close**

Add the campaign ledger entry required by `docs/github-issue-rules.md` (what changed, what is better, what regressed, new smells — specifically: the one-poll unknown window, and layouts no longer following the operator across machines). Update the Context child on the ticket pair. Merge to `main`, deploy, and note the build id.

---

## Self-review

**Spec coverage (phase 1 row of §7):** `uniqueId` typed and gated → Tasks 1–2 (`network` gated too, which the spec's phase-1 row did not anticipate and open question 4's answer requires). `MachineId` resolution → Task 2. Machine-scoped cache key → Tasks 3, 5, 7, 10. `UiConfig` split per §4 → Task 6. v2→v3 migration → Task 8, with §3's "claimed, not adopted" at Task 9. A System card naming the machine → Task 11.

**Deliberately not here** (later phases, per §7): the `Fact`/`UnknownCause` machinery and `gapText` (phase 2), the survey (phase 3), `kinematics` and `accelerometer.orientation` being *read* (phases 2 and 4), dock geometry (phase 5), drive parameters (phase 6). This plan types `network` but no other new fact.

**Known gaps, stated rather than hidden:**
- Open question 5 (the one-poll unknown window) is unanswered and this plan implements the spec's default — machine facts read unknown for about one poll after every reload. Task 10's canvas gate makes that window visible as a skeleton. If Gabe wants the optimistic path instead, it is a change to Task 5 only.
- The `@rung 6` claims in Tasks 3 and 6 rest partly on a lint (Task 4), and a test is not a construction. Both carry the `@debt` naming the rung-7 promotion.
- `dwc-ng.canvas.cardlab` (`dev/CardLab.tsx:135`) stays person-scoped and is excluded from the lint by not matching a machine key name — Card Lab is a dev surface with no machine behind it.
