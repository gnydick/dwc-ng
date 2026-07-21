# Height Map Preview with Single-Point Re-Probing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `0:/sys/heightmap.csv` as a clickable grid of probe points, let the operator re-probe individual points, and write the corrected map back to the machine.

**Architecture:** A pure parser (`parse.ts`) converts the CSV to a typed grid and back, recomputing the header's derived statistics on every serialise. A store holds the loaded map plus an overlay of pending edits, mirroring the existing config store's immutable-base-plus-overlay model; `save()` uploads **and** runs `G29 S1` as one operation. A new `Bed` view renders the grid, and re-probing sends a single operator-configured command whose reply is converted to a map value by one isolated, separately-tested function.

**Tech Stack:** SolidJS + TypeScript, node:test (`node --conditions=browser --test`), hand-rolled CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-21-heightmap-reprobe-design.md`

## Global Constraints

- **No new dependencies.** CLAUDE.md forbids adding one without asking.
- **Tests run as the browser build:** `npm test` in `packages/ui` already passes `--conditions=browser`. Never run bare `node --test`.
- **Typecheck with `npx tsc -b --force`.** `npx tsc --noEmit` checks zero files in this repo (solution-style root tsconfig).
- **Solid rules:** never destructure props; use `<Show>`/`<For>`/`<Switch>`, not early returns or `.map` in JSX; signals read inside tracking scopes only.
- **Controls are 1:1 with G-code.** No GUI-encoded safeties, no gating on machine state, no invented motion. The firmware is the authority.
- **Every vertical dimension is a multiple of 4px** (`--ctl-h: 28px`, `--ctl-gap: 8px`). The grid quantum is 4px.
- **Positional stability is a hard rule.** Live-updating values use `tabular-nums` and reserved widths; nothing may reflow under the pointer.
- **Reference is read-only.** Never copy from `reference/`. G-code forms must be cited, not remembered.
- Tabs for indentation, matching the existing files. Files are CRLF.

---

### Task 1: Height map parser

**Files:**
- Create: `packages/ui/src/heightmap/parse.ts`
- Create: `packages/ui/test/heightmap-parse.test.ts`
- Read (fixture): `packages/mock-duet/captures/duet3-real-2026-07-15/heightmap.csv`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface HeightMapMeta { axis0: string; axis1: string; min0: number; max0: number; min1: number; max1: number; radius: number; spacing0: number; spacing1: number; num0: number; num1: number }`
  - `interface HeightMap { meta: HeightMapMeta; rows: number[][] }`
  - `parseHeightMap(csv: string): HeightMap | null`
  - `serializeHeightMap(map: HeightMap): string`
  - `cellPosition(meta: HeightMapMeta, row: number, col: number): { x: number; y: number }`
  - `gridStats(rows: number[][]): { min: number; max: number; mean: number; deviation: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/heightmap-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	parseHeightMap, serializeHeightMap, cellPosition, gridStats,
} from "../src/heightmap/parse.ts";

const CAPTURE = new URL(
	"../../mock-duet/captures/duet3-real-2026-07-15/heightmap.csv",
	import.meta.url,
);
const csv = (): string => readFileSync(CAPTURE, "utf8");

test("parses the real machine's height map", () => {
	const map = parseHeightMap(csv());
	assert.ok(map, "capture must parse");
	assert.equal(map.meta.axis0, "X");
	assert.equal(map.meta.axis1, "Y");
	assert.equal(map.meta.num0, 16);
	assert.equal(map.meta.num1, 16);
	assert.equal(map.meta.min0, 5);
	assert.equal(map.meta.max0, 335);
	assert.equal(map.meta.spacing0, 22);
	assert.equal(map.meta.radius, -1, "rectangular bed, not delta");
	assert.equal(map.rows.length, 16);
	assert.ok(map.rows.every(r => r.length === 16), "every row is num0 wide");
	assert.equal(map.rows[0][0], 0.067);
});

test("round-trips the real capture byte-for-byte", () => {
	// This single test pins the format, the number formatting AND the derived
	// statistics arithmetic. If RRF's output is not byte-stable this is the
	// test that says so.
	const original = csv();
	const map = parseHeightMap(original);
	assert.ok(map);
	assert.equal(serializeHeightMap(map), original);
});

test("the header statistics are DERIVED, not carried through", () => {
	const map = parseHeightMap(csv());
	assert.ok(map);
	map.rows[0][0] = 9.999; // an obviously out-of-range value
	const out = serializeHeightMap(map);
	assert.match(out, /max error 9\.999/, "max must reflect the edited grid");
	assert.doesNotMatch(out, /max error 0\.150/, "the original max must not survive");
});

test("gridStats computes min, max, mean and population deviation", () => {
	const stats = gridStats([[0, 2], [4, 6]]);
	assert.equal(stats.min, 0);
	assert.equal(stats.max, 6);
	assert.equal(stats.mean, 3);
	// population sd of 0,2,4,6 = sqrt(5) = 2.2360679...
	assert.ok(Math.abs(stats.deviation - Math.sqrt(5)) < 1e-9);
});

test("cellPosition maps grid indices to bed coordinates", () => {
	const map = parseHeightMap(csv());
	assert.ok(map);
	assert.deepEqual(cellPosition(map.meta, 0, 0), { x: 5, y: 5 });
	// col advances along axis0 by spacing0, row along axis1 by spacing1
	assert.deepEqual(cellPosition(map.meta, 0, 1), { x: 27, y: 5 });
	const last = cellPosition(map.meta, 15, 15);
	assert.ok(Math.abs(last.x - 335) < 0.01, `x ${last.x}`);
	assert.ok(Math.abs(last.y - 295) < 0.01, `y ${last.y}`);
});

test("malformed input yields null rather than throwing", () => {
	for (const bad of ["", "not a height map", "RepRapFirmware height map file v2\n"]) {
		assert.equal(parseHeightMap(bad), null, JSON.stringify(bad));
	}
});

test("a row of the wrong width is rejected", () => {
	const broken = csv().replace(/\n {2}0\.067.*$/m, "\n  0.067,  0.017");
	assert.equal(parseHeightMap(broken), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-parse.test.ts`
Expected: FAIL — cannot resolve `../src/heightmap/parse.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/heightmap/parse.ts`:

```ts
/**
 * RepRapFirmware height map (`0:/sys/heightmap.csv`) — parse and serialise.
 *
 * Format (v2), from the real machine capture:
 *
 *   RepRapFirmware height map file v2 generated at <when>, min error <a>, max error <b>, mean <c>, deviation <d>
 *   axis0,axis1,min0,max0,min1,max1,radius,spacing0,spacing1,num0,num1
 *   X,Y,5.00,335.00,5.00,295.00,-1.00,22.00,19.33,16,16
 *     0.067,  0.017, ...        <- num1 rows of num0 values
 *
 * The four statistics on line 1 are DERIVED. They are recomputed from the grid
 * on every serialise and never carried forward from the input: editing a cell
 * and writing back a stale header would produce a file whose summary disagrees
 * with its own contents. Making them derived removes that possibility instead
 * of relying on someone remembering to update them.
 */

export interface HeightMapMeta {
	axis0: string;
	axis1: string;
	min0: number;
	max0: number;
	min1: number;
	max1: number;
	/** -1 on a rectangular bed; a positive radius means a delta. */
	radius: number;
	spacing0: number;
	spacing1: number;
	num0: number;
	num1: number;
}

export interface HeightMap {
	meta: HeightMapMeta;
	/** rows[row][col]; row indexes axis1, col indexes axis0. */
	rows: number[][];
	/** The "generated at" text, preserved verbatim. */
	generatedAt: string;
}

export interface GridStats {
	min: number;
	max: number;
	mean: number;
	deviation: number;
}

/** Population standard deviation — RRF reports the spread of the points it has, not an estimate of a wider population. */
export function gridStats(rows: number[][]): GridStats {
	const values = rows.flat();
	if (values.length === 0) return { min: 0, max: 0, mean: 0, deviation: 0 };
	let min = Infinity;
	let max = -Infinity;
	let total = 0;
	for (const v of values) {
		if (v < min) min = v;
		if (v > max) max = v;
		total += v;
	}
	const mean = total / values.length;
	const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
	return { min, max, mean, deviation: Math.sqrt(variance) };
}

/** Bed coordinates of a grid cell. col advances along axis0, row along axis1. */
export function cellPosition(meta: HeightMapMeta, row: number, col: number): { x: number; y: number } {
	return { x: meta.min0 + col * meta.spacing0, y: meta.min1 + row * meta.spacing1 };
}

const num = (s: string): number => Number(s.trim());

export function parseHeightMap(csv: string): HeightMap | null {
	const lines = csv.split(/\r?\n/);
	if (lines.length < 4) return null;

	const banner = lines[0] ?? "";
	if (!banner.startsWith("RepRapFirmware height map file v2")) return null;
	// Everything between "generated at " and the first ", min error" is the timestamp.
	const when = /generated at ([^,]+)/.exec(banner);
	if (when === null) return null;

	const fields = (lines[2] ?? "").split(",");
	if (fields.length < 11) return null;
	const meta: HeightMapMeta = {
		axis0: (fields[0] ?? "").trim(),
		axis1: (fields[1] ?? "").trim(),
		min0: num(fields[2]!), max0: num(fields[3]!),
		min1: num(fields[4]!), max1: num(fields[5]!),
		radius: num(fields[6]!),
		spacing0: num(fields[7]!), spacing1: num(fields[8]!),
		num0: num(fields[9]!), num1: num(fields[10]!),
	};
	const numeric = [meta.min0, meta.max0, meta.min1, meta.max1, meta.radius,
		meta.spacing0, meta.spacing1, meta.num0, meta.num1];
	if (numeric.some(v => !Number.isFinite(v))) return null;
	if (meta.num0 <= 0 || meta.num1 <= 0) return null;

	const rows: number[][] = [];
	for (let i = 0; i < meta.num1; i++) {
		const line = lines[3 + i];
		if (line === undefined) return null;
		const values = line.split(",").map(num);
		// A short or long row means the file disagrees with its own header.
		if (values.length !== meta.num0 || values.some(v => !Number.isFinite(v))) return null;
		rows.push(values);
	}

	return { meta, rows, generatedAt: when[1]! };
}

/** RRF writes each value right-aligned in a 6-wide field with 3 decimals, comma-separated. */
const cell = (v: number): string => v.toFixed(3).padStart(6, " ");

export function serializeHeightMap(map: HeightMap): string {
	const s = gridStats(map.rows);
	const banner = `RepRapFirmware height map file v2 generated at ${map.generatedAt}, `
		+ `min error ${s.min.toFixed(3)}, max error ${s.max.toFixed(3)}, `
		+ `mean ${s.mean.toFixed(3)}, deviation ${s.deviation.toFixed(3)}`;
	const header = "axis0,axis1,min0,max0,min1,max1,radius,spacing0,spacing1,num0,num1";
	const geometry = [
		map.meta.axis0, map.meta.axis1,
		map.meta.min0.toFixed(2), map.meta.max0.toFixed(2),
		map.meta.min1.toFixed(2), map.meta.max1.toFixed(2),
		map.meta.radius.toFixed(2),
		map.meta.spacing0.toFixed(2), map.meta.spacing1.toFixed(2),
		String(map.meta.num0), String(map.meta.num1),
	].join(",");
	const body = map.rows.map(r => r.map(cell).join(",")).join("\n");
	return `${banner}\n${header}\n${geometry}\n${body}\n`;
}
```

- [ ] **Step 4: Run the test and reconcile formatting**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-parse.test.ts`

The round-trip test is the one that may fail on exact formatting. If it does,
inspect the diff against the capture and adjust `cell()`, the `toFixed`
precisions, or the trailing-newline handling until the round-trip is exact.
**Do not weaken the test to make it pass** unless the capture proves RRF is not
byte-stable — in that case relax that one assertion to numeric equality and add
a comment recording why.

Expected once reconciled: 7 passed.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/ui && npx tsc -b --force
cd ../.. && git add packages/ui/src/heightmap/parse.ts packages/ui/test/heightmap-parse.test.ts
git commit -m "feat(heightmap): parse and serialise RRF height map files

Header statistics are derived on serialise, never carried through: editing a
cell and writing back a stale min/max/mean/deviation would produce a file whose
summary contradicts its contents. Round-trip of the real machine capture pins
the format, the number formatting and the statistics arithmetic in one test."
```

---

### Task 2: Probe reply → map value

**Files:**
- Create: `packages/ui/src/heightmap/probeReply.ts`
- Create: `packages/ui/test/heightmap-probe-reply.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseProbeReply(reply: string): { triggerHeight: number } | null`

**Why this is its own task:** the spec records that converting a probe reply
into a height-map value is NOT verified against any vendored reference. This
task implements only the half that IS verifiable — extracting the number RRF
reported — and leaves the conversion to the UI, which shows the raw reply
beside the computed value so a wrong formula is visible on the first probe.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/heightmap-probe-reply.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProbeReply } from "../src/heightmap/probeReply.ts";

test("reads the trigger height from a G30 reply", () => {
	assert.deepEqual(parseProbeReply("Stopped at height 2.456 mm"), { triggerHeight: 2.456 });
});

test("tolerates surrounding text and whitespace", () => {
	assert.deepEqual(
		parseProbeReply("  Stopped at height -0.042 mm\n"),
		{ triggerHeight: -0.042 },
	);
});

test("a reply that reports no trigger yields null", () => {
	// The caller must be able to tell "probe failed" from "probed 0.000".
	assert.equal(parseProbeReply("Error: Probe already triggered at start of probing move"), null);
	assert.equal(parseProbeReply(""), null);
	assert.equal(parseProbeReply("ok"), null);
});

test("zero is a real height, not a failure", () => {
	assert.deepEqual(parseProbeReply("Stopped at height 0.000 mm"), { triggerHeight: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-probe-reply.test.ts`
Expected: FAIL — cannot resolve `../src/heightmap/probeReply.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/heightmap/probeReply.ts`:

```ts
/**
 * Extract the trigger height from a probe reply.
 *
 * This deliberately does ONLY the verifiable half. Turning a trigger height
 * into a height-map value depends on the probe's G31 trigger height and the
 * reference plane, and that relationship is not covered by anything vendored
 * under reference/ — so it is not guessed at here. The UI shows this raw reply
 * next to whatever value it computes, so a wrong conversion is visible on the
 * first probe rather than after a map has been corrupted.
 */
export interface ProbeResult {
	/** Machine Z at which the probe triggered, in mm, as RRF reported it. */
	triggerHeight: number;
}

/** RRF answers a probe with "Stopped at height <n> mm". */
const TRIGGER = /Stopped at height\s+(-?\d+(?:\.\d+)?)\s*mm/i;

export function parseProbeReply(reply: string): ProbeResult | null {
	const match = TRIGGER.exec(reply);
	if (match === null) return null;
	const triggerHeight = Number(match[1]);
	return Number.isFinite(triggerHeight) ? { triggerHeight } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-probe-reply.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd "N:/ideaprojects/dwc-ng"
git add packages/ui/src/heightmap/probeReply.ts packages/ui/test/heightmap-probe-reply.test.ts
git commit -m "feat(heightmap): read the trigger height from a probe reply

Only the verifiable half. Converting a trigger height into a map value depends
on the probe's G31 trigger height and the reference plane, which nothing under
reference/ covers - so it is not guessed at. Zero is a real height and must not
read as a failure; a reply with no trigger returns null so the caller can tell
the two apart."
```

---

### Task 3: Height map store

**Files:**
- Create: `packages/ui/src/heightmap/store.ts`
- Create: `packages/ui/test/heightmap-store.test.ts`

**Interfaces:**
- Consumes: `HeightMap`, `parseHeightMap`, `serializeHeightMap` from Task 1.
- Produces:
  - `HEIGHTMAP_FILE = "0:/sys/heightmap.csv"`
  - `createHeightMapStore(connector: Connector)` returning:
    - `map: Accessor<HeightMap | null>`
    - `loading: Accessor<boolean>`
    - `error: Accessor<string>`
    - `load(): Promise<void>`
    - `edit(row: number, col: number, value: number): void`
    - `pending: Accessor<Map<string, { row: number; col: number; from: number; to: number }>>`
    - `dirty: Accessor<boolean>`
    - `discard(): void`
    - `save(): Promise<OpResult>` — reuses `OpResult` from `../files/browser.ts`
    - `valueAt(row: number, col: number): number` — pending value if edited, else loaded

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/heightmap-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoot } from "solid-js";
import { createHeightMapStore, HEIGHTMAP_FILE } from "../src/heightmap/store.ts";
import type { Connector } from "../src/connector/types.ts";

const CAPTURE = new URL(
	"../../mock-duet/captures/duet3-real-2026-07-15/heightmap.csv",
	import.meta.url,
);

interface Calls { download: string[]; upload: [string, string][]; codes: string[] }

function fakeConnector(opts: { failUpload?: boolean } = {}) {
	const calls: Calls = { download: [], upload: [], codes: [] };
	const connector = {
		download: async (path: string) => { calls.download.push(path); return readFileSync(CAPTURE, "utf8"); },
		upload: async (path: string, content: Uint8Array | string) => {
			calls.upload.push([path, String(content)]);
			if (opts.failUpload) throw new Error("board said no");
		},
		sendCode: async (code: string) => { calls.codes.push(code); return ""; },
	} as unknown as Connector;
	return { connector, calls };
}

async function withStore(
	fn: (store: ReturnType<typeof createHeightMapStore>, calls: Calls) => Promise<void>,
	opts: Parameters<typeof fakeConnector>[0] = {},
): Promise<void> {
	const { connector, calls } = fakeConnector(opts);
	let dispose = (): void => {};
	const store = createRoot(d => { dispose = d; return createHeightMapStore(connector); });
	try { await fn(store, calls); } finally { dispose(); }
}

test("load reads the height map from the machine", async () => {
	await withStore(async (store, calls) => {
		await store.load();
		assert.deepEqual(calls.download, [HEIGHTMAP_FILE]);
		assert.equal(store.map()?.meta.num0, 16);
		assert.equal(store.dirty(), false);
	});
});

test("an edit is pending, not applied to the loaded map", async () => {
	await withStore(async store => {
		await store.load();
		const before = store.map()!.rows[0][0];
		store.edit(0, 0, 0.123);
		assert.equal(store.dirty(), true);
		assert.equal(store.valueAt(0, 0), 0.123, "the pending value is what the UI shows");
		assert.equal(store.map()!.rows[0][0], before, "the loaded map is untouched until save");
		assert.deepEqual(store.pending().get("0,0"), { row: 0, col: 0, from: before, to: 0.123 });
	});
});

test("discard drops every pending edit", async () => {
	await withStore(async store => {
		await store.load();
		const before = store.valueAt(0, 0);
		store.edit(0, 0, 9);
		store.edit(1, 1, 9);
		store.discard();
		assert.equal(store.dirty(), false);
		assert.equal(store.pending().size, 0);
		assert.equal(store.valueAt(0, 0), before);
	});
});

test("save uploads the edited map AND reloads it on the machine", async () => {
	// Uploading alone changes nothing: RRF keeps using the map it already
	// loaded. The two must not be separable.
	await withStore(async (store, calls) => {
		await store.load();
		store.edit(0, 0, 0.123);
		const result = await store.save();
		assert.deepEqual(result, { ok: true });
		assert.equal(calls.upload.length, 1);
		assert.equal(calls.upload[0][0], HEIGHTMAP_FILE);
		assert.match(calls.upload[0][1], /0\.123/, "the edit reached the file");
		assert.deepEqual(calls.codes, ["G29 S1"], "the machine must reload the map");
	});
});

test("many edits produce exactly one upload", async () => {
	await withStore(async (store, calls) => {
		await store.load();
		store.edit(0, 0, 0.1);
		store.edit(1, 1, 0.2);
		store.edit(2, 2, 0.3);
		await store.save();
		assert.equal(calls.upload.length, 1);
	});
});

test("a save that fails leaves the edits pending", async () => {
	await withStore(async (store, calls) => {
		await store.load();
		store.edit(0, 0, 0.123);
		const result = await store.save();
		assert.equal(result.ok, false);
		assert.equal(store.dirty(), true, "edits must survive a failed write");
		assert.equal(calls.codes.length, 0, "no reload after a failed upload");
	}, { failUpload: true });
});

test("save clears the pending set once it has succeeded", async () => {
	await withStore(async store => {
		await store.load();
		store.edit(0, 0, 0.123);
		await store.save();
		assert.equal(store.dirty(), false);
		assert.equal(store.valueAt(0, 0), 0.123, "the saved value is now the loaded value");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-store.test.ts`
Expected: FAIL — cannot resolve `../src/heightmap/store.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/heightmap/store.ts`:

```ts
/**
 * The loaded height map plus an overlay of pending edits.
 *
 * Same shape as the config store: an immutable loaded value, an overlay of
 * changes, and a discard that is just dropping the overlay — so discarding
 * cannot half-fail.
 *
 * save() uploads AND runs G29 S1. Those are one operation on purpose: RRF keeps
 * compensating with the map it loaded at boot, so uploading the file alone
 * would change the card and not the machine, and the two would silently
 * disagree. A failed upload leaves the edits pending and does NOT reload.
 */
import { createMemo, createSignal, type Accessor } from "solid-js";
import type { Connector } from "../connector/types.ts";
import type { OpResult } from "../files/browser.ts";
import { parseHeightMap, serializeHeightMap, type HeightMap } from "./parse.ts";

export const HEIGHTMAP_FILE = "0:/sys/heightmap.csv";

export interface PendingEdit {
	row: number;
	col: number;
	from: number;
	to: number;
}

const key = (row: number, col: number): string => `${row},${col}`;

export interface HeightMapStore {
	map: Accessor<HeightMap | null>;
	loading: Accessor<boolean>;
	error: Accessor<string>;
	pending: Accessor<Map<string, PendingEdit>>;
	dirty: Accessor<boolean>;
	valueAt(row: number, col: number): number;
	load(): Promise<void>;
	edit(row: number, col: number, value: number): void;
	discard(): void;
	save(): Promise<OpResult>;
}

export function createHeightMapStore(connector: Connector): HeightMapStore {
	const [map, setMap] = createSignal<HeightMap | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");
	const [pending, setPending] = createSignal<Map<string, PendingEdit>>(new Map());

	const dirty = createMemo(() => pending().size > 0);

	const valueAt = (row: number, col: number): number => {
		const edit = pending().get(key(row, col));
		if (edit !== undefined) return edit.to;
		return map()?.rows[row]?.[col] ?? 0;
	};

	const load = async (): Promise<void> => {
		setLoading(true);
		setError("");
		try {
			const parsed = parseHeightMap(await connector.download(HEIGHTMAP_FILE));
			if (parsed === null) {
				setError(`${HEIGHTMAP_FILE} is not a height map this build understands.`);
				setMap(null);
			} else {
				setMap(parsed);
				setPending(new Map());
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setMap(null);
		} finally {
			setLoading(false);
		}
	};

	const edit = (row: number, col: number, value: number): void => {
		const current = map();
		if (current === null) return;
		const from = current.rows[row]?.[col];
		if (from === undefined) return;
		const next = new Map(pending());
		if (value === from) next.delete(key(row, col));
		else next.set(key(row, col), { row, col, from, to: value });
		setPending(next);
	};

	const discard = (): void => setPending(new Map());

	const save = async (): Promise<OpResult> => {
		const current = map();
		if (current === null) return { ok: false, error: "Nothing loaded." };
		// Build the edited grid without mutating the loaded map: if the upload
		// fails, the operator must be exactly where they were.
		const rows = current.rows.map((r, row) => r.map((v, col) => valueAt(row, col)));
		const edited: HeightMap = { ...current, rows };
		try {
			await connector.upload(HEIGHTMAP_FILE, serializeHeightMap(edited));
			// Only now: the file on the card and the machine's live map must not
			// be able to diverge.
			await connector.sendCode("G29 S1");
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		setMap(edited);
		setPending(new Map());
		return { ok: true };
	};

	return { map, loading, error, pending, dirty, valueAt, load, edit, discard, save };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-store.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/ui && npx tsc -b --force
cd ../.. && git add packages/ui/src/heightmap/store.ts packages/ui/test/heightmap-store.test.ts
git commit -m "feat(heightmap): pending-edit store with save = upload + G29 S1

Uploading alone would change the card and not the machine - RRF keeps
compensating with the map it loaded at boot - so the upload and the reload are
one operation. A failed upload leaves the edits pending and does not reload.
Many edits still produce exactly one upload; RRF's HTTP server hates repeats."
```

---

### Task 4: Probe command config

**Files:**
- Modify: `packages/ui/src/config/types.ts`
- Modify: `packages/ui/src/config/store.ts`
- Create: `packages/ui/test/heightmap-probe-command.test.ts`
- Create: `packages/ui/src/heightmap/probeCommand.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface BedConfig { probePointCommand: string }` added to `UiConfig` as `bed`
  - `setBed(patch: Partial<BedConfig>): void` on `ConfigStore`
  - `buildProbeCommand(template: string, x: number, y: number): string`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/heightmap-probe-command.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProbeCommand } from "../src/heightmap/probeCommand.ts";
import { DEFAULT_CONFIG } from "../src/config/types.ts";

test("substitutes the cell's bed coordinates", () => {
	assert.equal(
		buildProbeCommand('M98 P"/macros/probe_point.g" X{x} Y{y}', 27, 5),
		'M98 P"/macros/probe_point.g" X27 Y5',
	);
});

test("coordinates are trimmed to three decimals, without trailing zeroes", () => {
	// spacing1 is 19.33 on the real machine, so rows land on fractional Y.
	assert.equal(buildProbeCommand("G30 X{x} Y{y}", 5, 24.333333), "G30 X5 Y24.333");
});

test("every occurrence is replaced, not just the first", () => {
	assert.equal(buildProbeCommand("{x} {y} {x}", 1, 2), "1 2 1");
});

test("a template with no placeholders is sent unchanged", () => {
	assert.equal(buildProbeCommand("G30 S-1", 1, 2), "G30 S-1");
});

test("the shipped default is a macro call, not invented motion", () => {
	// The UI must not compose a probe move itself: clearance, probe deploy and
	// tool state belong in the operator's own macro.
	assert.match(DEFAULT_CONFIG.bed.probePointCommand, /^M98 P"/);
	assert.match(DEFAULT_CONFIG.bed.probePointCommand, /\{x\}/);
	assert.match(DEFAULT_CONFIG.bed.probePointCommand, /\{y\}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-probe-command.test.ts`
Expected: FAIL — cannot resolve `../src/heightmap/probeCommand.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/heightmap/probeCommand.ts`:

```ts
/**
 * The probe command is a template the operator owns, not motion this UI
 * composes. Clearance, probe deploy and tool state differ per machine and
 * belong in config.g — the UI sends exactly one command, which it displays.
 */

/** Trim to a compact G-code literal: 24.333333 -> "24.333", 5 -> "5". */
const coord = (v: number): string => String(Number(v.toFixed(3)));

export function buildProbeCommand(template: string, x: number, y: number): string {
	return template.split("{x}").join(coord(x)).split("{y}").join(coord(y));
}
```

Modify `packages/ui/src/config/types.ts` — add the interface above `UiConfig`:

```ts
export interface BedConfig {
	/**
	 * Command sent to re-probe one height-map point. {x}/{y} are replaced with
	 * the cell's bed coordinates. A macro by default: the motion belongs in the
	 * operator's config, not in this UI.
	 */
	probePointCommand: string;
}
```

Add to `UiConfig`:

```ts
	bed: BedConfig;
```

Add to `DEFAULT_CONFIG`:

```ts
	bed: { probePointCommand: 'M98 P"/macros/probe_point.g" X{x} Y{y}' },
```

Modify `packages/ui/src/config/store.ts` — add to the `ConfigStore` interface,
beside `setMacros`:

```ts
	setBed(patch: Partial<BedConfig>): void;
```

Add to the returned store object, beside `setMacros`:

```ts
		setBed(patch) {
			apply(draft => { draft.bed = { ...draft.bed, ...patch }; });
		},
```

Add `BedConfig` to the type import list at the top of `store.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/ui && node --conditions=browser --test test/heightmap-probe-command.test.ts test/config.test.ts`
Expected: all passed.

- [ ] **Step 5: Typecheck and commit**

```bash
cd packages/ui && npx tsc -b --force
cd ../.. && git add packages/ui/src/heightmap/probeCommand.ts packages/ui/src/config/types.ts packages/ui/src/config/store.ts packages/ui/test/heightmap-probe-command.test.ts
git commit -m "feat(heightmap): probe command as an operator-owned template

The UI sends one command it displays; clearance, probe deploy and tool state
live in the operator's macro. A wrong default is fixed in Settings rather than
in a release."
```

---

### Task 5: Bed view — grid, re-probe, save

**Files:**
- Create: `packages/ui/src/heightmap/HeightMapGrid.tsx`
- Create: `packages/ui/src/views/Bed.tsx`
- Create: `packages/ui/src/views/bed.panelDefaults.ts`
- Modify: `packages/ui/src/shell/router.ts` (add `"bed"` to `ROUTES`)
- Modify: `packages/ui/src/shell/Shell.tsx` (nav entry + `<Match>`)
- Modify: `packages/ui/src/app.css` (grid + panel styles)
- Modify: `packages/ui/test/panel-canvas.test.ts` (collision test for the new defaults)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a routable `bed` view.

- [ ] **Step 1: Add the route and its collision test**

Modify `packages/ui/src/shell/router.ts`:

```ts
export const ROUTES = ["machine", "control", "jobs", "macros", "system", "settings", "activity", "bed"] as const;
```

Create `packages/ui/src/views/bed.panelDefaults.ts`:

```ts
import type { PanelDefault } from "../shell/panelCanvas.ts";

/**
 * Row spans on the 4px grid (a card spanning n rows renders 4n - 8 px tall).
 * The map is the point of this view, so it takes the room; the detail panel
 * beside it is sized to its controls.
 */
export const BED_PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "heightmap", col: 0, row: 0, colSpan: 16, rowSpan: 150 },
	{ id: "probe-point", col: 16, row: 0, colSpan: 8, rowSpan: 90 },
	{ id: "console", col: 0, row: 150, colSpan: 24, rowSpan: 75 },
	{ id: "camera", col: 0, row: 225, colSpan: 8, rowSpan: 75 },
];
```

Append to `packages/ui/test/panel-canvas.test.ts` (import `BED_PANEL_DEFAULTS`
alongside the other defaults at the top of the file):

```ts
test("Bed view's default panel layout is collision-free", () => {
	assert.equal(hasCollisions(defaultCanvas(BED_PANEL_DEFAULTS)), false);
});
```

- [ ] **Step 2: Run the collision test**

Run: `cd packages/ui && node --conditions=browser --test test/panel-canvas.test.ts`
Expected: PASS, including the new Bed assertion.

- [ ] **Step 3: Write the grid component**

Create `packages/ui/src/heightmap/HeightMapGrid.tsx`:

```tsx
import { For, Show } from "solid-js";
import type { HeightMap } from "./parse.ts";

/**
 * The probe points, one dot each, coloured by deviation.
 *
 * A DIVERGING scale centred on zero: these are signed errors, and a sequential
 * ramp would read -0.10 and +0.10 as far apart rather than equally wrong.
 * Colours are the bed-gold / slate pair already reserved elsewhere, so a dot
 * can never be confused with a heater series line.
 *
 * The grid is drawn row 0 at the BOTTOM: axis1 increases away from the origin,
 * and a bed drawn upside down is worse than no picture.
 */
export function HeightMapGrid(props: {
	map: HeightMap;
	valueAt: (row: number, col: number) => number;
	isEdited: (row: number, col: number) => boolean;
	selected: { row: number; col: number } | null;
	onSelect: (row: number, col: number) => void;
}) {
	/** Largest absolute deviation, so the scale is symmetric about zero. */
	const extent = (): number => {
		let max = 0;
		for (let r = 0; r < props.map.meta.num1; r++) {
			for (let c = 0; c < props.map.meta.num0; c++) {
				max = Math.max(max, Math.abs(props.valueAt(r, c)));
			}
		}
		return max === 0 ? 1 : max;
	};

	const colorFor = (value: number): string => {
		const t = Math.max(-1, Math.min(1, value / extent()));
		// below zero -> slate, above -> gold; lightness carries magnitude.
		const hue = t < 0 ? 210 : 43;
		const strength = Math.round(Math.abs(t) * 55) + 20;
		return `hsl(${hue} 55% ${strength}%)`;
	};

	/** Rows top-to-bottom on screen = axis1 descending. */
	const rowOrder = (): number[] =>
		Array.from({ length: props.map.meta.num1 }, (_, i) => props.map.meta.num1 - 1 - i);
	const colOrder = (): number[] =>
		Array.from({ length: props.map.meta.num0 }, (_, i) => i);

	return (
		<div
			class="hm-grid"
			style={{ "grid-template-columns": `repeat(${props.map.meta.num0}, 1fr)` }}
		>
			<For each={rowOrder()}>
				{row => (
					<For each={colOrder()}>
						{col => (
							<button
								class="hm-dot"
								classList={{
									edited: props.isEdited(row, col),
									selected: props.selected?.row === row && props.selected?.col === col,
								}}
								style={{ background: colorFor(props.valueAt(row, col)) }}
								title={`row ${row}, col ${col}: ${props.valueAt(row, col).toFixed(3)} mm`}
								aria-label={`Probe point row ${row} column ${col}`}
								onClick={() => props.onSelect(row, col)}
							/>
						)}
					</For>
				)}
			</For>
		</div>
	);
}
```

- [ ] **Step 4: Write the view**

Create `packages/ui/src/views/Bed.tsx`:

```tsx
import { Show, createSignal, onMount } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { createHeightMapStore } from "../heightmap/store.ts";
import { HeightMapGrid } from "../heightmap/HeightMapGrid.tsx";
import { cellPosition } from "../heightmap/parse.ts";
import { buildProbeCommand } from "../heightmap/probeCommand.ts";
import { parseProbeReply } from "../heightmap/probeReply.ts";
import { BED_PANEL_DEFAULTS } from "./bed.panelDefaults.ts";

/**
 * Bed — the height map and single-point re-probing.
 *
 * Nothing is written to the card until Save, and Save is upload + G29 S1
 * together (see heightmap/store.ts). Re-probing sends one operator-configured
 * command and reports what came back: the raw reply is shown beside the value
 * it produced, because that conversion is not verified (see the design doc).
 */
export default function Bed() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.bed", BED_PANEL_DEFAULTS,
		id => (id === "camera" ? app.config.config.camera.pinned : true));
	const store = createHeightMapStore(app.connector);

	const [selected, setSelected] = createSignal<{ row: number; col: number } | null>(null);
	const [probing, setProbing] = createSignal(false);
	const [reply, setReply] = createSignal("");
	const [probed, setProbed] = createSignal<number | null>(null);
	const [message, setMessage] = createSignal("");

	onMount(() => { void store.load(); });

	const cell = () => {
		const sel = selected();
		const map = store.map();
		if (sel === null || map === null) return null;
		return { ...sel, ...cellPosition(map.meta, sel.row, sel.col) };
	};

	const reprobe = async (): Promise<void> => {
		const target = cell();
		if (target === null) return;
		setProbing(true);
		setReply("");
		setProbed(null);
		setMessage("");
		const code = buildProbeCommand(app.config.config.bed.probePointCommand, target.x, target.y);
		try {
			const text = await app.connector.sendCode(code);
			setReply(text);
			const result = parseProbeReply(text);
			if (result === null) setMessage("No trigger height in the reply — nothing to accept.");
			else setProbed(result.triggerHeight);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setProbing(false);
		}
	};

	const accept = (): void => {
		const target = cell();
		const value = probed();
		if (target === null || value === null) return;
		store.edit(target.row, target.col, value);
		setProbed(null);
		setReply("");
	};

	const save = async (): Promise<void> => {
		const result = await store.save();
		setMessage(result.ok ? "Saved and reloaded (G29 S1)." : result.error);
	};

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="bed">
				<Card id="heightmap" canvas={canvas} ariaLabel="Height map" title="Height map" tip="0:/sys/heightmap.csv">
					<div class="hm-bar">
						<button class="fb-tool" onClick={() => void store.load()}>Reload</button>
						<button class="fb-tool ok" disabled={!store.dirty()} onClick={() => void save()}>
							Save{store.dirty() ? ` (${store.pending().size})` : ""}
						</button>
						<button class="fb-tool" disabled={!store.dirty()} onClick={() => store.discard()}>Discard</button>
						<span class="hm-msg">{message()}</span>
					</div>
					<Show
						when={store.map()}
						fallback={<p class="job-empty">{store.loading() ? "Reading height map…" : (store.error() || "No height map on the machine.")}</p>}
					>
						{map => (
							<HeightMapGrid
								map={map()}
								valueAt={(r, c) => store.valueAt(r, c)}
								isEdited={(r, c) => store.pending().has(`${r},${c}`)}
								selected={selected()}
								onSelect={(row, col) => { setSelected({ row, col }); setProbed(null); setReply(""); }}
							/>
						)}
					</Show>
				</Card>

				<Card id="probe-point" canvas={canvas} ariaLabel="Probe point" title="Probe point" tip="operator macro">
					<Show when={cell()} fallback={<p class="job-empty">Select a point on the map.</p>}>
						{target => (
							<div class="hm-detail">
								<dl class="meta-grid">
									<dt>Cell</dt><dd>row {target().row}, col {target().col}</dd>
									<dt>Position</dt><dd>X {target().x.toFixed(2)} · Y {target().y.toFixed(2)}</dd>
									<dt>Current</dt><dd>{store.valueAt(target().row, target().col).toFixed(3)} mm</dd>
								</dl>
								<button class="fb-tool" disabled={probing()} onClick={() => void reprobe()}>
									{probing() ? "Probing…" : "Re-probe"}
								</button>
								<Show when={probed() !== null}>
									<div class="hm-result">
										<p class="hm-line">
											{store.valueAt(target().row, target().col).toFixed(3)} → <b>{probed()!.toFixed(3)}</b> mm
										</p>
										{/* The raw reply is shown because the trigger-height to
										    map-value conversion is not verified — a wrong formula
										    must be visible here, not after a map is corrupted. */}
										<pre class="hm-reply">{reply()}</pre>
										<div class="hm-actions">
											<button class="fb-tool ok" onClick={accept}>Accept</button>
											<button class="fb-tool" onClick={() => { setProbed(null); setReply(""); }}>Discard</button>
										</div>
									</div>
								</Show>
							</div>
						)}
					</Show>
				</Card>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
```

- [ ] **Step 5: Wire the nav entry**

Modify `packages/ui/src/shell/Shell.tsx`:

Add the import beside the other views:

```ts
import Bed from "../views/Bed.tsx";
```

Add the nav entry after `activity`:

```ts
	{ route: "bed", label: "Bed" },
```

Add the route match beside the others:

```tsx
						<Match when={route() === "bed"}><Bed /></Match>
```

- [ ] **Step 6: Add the styles**

Append to `packages/ui/src/app.css`:

```css

/* ---------- height map ---------- */
.hm-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; height: var(--ctl-h); }
.hm-msg {
	font: 400 12px/16px var(--font-body); color: var(--silk-dim);
	/* Reserved: this appears and disappears and must not move the grid. */
	min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hm-grid { display: grid; gap: 3px; align-content: start; }
.hm-dot {
	aspect-ratio: 1; width: 100%; min-width: 8px; padding: 0;
	border: 1px solid var(--hairline); border-radius: 50%;
	cursor: pointer;
}
.hm-dot:hover { border-color: var(--copper-bright); }
.hm-dot.edited { border-color: var(--ok); border-width: 2px; }
.hm-dot.selected { outline: 2px solid var(--copper-bright); outline-offset: 1px; }

.hm-detail { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.hm-result { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.hm-line { margin: 0; font: 400 13px/1.4 var(--font-body); color: var(--silk); font-variant-numeric: tabular-nums; }
.hm-line b { color: var(--copper-bright); }
.hm-reply {
	margin: 0; padding: 6px 8px; max-height: 72px; overflow: auto;
	background: var(--mask-900); border: 1px solid var(--hairline); border-radius: 5px;
	font: 400 11px/1.4 ui-monospace, "Cascadia Code", Consolas, monospace;
	color: var(--silk-dim); white-space: pre-wrap;
}
.hm-actions { display: flex; gap: 8px; }
```

- [ ] **Step 7: Typecheck and run the full suite**

Run:

```bash
cd packages/ui && npx tsc -b --force && npm test
```

Expected: typecheck clean; all tests pass.

- [ ] **Step 8: Verify against the mock**

Seed mock-duet with the real capture so there is a map to read, then load the
Bed view in a browser pointed at the MOCK (never the real board):

```bash
# from the repo root, with mock-duet running on 8970
KEY=$(curl -s "http://127.0.0.1:8970/rr_connect?password=reprap&sessionKey=yes" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s).sessionKey)))")
curl -s -H "X-Session-Key: $KEY" --data-binary @packages/mock-duet/captures/duet3-real-2026-07-15/heightmap.csv \
  "http://127.0.0.1:8970/rr_upload?name=0:/sys/heightmap.csv"
```

Confirm by eye and by measurement:
- 16×16 dots render, row 0 at the bottom.
- Clicking a dot fills the detail panel with the right X/Y (row 0 col 0 = X 5, Y 5).
- Save is disabled until an edit exists.
- No card overflows; every card height is a multiple of 4.

- [ ] **Step 9: Commit**

```bash
cd "N:/ideaprojects/dwc-ng"
git add packages/ui/src/heightmap/HeightMapGrid.tsx packages/ui/src/views/Bed.tsx \
  packages/ui/src/views/bed.panelDefaults.ts packages/ui/src/shell/router.ts \
  packages/ui/src/shell/Shell.tsx packages/ui/src/app.css packages/ui/test/panel-canvas.test.ts
git commit -m "feat(bed): height map view with single-point re-probing

Dots coloured on a diverging scale centred on zero - these are signed errors,
and a sequential ramp would read -0.10 and +0.10 as unequal. Row 0 renders at
the bottom so the bed is not drawn upside down.

Re-probe sends one operator-configured command and shows the RAW REPLY beside
the value it produced: that conversion is not verified against anything
vendored, so a wrong formula has to be visible on the first probe rather than
after a map is corrupted. Nothing reaches the card until Save, and Save is
upload + G29 S1 together."
```

---

### Task 6: Probe command setting in Settings

**Files:**
- Modify: `packages/ui/src/views/Settings.tsx`
- Modify: `packages/ui/src/views/settings.panelDefaults.ts`

**Interfaces:**
- Consumes: `setBed` and `config.bed.probePointCommand` from Task 4.
- Produces: nothing.

- [ ] **Step 1: Add the card**

Add a card to `packages/ui/src/views/Settings.tsx`, following the shape of the
existing cards in that file (read one first — they use `<Card id=… canvas=…>`
and write through `app.config.set*`):

```tsx
				<Card id="bed-probe" canvas={canvas} ariaLabel="Bed probing" title="Bed probing" tip="height map re-probe">
					<p class="job-empty">
						Sent to re-probe one height-map point. <code>{"{x}"}</code> and <code>{"{y}"}</code> become
						the point's bed coordinates. The motion belongs in your macro, not here.
					</p>
					<input
						class="fb-input grow"
						value={app.config.config.bed.probePointCommand}
						aria-label="Probe point command"
						onInput={e => app.config.setBed({ probePointCommand: e.currentTarget.value })}
					/>
				</Card>
```

Add its placement to `packages/ui/src/views/settings.panelDefaults.ts`,
choosing a `row`/`rowSpan` that does not overlap the existing entries (the
collision test will catch it if it does):

```ts
	{ id: "bed-probe", col: 12, row: 108, colSpan: 12, rowSpan: 40 },
```

- [ ] **Step 2: Run the collision test and the suite**

Run: `cd packages/ui && npx tsc -b --force && npm test`
Expected: typecheck clean; `Settings view's default panel layout is collision-free` passes along with everything else.

- [ ] **Step 3: Commit**

```bash
cd "N:/ideaprojects/dwc-ng"
git add packages/ui/src/views/Settings.tsx packages/ui/src/views/settings.panelDefaults.ts
git commit -m "feat(settings): edit the height-map probe command

A wrong default is fixed here rather than in a release."
```

---

### Task 7: Update the parity document

**Files:**
- Modify: `docs/dwc-parity.md`

- [ ] **Step 1: Update the two rows**

In §8, replace the height-map row:

```markdown
| **Height map** (`G29` mesh visualisation) | ✅ (`HeightMap` plugin) | ✅ | `views/Bed.tsx` — and above DWC: single-point re-probing, which the plugin cannot do |
```

In the P2 backlog, mark the height map done and note what remains:

```markdown
8. ✅ **Height map** viewer with single-point re-probing (2026-07-21). The
   trigger-height → map-value conversion is calibrated against the machine on
   first use; see the design doc.
```

- [ ] **Step 2: Commit**

```bash
cd "N:/ideaprojects/dwc-ng"
git add docs/dwc-parity.md
git commit -m "docs(parity): height map done, above DWC's read-only plugin"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Client-side CSV round-trip | 1, 3 |
| Derived header statistics | 1 (test: "statistics are DERIVED") |
| Geometry passes through unmodified | 1 (round-trip test) |
| `save` = upload + `G29 S1` | 3 (test: "uploads AND reloads") |
| Pending edits, one upload for many | 3 |
| Grid of dots, diverging colour scale | 5 |
| Click dot → detail → re-probe → accept/discard | 5 |
| Probe command as config template | 4, 6 |
| Unverified conversion isolated + raw reply shown | 2, 5 |
| Own nav entry "Bed" | 5 |
| Nothing writes until Save | 3, 5 |
| Testing table | 1, 2, 3 (view is manual, per spec) |

No spec requirement is unimplemented.

**Placeholder scan:** none — every step carries its actual code or exact command.

**Type consistency:** `HeightMap`/`HeightMapMeta` (Task 1) are consumed with
those names in Tasks 3 and 5. `OpResult` is imported from `../files/browser.ts`,
where it already exists. `parseProbeReply` returns `ProbeResult | null` in both
Task 2 and its use in Task 5. `pending()` is a `Map` keyed `"row,col"` in Task 3
and read with that key shape in Task 5's `isEdited`.

**Known risk, deliberately left in:** Task 1 Step 4 may need formatting
reconciliation against the real capture — the plan says to fix `cell()` rather
than weaken the test, and records the one condition under which relaxing it is
legitimate.
