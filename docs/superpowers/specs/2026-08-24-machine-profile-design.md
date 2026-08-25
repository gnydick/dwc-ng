# The machine profile — the app must know the machine it drives, and say what it does not

Campaign design, 2026-08-24. Issue set #76 / #77. Companion to
`2026-08-23-shaping-interpretation-layer-design.md` (which made the tool say what
its readings MEAN) — this one supplies the machine facts without which several of
those statements are unsayable or wrong.

## Problem

The app has a config file of per-feature preferences, a live object model it
reads a thin slice of, and a large body of code that assumes the rest. The
inventory is in #76 and #77 and is not re-derived here; two consequences frame
the design.

**The failure mode is a confident wrong answer.** `compose/services.ts:717` maps
machine axis to accelerometer column as `family.axis === "Y" ? 1 : 0` (repeated
`shaping/worker.ts:98`, `charts/decayData.ts:211`). RRF reports the mounting as
`boards[n].accelerometer.orientation`, typed at `om/types.ts:219-227` and read
nowhere in production code — verified by grep: the only two occurrences in
`packages/ui/src` are a Card Lab fixture (`dev/cardScenarios.ts:87`) and a doc
comment (`shaping/accelReport.ts:5`). **Gabe's four toolboards report
`orientation: 41`, not the RRF default of 20** — verified in
`packages/mock-duet/captures/duet3-real-2026-07-15/model/verbose-boards.json`,
all four TOOL1LC entries at CAN 20–23. Per `reference/duet-gcode.md` M955 notes,
41 means the chip's Z faces machine −X and its X faces machine +Y. Whether that
already reaches the CSV as machine axes is **open question 2**; what is certain
is that the app never asks.

**Nothing is keyed by machine, so a second Duet inherits the first one's
envelope.** `CONFIG_CACHE_KEY = "dwc-ng.config"` (`config/types.ts:313`) is
origin-global, and `loadFromMachine` deliberately refuses to clobber the cache
with the SD copy (`config/store.ts:517-534`). An envelope is a box the head is
driven inside at 200 mm/s. Inheriting one across machines is a crash, and nothing
in the app would question it. **This is the safety headline and Phase 1 exists to
remove it.**

## Ruling (Gabe, 2026-08-24)

> "at this point we need a survey for users for initial setup. kinematics,
> sensors, etc are going to start really impacting code and safety"

Said in answer to a question about #49's approach leg, and it redirects that
ticket: the "approach leg gated on optional dock sensors" design is not to be
built. "Is this park position a dock?" is a profile question.

## The precedent being generalised

Two facts in the tree already follow the rule this campaign extends to all of
them, and neither was invented for it:

- `config/types.ts:209-231` — `envelope` ships as `null` and no code path derives
  one from the object model's axis limits. *"A guessed extent — axis limits, a
  shipped default, a half-entered box — is a crash into the frame."* The OM
  **does** carry `move.axes[].min/max` (`om/types.ts:26-27`; verified on the wire
  as X −98.2 … 401.4), which is precisely why the refusal to use them is a
  decision rather than an absence.
- `bed/levelPlan.ts:118-124` — `zDirection` is a required input, *"not assumed:
  it depends on the machine's drive directions, and guessing it wrong drives the
  bed INTO the probe."*

Generalised: **a fact this app cannot read is a fact this app does not have.**
Reading a value and asserting it are different acts. The profile is the place
where the difference is recorded rather than lost.

## 1. The fact set

`R` = read from the object model. `C` = read, then confirmed by the operator
because code branches on it. `S` = supplied by the operator; nothing can read it.
`U` = not obtainable by any route this app has.

### Identity

| Fact | Class | Source | Note |
|---|---|---|---|
| `boardId` | R | `boards[i].uniqueId` where `canAddress` is 0 or absent | Verified present on all six boards of the real capture. **Not typed today** — `Board` (`om/types.ts:230-252`) has no `uniqueId`; it survives to the store only because `conformBoard` (`om/types.ts:470-471`) spreads `...entry`. |
| `boardModel` | R | `boards[i].shortName` — `"MB6HC"` | A model, never an instance. |
| `machineName` | C | `network.name` — `"Duet 3"` | M550. Display only; identity never keys off it. |
| `firmware` | R | `boards[i].firmwareVersion` — `"3.6.3"` | |

### Geometry and motion

| Fact | Class | Source | Note |
|---|---|---|---|
| `kinematics` | C | `move.kinematics.name` — `"coreXY"` | On the wire (verified, `verbose-move.json`). **Zero references in `packages/ui` or `packages/connector`**; the single hit in the repo is mock-duet's generator, `packages/mock-duet/src/snapshot.ts:218`. |
| `axes[].letter/min/max/visible/homed` | R | `move.axes[]` (`om/types.ts:21-45`) | 7 axes on this machine. |
| `axes[].stepsPerMm`, `.microstepping` | R | `om/types.ts:43-44` — optional, and honestly so | Already read through `shaping/fullStep.ts`. |
| `axisRoles` | S | operator only | Exists: `UiConfig.axisRoles`. RRF has no notion of axis roles. |
| `planarPair` | C | derived from `kinematics` + `axes`, confirmed | The two axes the shaping lab measures. Today baked as `PLANAR_AXES` (`shaping/procedure.ts:71`) and `Axis = "X" \| "Y"` (`shaping/engine/fit.ts:332`). |
| `envelope` | S | operator only | The existing precedent. Never derived from `min`/`max`. |
| `travelAcceleration` | R | `move.travelAcceleration` (`om/types.ts:120-133`) | Already nullable-and-refused: `Refusal.no-acceleration`. |
| `axes[].current/.percentCurrent/.acceleration/.jerk/.phaseStep` | R | `move.axes[]` — **on the wire, untyped** | Verified: axis 0 carries `current: 2000`, `acceleration: 24000`, `jerk: 1200`, `percentCurrent: 100`, `phaseStep: false`. #47's baselines. |

### Tools

| Fact | Class | Source | Note |
|---|---|---|---|
| `toolNumbers` | C | `tools[].number` — `[0,1,2,3]` here | `M563 P3` with no P0–P2 is legal RRF. `compose/services.ts:384` opens the lab on 0; `:789-793` invents `[0]` when the machine reports none. |
| `toolAxes`, `toolOffsets` | R | `tools[].axes`, `tools[].offsets` — verified on the wire, `[40.273,-2.935,-1.05,0,0,0,0]` for T0 | Neither typed in `Tool` (`om/types.ts:154-164`). |
| `isToolChanger` | C | hinted by tool count + `tfree/tpre/tpost` presence; asserted | #51. |
| `toolChangeSeconds` | S | operator only | #51. |
| `toolMustBeHotToRelease` | S | operator only | #51. Safety-relevant: a cold release can tear a hot end off its mount. |
| `dockPosition[tool]` | S | operator only (see open question 3) | **#49 cause 2 depends on exactly this.** |
| `dockSensor[tool]` | S | `UiConfig.dockSensors` (`config/types.ts:27-32`) | Exists; consulted by one coloured dot at `cards/ToolsHeatersCard.tsx:52-59` and by nothing in a motion path. |

### Accelerometers

| Fact | Class | Source | Note |
|---|---|---|---|
| `accelPresence[board]` | R | `boards[n].accelerometer !== null` + `canAddress` | Already gated: `conformAccelerometer` via `conformBoard`. |
| `accelOrientation[board]` | C | `boards[n].accelerometer.orientation` — **41 on this machine** | Read nowhere. Honoured or refused; never silently mapped. |
| `accelAddr[site]` | S | `ShapingConfig.accelByTool` (`config/types.ts:236`) | **Keyed by tool number**, so a machine with no tools cannot map an accelerometer and therefore cannot be measured at all. Re-keys onto a measurement site in Phase 3. |
| `accelRateHz`, `accelBits`, `accelSensor` | R | `M955 P<addr>` reply, parsed by `shaping/accelReport.ts:46-64` | **Not in the object model at all** — stated at `accelReport.ts:4-8`. Ephemeral: the desired figures are held as UI text (`cards/SettingsCards.tsx:452-453`) and lost on reload, while M955's S persists on the board (`shaping/runner.ts:135-138`). |
| `accelGRange` | U | nothing reports it; M955 has no parameter for it (`reference/duet-gcode.md`, M955 parameter list) | Stays `unknown` forever unless the operator supplies it. #61 wants it; it must refuse, not assume. |

### Heat, probe, filament

| Fact | Class | Source | Note |
|---|---|---|---|
| `heaters`, `bedHeaters`, `chamberHeaters` | R | `heat.*` (`om/types.ts:147-151`) | |
| `bedHasStandby` | S | operator only | Gabe's bed has none; today that is code, not config. |
| `probes[]` type, `triggerHeight` | R | `sensors.probes[]` (`om/types.ts:334-351`) — verified: two probes, `type: 8` | |
| `zDirection` | S | operator only | The existing precedent (`bed/levelPlan.ts:118-124`). |
| `filamentDiameter[extruder]` | R | `move.extruders[].filamentDiameter` (`om/types.ts:48-52`) | |

## 2. `unknown` is an arm, and a fact cannot be added without deciding it

```ts
/** Every fact the profile can hold. The key set IS the fact set. */
export interface FactValues {
	readonly boardModel: string;
	readonly machineName: string;
	readonly kinematics: string;
	readonly planarPair: readonly [string, string];
	readonly envelope: Envelope;
	readonly toolNumbers: readonly number[];
	readonly accelOrientation: Readonly<Record<string, number>>;
	readonly accelGRange: number;
	readonly zDirection: 1 | -1;
	// …one line per row of §1
}
export type FactId = keyof FactValues;

/** Why a fact is not held. Each arm is a different remedy. */
export type UnknownCause =
	/** Fresh machine; nobody has been asked yet. */
	| { readonly kind: "never-asked" }
	/** This firmware does not carry it. Names the path we looked at. */
	| { readonly kind: "not-in-model"; readonly path: string }
	/** Carried, but unusable — the board said something this build cannot read. */
	| { readonly kind: "not-readable"; readonly path: string; readonly raw: string }
	/** Nothing anywhere reports it; only a human can state it. */
	| { readonly kind: "operator-only" }
	/** The model now disagrees with what was confirmed. The machine changed. */
	| { readonly kind: "conflicted"; readonly was: string; readonly now: string };

/** How a fact came to be held. There is no fifth way, and no default. */
export type Fact<T> =
	| { readonly known: "read";      readonly value: T; readonly from: string; readonly at: number }
	| { readonly known: "confirmed"; readonly value: T; readonly from: string; readonly at: number }
	| { readonly known: "supplied";  readonly value: T; readonly at: number }
	| { readonly known: "unknown";   readonly why: UnknownCause };

/** A profile is TOTAL over the fact set — a mapped type, not a partial record. */
export type MachineProfile = { readonly [K in FactId]: Fact<FactValues[K]> };
```

`MachineProfile` being a **mapped type over `FactId`** is the whole mechanism.
Adding a key to `FactValues` makes every existing profile literal a compile
error until an arm is written for it, and `Fact` has no default arm, so the only
way to satisfy the compiler cheaply is to spell `{ known: "unknown", why: … }` —
i.e. to *decide* the unknown case. A fact cannot be silently absent because
absence is not representable.

`@rung 8` — illegal state unrepresentable. This is stronger than the `never`-armed
switch the tests require, which is also present and does the second job:

```ts
/** One sentence per fact, in the operator's vocabulary, saying what is missing
 *  and where to supply it. Exhaustive by compilation, exactly as
 *  `refusalText` is over `Refusal` (shaping/copy.ts:68). */
export function gapText(id: FactId, why: UnknownCause): string {
	switch (id) {
		case "envelope": return "no motion box set for this machine — Settings › Input shaping";
		case "kinematics": return "the machine has not said what kinematics it runs";
		// …
		default: { const _never: never = id; return _never; }
	}
}
```

And reading is total the same way, so a new fact cannot be added without deciding
how it is read (or explicitly recording that it cannot be):

```ts
export const READ_FACT: { readonly [K in FactId]: (om: ObjectModel) => Fact<FactValues[K]> } = { … };
```

`freshProfile()` is the mapped identity: every fact `{ known: "unknown", why:
{ kind: "never-asked" } }`. That is what a fresh machine reads, and the test
asserting it is one deep-equal.

## 3. Machine identity

**Proposal: identity is `boards[i].uniqueId` for the board whose `canAddress` is
0 or absent.**

Verified present: `"0JDAM-9F6NU-F05S0-7JKDJ-3SD6T-1SWQ1"` on the MB6HC, and a
distinct one on each of the five expansion/tool boards
(`packages/mock-duet/captures/duet3-real-2026-07-15/model/verbose-boards.json`).
It is factory-programmed into the MCU: it survives firmware updates, config
rewrites, hostname changes, IP changes and SD card swaps. It is not
user-editable, which is what makes it usable as a key.

**What is rejected, and why.**

- `onBoardInfo({emulated, boardType, transport})` (`packages/connector/src/types.ts:51`)
  is neither stable nor unique. `boardType` is a model. `transport` and
  `emulated` describe *which dialect answered this session* — the same machine
  reached over `rr` and over `dsf` would key differently, which is worse than no
  key at all. **No identity is added to the connector interface.** Identity is a
  model fact, and the connector's job is to deliver the model; putting it on the
  connector would need implementing twice and could drift between them
  (memory: `dsf-and-rr-both-always`).
- `network.name` (`"Duet 3"`) and `network.hostname` (`"duet3"`) are set by M550
  and are exactly the kind of thing an operator renames. Display, never key.
- `boards[].shortName` (`"MB6HC"`) identifies a model. Two identical Duets would
  collide. Useful only as a sanity check on a claimed profile.

**Storage falls out of the physics.** The SD card *is* the machine. A profile
written to that board's own card cannot be read by a browser talking to a
different board, because the file is not on the other board's card. So the
authoritative machine profile is SD-resident and needs no key to be safe — the
medium enforces the scoping. `@rung 8`: cross-machine leakage through the SD
route is unrepresentable.

**The hazard is entirely the localStorage cache**, which is origin-global and is
seeded *before* the SD read lands, and which `loadFromMachine` deliberately
refuses to overwrite (`config/store.ts:519-524`, for a good reason: unsaved local
edits). So:

- machine-scoped cache key becomes `dwc-ng.machine.<uniqueId>.config`;
- **machine-scoped state is not applied until identity is known.** Boot applies
  person config only. Every machine fact reads `unknown` until
  `onModelKey("boards")` lands (`PollConnector.ts:190-204` fetches every seqs key
  at full sync, `boards` among them) and the id resolves; then the machine half
  hydrates from its own key.

The cost is real and is stated rather than hidden: for roughly one poll cycle
after every reload, the envelope is `unknown` and the Shaping card refuses. That
is the right trade — a refusal that clears in a second, against an envelope
belonging to a different machine. **Open question 5** puts it to Gabe anyway.

**When identity is unavailable:**

```ts
export type MachineId =
	| { readonly kind: "board"; readonly uniqueId: string }
	| { readonly kind: "unidentified"; readonly why: string };
```

An `unidentified` machine gets **no local machine cache at all** — SD is its only
store, and every operator-supplied fact reads `unknown` until that file loads.
Safe by construction: there is no key under which anything could have been saved
for it, so there is nothing to inherit. (Whether an operator may instead name it
by hand is **open question 4**.)

**When identity changes** — a mainboard swap, or an SD card moved to a different
board — the key changes, so the profile is fresh and every fact is `unknown`.
That is correct. But the SD file travelling with the card is not: it stamps the
`machineId` it was written under, and on load a mismatch makes the profile
**claimed, not adopted**. Every fact from it renders as read-from-file with the
mismatch flagged, and the aggregate view says *"this profile was written for
board X; this is board Y — confirm it or clear it."* Not silently adopted (that
is the bug), not silently discarded (that loses a real machine's real settings).

## 4. The machine / person split

The rule that decides every row: **if the key space belongs to the machine, the
section belongs to the machine.** A colour keyed by heater index is a fact about
which heater, not about which colour is nice.

| `UiConfig` section | Scope | Why |
|---|---|---|
| `axisRoles` | **machine** | Names *this* machine's U/V/W. Meaningless elsewhere. |
| `heaterColors` | **machine** | Keyed by heater index. Heater 3 here is not heater 3 there. |
| `thermalColors` | person | cold/warm/hot palette; no machine key. |
| `dockSensors` | **machine** | gpIn indices, per tool number. Safety-relevant. |
| `camera.streamUrl` | **machine** | That machine's camera. |
| `camera.pinned` | person | A viewing habit. **This section serves two masters and is split.** |
| `sensorNames` | **machine** | Keyed `"probe:0"` — machine slot indices. |
| `macros.autoConfirmRun` | person | A habit about confirmations. |
| `bed.probePointCommand` | **machine** | Names a macro path on that card and drives the probe. |
| `screens.custom/renames/hidden` | person | A person's screen set. |
| `screens.layouts` | person *(provisionally)* | #76 says origin-global; CLAUDE.md says "4 layouts per machine". **Open question 1.** |
| `cards` | person | User-authored card definitions. |
| `pins` | **machine** | A pin *re-sends G-code on an interval*. `"fan:<n>"` keys are machine indices. A pin from machine A firing at machine B is an unasked-for command at a machine nobody aimed it at. |
| `shaping` (all of it) | **machine** | `envelope` is the safety headline; `accelByTool` is hardware addressing; `defaults` is one machine's mass (#61). |

localStorage, from the verified key list: `dwc-ng.canvas.<screenId>`,
`dwc-ng.scale` (`shell/scale.ts:44`), `dwc-ng.theme` (`shell/theme.ts:47`),
`dwc-ng.nav-hidden`, `dwc-ng.speed-flow-mode`, `dwc-ng.camera-view` and the
`dwc-ng.lab-*` dev keys stay **person**. `dwc-ng.drafts` (`editor/drafts.ts:29`)
is **machine** — those are drafts of files on that card. `dwc-ng.cmdHistory`
(`om/commandHistory.ts:17`) and `dwc-ng.console` (`om/consoleLog.ts:73`) are
**open question 6**.

### The migration

`CONFIG_VERSION` goes 2 → 3 (`config/types.ts:315`), with a v2→v3 arm added to
`parseOverlayPayload` (`config/parse.ts:359-375`), following the shape of the
existing v1→v2 column migration (`config/parse.ts:326-355`: a transform on the
RAW json, ahead of `parseOverlay`, that cannot throw on a hand-mangled file).

**What it does with existing config that has no machine attached — two different
answers, because the two artefacts carry different evidence.**

- **The SD file** (`0:/sys/dwc-ng-config.json`, `config/types.ts:311`) is
  self-attributing. Reading it over a connection to board X *is proof* it is
  board X's config, because it came off board X's card. So: split the v2 overlay,
  stamp the machine half with the currently connected `MachineId`, write v3 back.
  No operator action, no possibility of leakage.
- **The localStorage copy** (`dwc-ng.config`) carries no such proof — it is the
  one artefact whose machine is genuinely unknown, and it is the exact mechanism
  by which a second Duet would inherit an envelope. So: **keep the person half,
  drop the machine half.** It is restored from SD one poll later, on the machine
  it actually belongs to. Cost: one boot with machine facts `unknown`. Benefit:
  the crash is not reachable.
- The drop is **recorded, not silent** — the aggregate view carries a line saying
  machine settings from before the update were not attached to a machine and were
  re-read from this board's card. Anything else is a settings screen that quietly
  forgot something.

A v3 payload that is somehow read on the wrong machine is caught by the stamp
(§3, "claimed, not adopted"). Foreign or future versions still fall through to
defaults, never a boot failure (`config/parse.ts:373-374`).

## 5. How a feature asks

```ts
export type Gap = { readonly fact: FactId; readonly why: UnknownCause };
export function require<K extends FactId>(p: MachineProfile, id: K): Result<FactValues[K], Gap>;
```

`Refusal` (`shaping/preconditions.ts:30-66`) gains **one** variant, not one per
fact:

```ts
| { readonly kind: "unknown-fact"; readonly gap: Gap }
```

and `refusalText`'s new arm delegates to `gapText`. One variant per fact would put
the fact set in two places, and two places drift — the hazard the interpretation
spec names for caveats. The existing `no-envelope` variant becomes exactly
`unknown-fact({fact: "envelope"})` in Phase 2, a mechanical rename that the
compiler drives, with `gapText("envelope")` carrying the sentence that already
works. `no-accelerometer` follows in Phase 3 when `accelByTool` re-keys. Nothing
else about `Refusal` changes, and none of the working copy is churned early.

### The aggregate view

**A `machine-profile` card on the System screen** (`SYSTEM_COMPOSITION`,
`compose/screens.ts:116-123`, beside `firmware` and `object-model`). System is
where "what is true about this machine" already lives; Settings is where things
are changed. It answers the question that today has no answer anywhere:

- **Which machine this is** — board model, unique id, machine name, firmware, and
  whether the profile was adopted or claimed.
- **Every fact in §1**, one row each, with its provenance chip: `read` /
  `confirmed` / `supplied` / `unknown`, and where a read fact came from (the OM
  path), so a wrong-looking number can be traced without the OM inspector.
- **Every unknown**, with `gapText`'s sentence and what it blocks — "no motion
  box: the Shaping lab will not move the head" — and a link to the one place it
  is supplied. A fact that blocks nothing says so; that is a legitimate answer and
  distinguishes "not needed here" from "nobody has asked".
- **The migration note**, when the v2 machine half was dropped.

**A first-run flow is deliberately not built.** There is none today — the only
recognition of a fresh machine is a swallowed error at `config/store.ts:529-530`
— and a modal on connect is the wizard #76 forbids. Instead the preflight strip
(`shell/Shell.tsx:111`, already the app's idiom for "something about this machine
needs attention") gains one chip when a **safety-relevant** fact is unknown,
linking to the card. A fresh machine is not broken; it is unsurveyed, and every
feature already refuses individually and now says why.

## 6. The survey

The same card, in fill mode. Not a separate screen, not a wizard, and it hides
nothing: the Settings cards keep their editors and the survey **links to them**
rather than duplicating the fields, because two editors for one value is how they
come to disagree.

**Shown read-only for confirmation** — nothing here is ever re-typed: kinematics
name; axis letters with min/max/stepsPerMm/microstepping/drivers; tool numbers,
names, axes and offsets; boards with CAN address, model, firmware and
accelerometer presence and orientation; heaters with bed/chamber assignment;
probes with type and trigger height; extruder filament diameters; machine name
and firmware version.

**Confirmed** (read, but the operator must assert it because code branches on
it): `kinematics`, `planarPair`, `toolNumbers`, `accelOrientation`,
`machineName`, `isToolChanger`.

**Asked** (nothing can read it): `envelope`, `axisRoles`, `dockPosition[tool]`,
`dockSensor[tool]`, `accelAddr[site]`, desired `accelRateHz` and `accelBits`,
`accelGRange`, `toolChangeSeconds`, `toolMustBeHotToRelease`, `bedHasStandby`,
`zDirection`, `camera.streamUrl`.

**Re-entry** is always System › Machine profile, and every refusal's remedy link
lands there or on the Settings card that owns the field. A confirmation records
its timestamp, so a later `conflicted` cause can say *what* changed and *when* it
was last agreed.

## 7. Phasing

Each phase is shippable and gets its own ticket pair against this spec.

| Phase | Contents | Unblocks |
|---|---|---|
| **1 — Identity and the split** | `uniqueId` typed on `Board` and gated in `conformBoard`; `MachineId` resolution; machine-scoped cache key; `UiConfig` split machine/person per §4; v2→v3 migration; a System card naming which machine this is. No new facts, no survey. | Removes the safety headline on its own. |
| **2 — The fact set and the gap view** | `MachineProfile` mapped type, `Fact`/`UnknownCause`, `READ_FACT`, `never`-armed `gapText`, `Refusal.unknown-fact`, `no-envelope` folded in. Read half populated from the OM including `move.kinematics` and `accelerometer.orientation`, typed for the first time. Card in read mode; preflight chip. | The "what don't I know?" requirement. |
| **3 — The survey, and the operator's facts** | Fill mode. `accelByTool` re-keyed off tool number onto a measurement site. Desired accel rate/resolution become facts instead of ephemeral text (`cards/SettingsCards.tsx:452-453`). Tool numbers confirmed; `services.ts:384` and `:789-793` stop inventing tool 0. | **#35** (which tools exist, at all). **#61**, accelerometer half. |
| **4 — Cartesian stated and checkable** | `kinematics` + `planarPair` required at every shaping entry point, *upstream* of any type that says X/Y. `GcodeViewer.tsx:77-83`'s silent 150/150 fallback becomes a refusal. `captures.ts:72-75`'s unmatched-name default already carries `matched`; it becomes a stated `unknown` instead of a shown default. `orientation !== 20` honoured or refused at `services.ts:717`, `worker.ts:98`, `decayData.ts:211`. | The out-of-scope line below. |
| **5 — Dock and tool geometry** | `dockPosition[tool]`, `isToolChanger`, `toolChangeSeconds`, `toolMustBeHotToRelease`. `dockSensors` gains its first motion-path consumer. | **#49 cause 2**. **#51**. |
| **6 — Drive parameters** | `move.axes[].current/.acceleration/.jerk/.percentCurrent/.microstepping/.phaseStep` typed and held as facts with their baselines. | **#47**. **#61**, drive half. |

**Phase 1 is the smallest independently useful thing**: it makes it impossible
for a browser pointed at a second Duet to inherit the first machine's envelope,
and it ships without a single new fact, without the survey and without any UI
beyond one read-only card. Everything after it adds facts to a structure that
already exists.

## 8. Out of scope, and what "stated and checkable" means

**Non-Cartesian shaping.** `Axis = "X" | "Y"` (`shaping/engine/fit.ts:332`),
`PLANAR_AXES` (`shaping/procedure.ts:71`) and `Envelope{x,y}`
(`config/types.ts:182-185`) are untouched. Relaxing them is a redesign of the
fingerprint, and letting it in here would eat the campaign.

Concretely, for a delta:

- **Stated** — `kinematics` is a fact with the value `"delta"`, read from
  `move.kinematics.name` and confirmed. It is written down, dated, and visible on
  the profile card. Today the app has no place to write it and no code that looks.
- **Checkable** — every entry point to a shaping run calls `require(profile,
  "kinematics")` and `require(profile, "planarPair")` **before a plan exists**,
  i.e. upstream of every type that says X or Y, and refuses: *"this machine
  reports `delta`; the shaping lab measures a two-axis plane and cannot express a
  delta's three towers — nothing has been measured."* The narrow type stays
  narrow; the gate that keeps unrepresentable machines away from it is a profile
  question with a sentence.
- **The falsifying test** asserts *the sentence*, not the predicate, from a
  profile whose kinematics is `delta`. A delta that measured a plausible X/Y
  fingerprint would be the campaign's own failure mode reproduced.

Also out of scope: adopting object-model values as facts without confirmation
(reading and asserting are different acts); a wizard that hides the Settings
cards; per-machine layouts (that is the CLAUDE.md "4 layouts per machine" line
and it is a layout campaign, gated on open question 1).

## Verification of the two flagged items

**`limits` is NOT fetched at runtime. Confirmed.** `PollConnector` enumerates the
keys to fetch from `seqs` (`PollConnector.ts:192-196`, `:219-222`), minus
`SKIPPED_KEYS` (`:75`) and `NON_MODEL_SEQS` (`:77`). The real board's `seqs`
carries `boards, directories, fans, global, heat, inputs, job, ledStrips, move,
network, sensors, spindles, state, tools, volumes` — **no `limits`**
(`packages/mock-duet/captures/duet3-real-2026-07-15/model/live-d99fn.json`,
`result.seqs`). So `limits.reportedAxes` is never in the store, which is exactly
why the workaround at `PollConnector.ts:553-573` re-fetches `move.axes`
unconditionally rather than gating on it — the comment there is describing why it
gave up on `limits`, not asserting that it has it. Nothing in the profile may
depend on `limits`; axis extents come from `move.axes[].min/max`, and are read
for display only, never for the envelope.

**`move.kinematics` does survive into the store at runtime, but is not reachable
statically. Confirmed, with a correction.** The `move` arm of `conformModelKey`
spreads `...value` (`om/types.ts:552-568`), so `kinematics` reaches the store
untouched. But the model is open only at its **root** — `ObjectModel = KnownModel
& Record<string, unknown>` (`om/types.ts:373`) — and `move` is typed as the closed
interface `Move` (`om/types.ts:113-134`), which has no `kinematics` field. So
`om.move.kinematics` is a **compile error today**; the value is present and
unreachable. Phase 2 adds the field to `Move` and an `emptyModel` default, per
the `om-entry-shape-gate` invariant (`om/types.ts:473-497`). The same is true of
`boards[].uniqueId` (`Board`, `om/types.ts:230-252`), `tools[].axes` and
`tools[].offsets` (`Tool`, `om/types.ts:154-164`), and every drive parameter on
`move.axes[]`: on the wire, in the store, invisible to the compiler.

Two smaller corrections to the inventory, in the interest of not designing
against a stale tree:

- `shaping/captures.ts:72-75` no longer *silently* defaults. `captureNameParts`
  returns `matched: boolean` alongside the `axis:"X", dir:"+", rep:0` fallback,
  and the doc comment says the card uses it to decide whether the axis is a
  reading or a default. The default is still shown as if it were a fact, which is
  what Phase 4 changes; but the mechanism to say so is already there.
- `boards[n].accelerometer.orientation` is *parsed* nowhere, but the M955 reply
  text is, by `shaping/accelReport.ts` (added 2026-08-24), which is where the rate
  and resolution come from. That file's header states plainly that the OM does not
  carry the rate — the profile inherits that constraint rather than fixing it.

## Tests required (from #76, made concrete)

- A profile keyed to machine A is not visible to a session on machine B —
  driven through the cache key, with the SD route asserted separately.
- `freshProfile()` deep-equals every fact `unknown/never-asked`; a fact added to
  `FactValues` without an arm fails to compile (red-check: delete one arm).
- `gapText` is `never`-armed over `FactId`; `refusalText` still `never`-armed over
  `Refusal` after `unknown-fact` lands.
- Reading `packages/mock-duet/captures/duet3-real-2026-07-15/` populates the
  read-only half: `kinematics: "coreXY"`, 7 axes, tools `[0,1,2,3]`, six boards,
  four accelerometers at `orientation: 41`, two probes of `type: 8`.
- A profile with `accelOrientation: 41` either honours it or refuses; never
  silently maps as if 20.
- v2→v3: an SD payload keeps its machine half stamped with the connected id; a
  cached payload keeps only its person half, and the drop is reported.
- A v3 SD payload stamped for a different `machineId` renders claimed, and none
  of its facts reach a motion path until confirmed.

## Open questions (Gabe)

1. **Layouts:** CLAUDE.md says "4 layouts per machine"; #76 says layouts stay
   origin-global. Per machine, or per person?
2. **Accelerometer orientation:** your four toolboards report `I41`, not the
   default 20. Does RRF's `M956 X/Y/Z` already hand back machine-axis columns
   (making the app's `axis === "Y" ? 1 : 0` right by accident), or must the app
   apply the orientation itself? I cannot settle this from the docs; the
   falsifying test is one capture with the head excited along +X only.
3. **Dock positions:** type them in per tool, or parse them out of your
   `tfree<N>.g`/`tpost<N>.g` and ask you to confirm what was found?
4. **A board with no `uniqueId`:** refuse machine-scoped local settings entirely
   (SD only), or let you name the machine yourself and accept that names collide?
5. **The one-poll gap:** after this lands, machine facts read `unknown` for about
   one poll cycle after every reload, so the Shaping card refuses for ~1 s.
   Acceptable, or do you want the last-seen machine's cache applied optimistically
   (which re-opens a narrow version of the inheritance hole)?
6. **`dwc-ng.cmdHistory` and `dwc-ng.console`:** machine-scoped (that machine's
   traffic) or person-scoped (your habits)?
