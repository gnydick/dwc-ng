# Tool presence — the topology is a survey answer, and "docked" is not "mounted"

Campaign design, 2026-08-24. Issue set #76 / #77, **Phase 5**. Companion to
`2026-08-24-machine-profile-design.md` (which said a fact this app cannot read is
a fact this app does not have) and `2026-08-23-shaping-interpretation-layer-design.md`
(which said a product that exists is not a product that is valid). This one
answers the question those two leave open for a toolchanger: **before the app
authors a move of its own, what does it actually know about what is hanging off
the carriage?**

## Problem

Phase 5 as written in the profile spec assumes a schema it should have been
asking about. `dockSensors` (`config/types.ts:253`) is
`Record<string, DockSensorRef>` — tool number to one gpIn index — and that is not
a general model of tool presence sensing. It is **one machine's wiring, promoted
to a type.** Every other wiring the ruling names is either unrepresentable or
representable only by lying about what the sensor measures.

The type already half-admits it. The comment above the field
(`config/types.ts:251-252`) reads *"The sensor knows docked/away, never
'mounted' — label accordingly"*, and the editor's hint repeats it
(`cards/SettingsCards.tsx:191-194`). Two places in the tree state the
distinction; nothing in the tree can express it.

## Ruling (Gabe, 2026-08-24)

> "when there are no docking sensors or tool engagement sensor, you're not going
> to know if the tool is docked or undocked. you'll have to ask the user what
> kind of sensors they have for which purpose and whether it's per tool or per
> gantry, for example, it's possible to have a docking sensor and engagement
> sensor on each tool or just a docking sensor, or just an engagement sensor, or
> just a mounted sensor on the gantry. you'll have to work that all out with the
> user to figure out the logic and last, if they have no sensors, you'll have to
> ask them to confirm before each operation, or like the other tools, give them a
> checkbox to 'autoconfirm' the movement"

Three things follow, and each invalidates a line of the profile spec's Phase 5
row (`2026-08-24-machine-profile-design.md:423`):

1. **Sensor topology is itself a fact** — class `S`, operator-only, and a
   *structured* one, not a scalar. It is not `dockSensor[tool]`.
2. **Docked and engaged are two different facts.** The config conflates them by
   having only one.
3. **No sensors is a legitimate, supported answer**, and its remedy is a confirm
   with an autoconfirm opt-out, explicitly modelled on `macros.autoConfirmRun`.

## Decided (Gabe, 2026-08-24)

Four of §6's nine questions are answered. Each is recorded with the consequence
it forces, because three of the four **change a verdict elsewhere in this
document** rather than merely filling a blank. The five that remain open are
still marked open in §6.

**Q1 — what an "engagement sensor" senses: "tool present on the carriage", not
"coupler locked".** Gabe chose the present-on-carriage reading as *the*
definition, so it is what this design builds on — not a per-machine variable to
be surveyed later. **Consequence: partial engagement is undetectable in every
topology in §2.1.** A tool that has touched down on the carriage but is not
latched asserts the sensor, because touching down is what the sensor measures.
§3.2 row C is demoted accordingly: it is no longer a topology in which Q3 is
MEASURED without qualification.

**Q2 — Gabe's machine has dock sensors only.** There is no switch reading the
coupler. Engagement is not sensed at all, and the C axis (`G1 C0` locked /
`G1 C121` open) is a commanded stepper position that §1.5 has already refused as
a measurement. **Consequence: Gabe's own toolchanger is topology A,
permanently** — not "A until a coupler switch gets wired". Every verdict in
§3.2 row A is therefore a verdict about the machine this feature is being built
and verified on. §3.2 A′ states what that means for #49's approach leg.

**Q3 — `state.currentTool` is evidence, never proof.** It **may narrow** a
confirm — *"about to move with T2 held"* rather than *"unknown tool"* — and it
may **never skip** one. **Consequence: no branch of §3 may promote a conclusion
from BELIEVED to MEASURED because `currentTool` agrees with a sensor.** Agreement
between a measurement and a belief is two facts that happen to be consistent,
which §3.2 row A already said of itself and which is now a ruling rather than
this document's opinion.

**Q4 — autoconfirm MAY suppress the confirm for a move the app cannot prove is
safe.** Gabe's words: *"my machine, my call."* §4.4 argued it both ways and named
a third shape — suppress the two-step, keep the sentence as a standing caveat.
That third shape was on the table and was **not** the one chosen.
**Consequence: the `autoConfirmRun` mechanism is granted the same power over an
unprovable move that it already has over an arbitrary macro run.** §4.4's
"against" column is not deleted: it is the reasoning that keeps the default
`false` (§4.3), and that default is not re-derivable from this ruling.

### The rule Q3 and Q4 compose into

They govern different steps of the same path, so they stack rather than
conflict:

1. The app decides whether the move is **provable from sensor readings alone**,
   per §3. `state.currentTool` is not an input to that decision — it can change
   the *words* of a confirm, never the *existence* of one (Q3).
2. Where it is not provable, the operation **routes to the confirm path** (§4).
3. The autoconfirm checkbox decides whether that confirm is a **two-step or a
   pass-through** (Q4).

**The state this composes into, stated plainly and on purpose:** on a sensorless
machine (F), an unsurveyed one (G), or a dock-only machine outside its
all-docked case (A — which is Gabe's machine during normal operation, because a
picked-up tool leaves its dock reading empty), **with autoconfirm ticked the app
authors and sends the approach leg with nothing having checked anything.** Not
the sensors, which cannot answer the question; not the firmware's belief, which
is not consulted for this decision; and not the operator, who ticked the box
that means do not ask.

That is Gabe's explicit, informed decision, taken with §4.4's counter-argument
in front of him. It is recorded here **as a decision** so that a later session
reading §4.4's "against" column does not mistake it for an oversight and "fix"
it. What is *not* re-openable is the ruling; what remains true is that the box
ships off (§4.3), and that being wrong here drives a carriage through a dock
body.

---

## 1. What exists today

### 1.1 `dockSensors` — the shape

```ts
export interface DockSensorRef {        // config/types.ts:27-32
	/** Index into sensors.gpIn reporting "tool is in its dock". */
	gpIn: number;
	/** Set when the switch reads 0 for docked. */
	inverted?: boolean;
}
```

- Field: `config/types.ts:253`, keyed by tool number as a string.
- Default: `dockSensors: {}` (`config/types.ts:293`).
- Setters: `setDockSensor` / `clearDockSensor`, declared `config/store.ts:52-53`,
  implemented `config/store.ts:293-298` — a whole-`ref` replace and a key delete
  on the overlay draft.
- Parser: `parseDockSensors` (`config/parse.ts:91-102`), wired at
  `config/parse.ts:298`. It drops any entry whose `gpIn` is not a `number` and
  drops a non-boolean `inverted`, and returns `undefined` — i.e. *absent* — when
  nothing survives. Verified by test: `test/config-parse.test.ts:38,46` feeds
  `{"0":{gpIn:"four"}, "1":{gpIn:7,inverted:true}, "2":{gpIn:3,inverted:"yes"}}`
  and asserts `{"1":{gpIn:7,inverted:true}, "2":{gpIn:3}}`.

**The shape encodes exactly one topology.** There is no way to say *"this input
means engaged, not docked"*, no way to say *"this one input covers the whole
gantry"*, and — the load-bearing one — **no way to distinguish "there are no
sensors on this machine" from "nobody has been asked yet."** `{}` is both.

### 1.2 The editor

`DockSensorsBody` (`cards/SettingsCards.tsx:187-233`), registered as the
`tool-dock-sensors` card at `compose/cards.tsx:172`, defined at
`compose/defs.ts:432-436`, placed on the **Settings** screen at
`compose/screens.ts:181`.

It renders one row per entry of `om.tools` (`cards/SettingsCards.tsx:195`): a
number input for the gpIn index and an `inverted` checkbox that is `disabled`
until an index exists (`:218`). Clearing the number calls `clearDockSensor`
(`:208`). The hint above the rows says the sensor "reports docked or away — it
cannot know 'mounted'" (`:191-194`).

Two consequences worth stating. The editor is **driven by the tool list**, so a
machine with no tools gets no rows at all and cannot map anything — the same
tool-keying defect the profile spec records for `accelByTool`
(`2026-08-24-machine-profile-design.md:111`). And it offers **no way to say
"none"**: leaving every field blank is indistinguishable from never opening the
card.

### 1.3 The one consumer

`cards/ToolsHeatersCard.tsx:52-60`, in full:

```ts
/** docked/away from the user-mapped gpIn sensor; null = unknowable. */
const dockState = (toolNumber: number): "docked" | "away" | null => {
	const ref = app.config.config.dockSensors[String(toolNumber)];
	if (ref === undefined) return null;
	const gpIn = app.om.om.sensors.gpIn[ref.gpIn];
	if (gpIn === null || gpIn === undefined) return null;
	const active = gpIn.value >= 0.5;
	return (ref.inverted ? !active : active) ? "docked" : "away";
};
```

It computes a **three-valued** result — `docked` / `away` / `null` — from one
gpIn reading, thresholded at 0.5, with `inverted` flipping the sense.
`null` is returned in two structurally different cases that it does not
distinguish: *no mapping for this tool*, and *the mapped index is absent or null
in `sensors.gpIn`*.

What it does with `null` is the good part and should be preserved: the dot is not
rendered at all (`<Show when={p.dock}>`, `:80`), and the surrounding comment
(`:75-79`) records that `.heat-tool` is pinned to column 3 in CSS so the missing
dot **leaves the column empty rather than closing it up**. Called from
`:168` and `:214` (the vertical and horizontal layouts).

That is the entire consumer set. It is a **display** — green dot / gold dot —
with a `title` and `aria-label` of "Docked" / "Away" (`:84-85`). It gates
nothing, and it is not in a motion path.

### 1.4 `macros.autoConfirmRun` — the pattern Gabe named

**Declared** — `config/types.ts:41-51`:

```ts
export interface MacrosConfig {
	/**
	 * Run a macro on the first click instead of arming a confirm step.
	 *
	 * Deliberately persisted, unlike the dev write-arming flag: the checkbox is
	 * visible on the Macros view whenever the list is, so its state can always
	 * be read off the screen. The danger with write-arming was a belief that
	 * outlived the tab and could not be seen; that does not apply here.
	 */
	autoConfirmRun: boolean;
}
```

**Default** — `false` (`config/types.ts:297`), with the comment *"Off by
default: a fresh install asks before firing a macro at the machine."*

**Parsed** — `parseMacros` (`config/parse.ts:112-115`) accepts the section only
when `autoConfirmRun` is a `boolean`; anything else makes the whole section
`undefined`, i.e. falls back to the default.

**Read and set** — one component, `MacrosListing` (`cards/FileCards.tsx:190-250`),
which both macro cards render (`MacrosBody` `:260`, `MacrosInventoryBody` `:266`)
so the two-step confirm exists once:

```ts
const [armed, setArmed] = createArmed<string>();                          // :197
const autoConfirm = (): boolean => app.config.config.macros.autoConfirmRun; // :198

const run = (path: string): void => {                                      // :200
	if (!autoConfirm() && armed() !== path) { setArmed(path); return; }
	setArmed(null);
	void app.connector.sendCode(cmd.runMacro(path)).catch(() => undefined);
};
```

**The shape, stated so it can be copied:**

1. **The confirm is a two-step on the control itself**, not a modal. The button's
   own label changes: `▶ Run` becomes `Confirm` (`:245`) and it gains the `armed`
   class. Nothing moves; nothing overlays.
2. **Arming goes through `createArmed`** (`control/armed.ts:55`), never a raw
   signal — one global capture-phase Escape listener disarms every armed control
   at once (`control/armed.ts:38-49`). The invariant is `escape-disarms` at
   `@rung 6`, enforced by a test that **walks `src` rejecting any `[armed, …]`
   signal not produced by `createArmed`** (`control/armed.ts:18-22`). A new
   two-step control that does not use it fails the suite by file and line.
3. **The armed value is the thing the confirm applies to** — here the macro path
   — so what is shown and what is done cannot disagree (`control/armed.ts:51-54`).
4. **Toggling the checkbox disarms** (`cards/FileCards.tsx:219`), with the reason
   in a comment: *"Leaving a row armed while switching modes would make the next
   click mean something different than it looks."*
5. **The checkbox sits in the card that owns the action**, above the list
   (`:213-228`), and carries a live hint that states the current behaviour in
   words: `"Run fires on the first click"` / `"Run asks twice"` (`:226`).
6. **It is persisted config, not session state**, on the stated ground that the
   checkbox is visible whenever the affected controls are.

The Shaping lab already uses the same idiom for motion: `createArmed<CaptureArm>()`
(`cards/ShapingCards.tsx:606`), button label flipping to `Confirm` (`:1094`), and
confirm sentences that name their consequences and end *"Escape cancels"*
(`:1925`, `:2134`). The header comment states the requirement directly
(`:580-581`): *"the RUN control is a `createArmed` two-step whose confirm
sentence states the capture count, the move and the file names, all read off the
plan."*

### 1.5 What RRF reports, and which half of it is a measurement

This is the distinction the whole design turns on.

| Datum | Typed at | Verified value (real capture) | **Measurement or belief** |
|---|---|---|---|
| `sensors.gpIn[i].value` | `om/types.ts:317-320` (`GpInputPort`), `:355` | 23 entries; `[10..13] = 1,1,1,1`; `[0],[1] = null` | **Measurement.** A pin level, sampled by the board. |
| `sensors.endstops[i].triggered` | `om/types.ts:322-325`, `:356` | 2 present, both `false` | **Measurement.** |
| `state.currentTool` | `om/types.ts:197` | `-1` | **Belief.** See below. |
| `state.previousTool` | *not typed* | `0` | **Belief.** |
| `state.nextTool` | *not typed* | `-1` | **Belief.** |
| `tools[].state` | `om/types.ts:163` | `["standby","standby","off","off"]` | **Neither — a different subject.** |
| `tools[].offsets` | *not typed* | T0 `[40.273,-2.935,-1.050,0,0,0,0]` | Configuration (G10), not presence. |
| `tools[].axes` | *not typed* | `[[0],[1],[2]]` for every tool | Configuration. |
| `tools[].offsetsProbed` | *not typed* | `0` | Configuration. |
| `move.axes[6]` ("C", the coupler) | `om/types.ts:21-45` | `machinePosition: 121.0` | **Belief.** See below. |

**`state.currentTool` is the firmware's belief, and `reference/duet-gcode.md`
says so in its own words.** The `T` entry (`reference/duet-gcode.md:9100-9113`)
lists the tool-change sequence: run `tfree#.g`, deselect, run `tpre#.g`, set
temperatures, run `tpost#.g`, apply offsets, **then** "Use the new tool" — step 8.
Every physical act is inside an operator-authored macro. **No macro reports back
whether the coupling happened.** `currentTool` records that RRF finished running
the scripts, not that a tool is on the carriage. A `tpost0.g` that runs to
completion with the tool still sitting in its dock leaves `currentTool: 0` and a
naked carriage, and nothing in the object model contradicts it.

**`tools[].state` is a heater state, not a mount state.** The vendored enum is
`off | active | standby` (`reference/objectmodel/src/tools/index.ts:5-9`), typed
in our tree as a `string` with those three values documented (`om/types.ts:162-163`).
The real capture shows T0 and T1 in `standby` and T2/T3 `off` while
`currentTool` is `-1` — i.e. **two tools "in standby" with nothing selected and
nothing mounted.** Anything that reads `tools[].state` as presence is reading a
setpoint mode.

**The C axis is an actuator position, not a coupling sensor.** Project memory
(`tool-dock-presence-indicators`, verified 2026-07-15 against Gabe's
`tfree`/`tpre`/`tpost` and `tool_lock`/`tool_unlock` macros) records the coupler
as the 7th axis: `tool_lock` = `G1 C0`, `tool_unlock` = `G1 C121`. The live
capture reads `move.axes[6].machinePosition = 121.0`
(`packages/mock-duet/captures/duet3-real-2026-07-15/model/live-d99fn.json`,
`result.move.axes`) — coupler open — consistent with `currentTool: -1` and all
four docks reading 1. **But a stepper's reported position is where the firmware
believes it commanded the motor to, not where the coupler is.** A skipped step, a
jammed coupler or a snapped belt all report the commanded number. It belongs in
the belief column with `currentTool`.

**Corroboration on the real machine, and its exact meaning.** Memory records the
verified mapping for Gabe's machine as `sensors.gpIn[T + 10]` for T0..T3, with
`value == 1` meaning **docked**. The capture bears that out: `gpIn[10..13]` are
all `1` while `currentTool` is `-1` and C reads open. That is a **measured** "all
four tools are in their docks" agreeing with a **believed** "nothing is
selected". The design exists for the case where they disagree.

**Freshness.** `sensors` is carried in the live poll payload, not only on a seqs
bump — verified in `live-d99fn.json`, whose `result` carries a full
`sensors.gpIn` array alongside `state` and `move`. `PollConnector` polls at
`pollIntervalMs ?? 500` (`packages/connector/src/PollConnector.ts:135`, scheduled
`:248`). **So a sensor reading is up to roughly half a second plus network stale.
It can be a pre-motion check. It can never be an in-motion interlock**, and
nothing in this design may be written as though it could.

**Not in the object model at all:** any notion of dock, engagement, coupling,
gantry, or tool presence. RRF has no such concept. Everything in Part 2 is
operator-supplied metadata over gpIn indices — the same class as `axisRoles`
(`config/types.ts:241-242`: *"RRF has no notion of axis roles"*).

### 1.6 Does `shaping/` consult any of it?

**No.** Verified by grep over `packages/ui/src/shaping/` for
`currentTool|dockSensor|gpIn|nextTool|previousTool`: **zero matches.**

The lab reads the object model through `Preconditions.read`
(`shaping/preconditions.ts:146`), which examines `state.status`, planar axis
positions, the accelerometer, `move.travelAcceleration` and the configured
envelope — and nothing about tools. Its `Refusal` union
(`shaping/preconditions.ts:30-66`) has ten arms and none of them mentions a tool.
`head-outside-envelope` (`:43`, raised at `:180`) landed this morning for #49
cause 1 and refuses when the carriage is parked outside the box — which on a
toolchanger is where it parks after every change. **#49 cause 2 and #51 are both
still open, and both need exactly the facts this document is about.**

---

## 2. The topology model

### 2.1 The kinds

Gabe named four, and the evidence supports a fifth that must be classified
carefully so it cannot be mistaken for a sensor.

| Kind | Scope | The proposition it measures | Physical reading |
|---|---|---|---|
| **dock** | one tool | "tool T is present in its dock" | a switch or probe in the dock body |
| **engagement** | one tool | "tool T is **present on the carriage**" — *not* "T is latched" (**decided**, Q1) | a switch that asserts when the tool touches down |
| **mounted** | one gantry | "something is on the carriage", identity unknown | a single switch on the carriage |
| **none** | machine | there are no such sensors | — |
| *(coupler actuator position)* | one gantry | *nothing* — it is a commanded stepper position | **not admitted as a sensor.** §1.5 |

The fifth row is listed to be **excluded on purpose**. The C axis is the most
tempting thing on Gabe's machine to treat as an engagement sensor, and it is the
exact failure this campaign exists to prevent: a plausible number that is not a
measurement. If it is admitted at all it must be admitted as belief, in the same
column as `currentTool`, and it must never satisfy a safety predicate on its own.

**Q1's answer is a property of the ROLE, not of a machine.** Because "engagement"
now means *present on the carriage* everywhere, the role cannot be surveyed into
meaning "latched" on some other machine. An operator who really does have a
coupler-lock switch is describing a **different** proposition, and this design
has no role for it — which is the honest outcome, since admitting one would
require every §3 verdict to be written twice, once per meaning of the same word.
A `lock` role can be added later as a fourth arm of `PresenceSensor`; nothing
here forecloses it, and §3 would gain rows rather than change existing ones.

**Q2's answer removes the temptation on Gabe's machine entirely.** There is no
switch on his coupler, so the C axis is not merely *demoted* to belief here — it
is the **only** thing his machine offers about coupling, and the design refuses
it. His machine's sensing is four dock inputs and nothing else:
`sensors.gpIn[T + 10]` for T0..T3, `value == 1` meaning docked (§1.5, corroborated
by `packages/mock-duet/captures/duet3-real-2026-07-15/model/live-d99fn.json`).

### 2.2 The type

Three requirements, in priority order:

1. **A role and its key space are one thing.** A "dock sensor for the gantry" and
   a "mounted sensor for tool 2" are nonsense; neither may be constructible.
2. **Unexpressed is `unknown`, never `none`.** This is the defect in today's
   `dockSensors: {}` and it is the one that would silently let a no-sensor
   machine be treated as a surveyed one.
3. **It must be a superset of `dockSensors`**, so the migration is exact and
   invents nothing.

```ts
/** One digital input and what "asserted" means for it. Unchanged in substance
 *  from DockSensorRef (config/types.ts:27-32) — only its NAME stops claiming
 *  to know what the input is for. */
export interface PresenceInput {
	/** Index into sensors.gpIn. */
	readonly gpIn: number;
	/** Set when the switch reads 0 for the asserted condition. */
	readonly inverted?: boolean;
}

/**
 * Which carriage. A machine with one gantry has exactly one; IDEX and similar
 * have more. Minted like the other id namespaces (config/types.ts:13-25), so a
 * gantry id cannot be confused with a tool number. See open question 6.
 */
export type GantryId = `g-${string}`;

/**
 * One sensor, its role, and the thing it is about — inseparable.
 *
 * @rung 8  illegal state unrepresentable: the role IS the arm, and each arm
 *          carries only the key space that role can have. There is no
 *          {role, tool?, gantry?} shape in which a per-gantry dock sensor can
 *          be written down.
 */
export type PresenceSensor =
	| { readonly role: "dock";       readonly tool: number;     readonly input: PresenceInput }
	| { readonly role: "engagement"; readonly tool: number;     readonly input: PresenceInput }
	| { readonly role: "mounted";    readonly gantry: GantryId; readonly input: PresenceInput };

/**
 * What sensing this machine has. THREE arms, and the third is the whole point:
 * `unknown` and `none` are different facts with different remedies — ask the
 * operator, versus route every operation to the confirm path (§4).
 *
 * Today's `dockSensors: {}` (config/types.ts:293) collapses both into one
 * value, which is why a machine that has never been surveyed is currently
 * indistinguishable from one the operator has told us has no sensors.
 */
export type PresenceTopology =
	| { readonly kind: "unknown" }
	| { readonly kind: "none"; readonly statedAt: number }
	| { readonly kind: "sensed"; readonly sensors: readonly PresenceSensor[] };
```

`PresenceTopology` is a `MachineProfile` fact in the profile spec's sense
(`2026-08-24-machine-profile-design.md:157-164`) — class `S`, operator-only,
machine-scoped — so `{kind:"unknown"}` is not a special case invented here. It is
what `Fact<PresenceTopology>` in the `{known:"unknown", why:{kind:"never-asked"}}`
arm renders as, and the `gapText` row for it is compulsory by the mapped type.

**Coverage is derived, never stored.** Whether a topology can answer a question
depends on whether it covers *every* tool the machine reports, and that is a
function of the sensor list and the confirmed `toolNumbers` fact. Storing a
`complete: boolean` beside the list would be the duplication the interpretation
spec's note 1 forbids (`2026-08-23-shaping-interpretation-layer-design.md:99-101`).

```ts
/** Does the topology carry a `role` sensor for every tool in `tools`? */
export function coversAll(t: PresenceTopology, role: "dock" | "engagement",
                          tools: readonly number[]): boolean;
```

A three-of-four dock map is a real and likely state — the editor makes it one
blank field away — and **a partial map cannot support any conclusion that
quantifies over all tools.** "All four are docked, so the carriage is empty" is
unavailable when only three are mapped. That is §3's job to enforce, and it can
only enforce it because coverage is computed from the list rather than asserted
alongside it.

### 2.3 Migration

`CONFIG_VERSION` is `2` (`config/types.ts:315`); the profile spec already takes
it to `3` for the machine/person split
(`2026-08-24-machine-profile-design.md:309-312`). This rides that bump — one
version, one migration — following the shape of the existing v1→v2 column
migration (`config/parse.ts:326-355`): **a transform on the RAW json, ahead of
`parseOverlay`, that cannot throw on a hand-mangled file**, dispatched from
`parseOverlayPayload` (`config/parse.ts:363-375`).

| v2 `dockSensors` | v3 `presence` | Why |
|---|---|---|
| absent | `{kind:"unknown"}` | Nobody was asked. |
| `{}` | `{kind:"unknown"}` | **Not `none`.** An empty map is the editor's initial state, not a statement. |
| `{"0":{gpIn:10}, …}` | `{kind:"sensed", sensors:[{role:"dock", tool:0, input:{gpIn:10}}, …]}` | Exact. Today's field can only mean "dock", by its own comment (`config/types.ts:251-252`), so the role is read off the schema and not guessed. |
| any entry the v2 parser would have dropped | dropped | The migration runs on raw json; `parseOverlay` drops bad leaves exactly as it does today (`config/parse.ts:91-102`). |

Nothing is invented. A machine with three of four tools mapped migrates to three
sensors and stays three — and §3 then declines to answer the questions that need
four, which is the correct outcome and was silently wrong before.

The v2 machine half in **localStorage** is dropped rather than migrated, per the
profile spec (`2026-08-24-machine-profile-design.md:324-328`), and re-read from
the machine's own SD card one poll later. `presence` is machine-scoped by the
rule that decides the split (*"if the key space belongs to the machine, the
section belongs to the machine"* — `:281-282`): gpIn indices and tool numbers are
that machine's slot indices, and the existing table already classes
`dockSensors` **machine**, "Safety-relevant" (`:287`).

---

## 3. The inference table

### 3.1 The three questions, stated precisely

- **Q1 — Is tool T in its dock?**
- **Q2 — Is anything mounted on the carriage, and which tool?**
- **Q3 — Is it safe to command an XY move right now?** Formally:

  > **carriage-clear** ≡ *(nothing is on the carriage)* **∨** *(exactly one tool
  > is on the carriage, fully engaged, **and** that tool is clear of its dock)*.

  Q3 is the one #49's approach leg and #51's tool selection both need, and it is
  strictly harder than Q2. A tool can be engaged **and still inside its dock** —
  that is the state at the instant after a pickup, before the carriage backs out
  — and an XY move from there drags the head through the dock body.

Three answer classes, used below:

- **MEASURED** — follows from sensor readings alone, at ≤ ~500 ms staleness
  (§1.5). Nothing in the firmware's beliefs is required.
- **BELIEVED** — requires trusting `state.currentTool` (or the coupler axis),
  which records that macros ran, not that metal moved (§1.5).
- **UNKNOWABLE** — no combination of what this app can read decides it.

The tables assume the topology **covers every tool** in the confirmed
`toolNumbers` fact. Where it does not, every conclusion in the row that
quantifies over all tools degrades to UNKNOWABLE, per `coversAll` (§2.2). This is
stated once and applies to all five rows.

### 3.2 Per topology

#### A — dock sensor per tool (today's `dockSensors`; Gabe's machine)

| Question | Class | What can be said |
|---|---|---|
| Q1 | **MEASURED** | Per tool, directly. This is what `dockState` already computes (`cards/ToolsHeatersCard.tsx:53-60`). |
| Q2 "anything mounted?" | **UNKNOWABLE** | A tool out of its dock may be on the carriage, in the operator's hand, or on the floor. The dock sensor is at the dock; it says nothing about the carriage. |
| Q2 "which tool?" | **MEASURED, conditionally** | If **exactly one** tool reads away, that tool is the only candidate. If **zero** read away, no tool is out of any dock. If **two or more**, identity is UNKNOWABLE. |
| Q3 | **PARTIAL — safe only in the all-docked case** | **All tools docked → carriage is empty → carriage-clear is MEASURED.** This is a genuine, useful certainty and it covers the common approach-leg case. Exactly one away → that tool is out of its dock, so the "clear of its dock" half is MEASURED; the "fully engaged" half is UNKNOWABLE. Two or more away → refuse. |

**What this topology uniquely buys: the aborted-change contradiction is
detectable.** `currentTool == T ∧ dock[T] == docked` is a **measured refutation of
a firmware belief**, and it is precisely what a failed or aborted tool change
leaves behind. Project memory has wanted this since 2026-07-12
(`tool-dock-presence-indicators`: *"currentTool = T2 while T2 still reads docked
→ failed pickup"*). No other topology sees it.

**Held to be true even though it feels safe: exactly-one-away + `currentTool`
agreeing is NOT proof.** It is a measured fact and a belief that happen to be
consistent. The tool could be half-coupled, or in a hand. See §3.3. **Decided
(Q3):** that consistency may narrow the confirm's wording; it may not remove the
confirm.

#### A′ — what Gabe's machine can and cannot prove

Not a table row, because it is the practical result of the whole document and it
should not have to be reassembled from one.

**Gabe's machine is topology A and will stay topology A** (Q2). It has four dock
inputs and no carriage sensing of any kind. Therefore, for the first consumer —
#49's approach leg, the `G1` the Shaping lab authors to bring a parked head into
the envelope:

- **"Safe to command an XY move" is provable on exactly one reading of the
  machine: all four dock sensors read docked.** That measures the carriage empty,
  and carriage-clear follows with no belief involved. It is the state the machine
  sits in between jobs, so it is a real and frequent case, not a technicality.
- **Every other state falls to the confirm path (§4)** — including *normal
  operation with a tool picked up*, which is what the machine looks like for the
  whole of a print and for the whole of a shaping run on a mounted tool. One dock
  reading empty proves that tool is out of its dock; it proves nothing about
  where the tool is, and *nothing whatsoever* about whether it is on the carriage.
- **So the confirm is the common path on Gabe's machine, not the exception.**
  Any design in which the confirm is treated as the rare unhappy branch —
  cramped wording, a slot borrowed from somewhere else, a sentence assembled
  ad hoc — is designing the wrong thing for the machine it will run on. §4.2.1
  gives the dock-only sentence in full for that reason.
- **The one thing his topology buys that no other does:** `currentTool == T ∧
  dock[T] == docked` is a **measured refutation** of the firmware's belief, and
  it is exactly what an aborted tool change leaves behind. That contradiction is
  a state in which an XY move drags the carriage across the dock rank, and A is
  one of only three topologies that can see it (§3.3 case 3).

**Being wrong about this crashes a head into a dock body.** That is the failure
this row is describing, in the machine it is describing it for.

#### B — engagement sensor per tool, no dock sensors

| Question | Class | What can be said |
|---|---|---|
| Q1 | **UNKNOWABLE** | A disengaged tool is somewhere. Nothing says where. |
| Q2 "anything mounted?" | **MEASURED** | Nothing engaged → carriage empty. Something engaged → carriage occupied. |
| Q2 "which tool?" | **MEASURED** | The sensor is per tool. |
| Q3 | **NO — cannot be answered** | Engaged(T) settles the mount half exactly, and leaves *"is T clear of its dock?"* entirely UNKNOWABLE. A tool picked up but not backed out reads engaged. |

**This is the asymmetry that matters and it is counter-intuitive.** The
engagement sensor is the *better* sensor for knowing what is on the carriage, and
the *worse* sensor for knowing whether it is safe to move. A design that treats
"engagement sensor present" as strictly better than "dock sensor present" gets
Q3 wrong in the one direction that crashes a head. **Route Q3 to the confirm
path (§4) unless nothing reads engaged**, which is MEASURED-empty and safe.
(`currentTool == -1` may accompany it in the wording; per Q3 it is not a
component of the proof, and `currentTool >= 0` alongside an empty carriage is a
measured refutation to state, not a reason to refuse a move that is already
proved safe.)

**The trap, recorded because it was walked into.** While putting Q1 and Q2 to
Gabe on 2026-08-24 I told him that engagement-only sensing makes an XY move
safe, reasoning: *"Engaged(T) → T is held by the carriage → T is out of its
dock."* **That is wrong.** The second arrow does not hold: a tool is engaged and
still inside its dock for the entire instant between the pickup and the carriage
backing out, and — with Q1 now decided as *present on the carriage* — for the
whole of a pickup that touches down and then fails. The inference confuses *held*
with *withdrawn*, which are separate facts measured by separate hardware, and it
fails in the exact direction that drives the head sideways through the dock body.
Row B's table above already had this right; this note exists because the wrong
version is the intuitive one and the next reader will re-derive it. The correct
one-liner: **an engagement sensor answers "is something on the carriage",
never "may the carriage move".**

#### C — dock **and** engagement, both per tool (the fullest topology)

**Demoted 2026-08-24 by Q1.** This row previously read `Q3 — MEASURED`, with the
gap listed as conditional on what an engagement sensor senses. That question is
now answered *"tool present on the carriage"*, and the answer removes the
condition under which the MEASURED claim held. The row is restated, not
annotated, because a table that says MEASURED with a paragraph underneath saying
"except…" is exactly the confident-wrong-answer shape this campaign exists to
stop.

| Question | Class | What can be said |
|---|---|---|
| Q1 | **MEASURED** | Per tool, directly, as in A. |
| Q2 "anything mounted?" | **MEASURED** | Something reads present → the carriage is occupied. Nothing does → it is empty. |
| Q2 "which tool?" | **MEASURED** | The present-sensor is per tool, so the occupant is named, not inferred. This is the one place identity is measured rather than narrowed. |
| Q3 | **PARTIAL — the dock-clearance half is MEASURED; the engagement half is NOT** | `present(T) ∧ ¬docked(T)` measures that T is on the carriage **and** that T's dock is empty, which settles *clearance*. It does **not** settle whether T is latched: a tool resting on the carriage unlatched asserts the same input (Q1). `¬∃present ∧ ∀T docked(T)` → carriage empty → carriage-clear, MEASURED and complete. **Everything else → refuse**, naming which half failed. |

**What C still buys, and it is a lot:**

- **Identity is measured.** C is the only topology in this document where "which
  tool is on the carriage" is a reading rather than an inference (contrast E,
  where it is capped at INFERRED, and A/D where it is unknowable or believed).
- **Dock clearance is measured for the occupant.** `present(T) ∧ ¬docked(T)`
  rules out the single most dangerous state in §3.3 case 3 — firmware believes
  T is held while T is sitting in its dock — for the named tool, directly.
- **The empty case is fully measured**, the same as A's all-docked case, and with
  a second sensor agreeing.
- **The aborted-change contradiction is visible twice over**: `docked(T) ∧
  present(T)` is a physical impossibility for a withdrawn tool and reads as a
  live disagreement between two measurements, not between a measurement and a
  belief.

**What C does not buy, stated because silence would read as "checked, and
fine"** (`2026-08-23-shaping-interpretation-layer-design.md:166-169`):

- **Whether the tool is actually latched.** Undetectable. A tool that touched
  down and did not couple, or one whose coupler released mid-move, reads
  identical to a correctly latched tool.
- **Therefore: whether the tool will still be there after the move.** Clearance
  is measured at the current instant; retention is not measured at all. An
  unlatched tool clears its dock and then falls off somewhere else in the box.
- **And therefore Phase 5 must not ship a MEASURED "safe to move" verdict from
  row C either.** C reduces the confirm's content — the sentence can name the
  occupant and state that its dock is clear — but it does not remove the
  confirm, because the residual failure is the tool leaving the carriage under
  acceleration, and nothing on any machine in §2.1 measures that.

**A `lock` role would close this gap and no survey answer can.** If a machine
genuinely has a coupler-lock switch, that is a fourth sensor role (§2.1's note
on Q1), not a re-reading of this one. Until such a role exists, **no topology in
this design detects partial engagement** — §3.3 case 2, now unconditional.

#### D — one "mounted" sensor on the gantry

| Question | Class | What can be said |
|---|---|---|
| Q1 | **UNKNOWABLE** | |
| Q2 "anything mounted?" | **MEASURED** | The sensor's whole content. |
| Q2 "which tool?" | **UNKNOWABLE** | Only `currentTool` claims to know, and that is BELIEVED. |
| Q3 | **PARTIAL — safe only in the empty case** | `¬mounted` → carriage is empty → carriage-clear MEASURED. `mounted` → whether the thing on the carriage is clear of its dock is UNKNOWABLE. |

**Its one contradiction:** `¬mounted ∧ currentTool ≥ 0` measures that the
firmware's belief is wrong. Weaker than A's contradiction (it cannot say *which*
tool is misplaced) but it fires on the same failure.

#### E — dock per tool **and** mounted per gantry

| Question | Class | What can be said |
|---|---|---|
| Q1 | **MEASURED** | |
| Q2 "anything mounted?" | **MEASURED** | |
| Q2 "which tool?" | **INFERRED, not measured** | `mounted ∧ exactly-one-away(T)` makes T the only candidate. It is **not proof they are the same object** — a tool out of its dock and a *different* object on the carriage produces identical readings. |
| Q3 | **PARTIAL, and the strongest inference short of C** | `¬mounted ∧ ∀T docked(T)` → carriage-clear MEASURED. `mounted ∧ exactly-one-away(T)` → the mount half is MEASURED and the dock-clearance half is MEASURED for T; only *"is the mounted thing T"* is inferred, and *"fully engaged"* remains UNKNOWABLE. Anything else → refuse. |

Whether that inference is good enough to move on is a ruling, not an arithmetic
result. **It is routed to the confirm path with the inference spelled out in the
sentence**, which is the honest handling: state the two measurements, state the
step between them, let the operator take it.

#### F — none (operator has said so: `{kind:"none"}`)

| Question | Class |
|---|---|
| Q1 | **UNKNOWABLE** |
| Q2 | **UNKNOWABLE** |
| Q3 | **UNKNOWABLE** |

The only thing the app has is `state.currentTool`, which is BELIEVED and, per
§1.5, is exactly the value that survives an aborted tool change unchanged.
**Every app-initiated move routes to §4.**

#### G — unknown (`{kind:"unknown"}` — nobody has been asked)

Identical answers to F, **different remedy.** F has been surveyed and the app
should stop asking about sensors; G has not, and the remedy is the survey. They
must not render the same sentence. This is why §2.2's third arm exists.

### 3.3 The dangerous intermediate states, named

**1. Mid-change.** RRF runs `tfree#.g`, `tpre#.g` and `tpost#.g` as macros
(`reference/duet-gcode.md:9107-9111`); `state.status` is not `idle` while they
run, and `currentTool` is `-1` between the deselect and the end of `tpost`. The
app **already refuses on this**, for a different reason and before any of this
work: `Preconditions.read` returns `not-idle` when `state.status !== "idle"`
(`shaping/preconditions.ts:148`). That existing gate is load-bearing here and
must not be weakened by anything in Phase 5. **But it is only a pre-motion
check**, at ≤ ~500 ms staleness (§1.5): a change that *starts* after the read is
not seen. The mitigation is the existing `stale` refusal
(`shaping/preconditions.ts:47`, and `readAt` at `:97`, `:138-140`), not a tighter poll.

**2. A tool partially engaged. Undetectable in every topology in this design —
A, B, C, D, E, F and G alike.** This was conditional on open question 1 when the
document was written; **Q1 is now decided as "present on the carriage"** (see
Decided), so the one topology that might have detected it does not. A tool that
has touched down and not latched asserts the same input as one that has. **No
topology in this design may claim to detect partial engagement**, and no verdict
anywhere may be written as though something upstream had ruled it out. Because it
cannot be detected, the safety statement must **say so in words** rather than
omit it — the interpretation spec's rule that silence reads as "checked, and
fine" (`2026-08-23-shaping-interpretation-layer-design.md:166-169`). Closing this
gap needs a `lock` sensor role that no machine in scope currently has (§3.2 C).

**3. The firmware believes T0 is mounted while T0 is still in its dock.** This is
what a failed or aborted tool change leaves behind, and it is the state in which
an XY move drags the carriage across the dock rank. Detectable **only** in
topologies A, C and E (dock sensor on that tool). In B it is invisible; in D it
is detectable only as `¬mounted ∧ currentTool ≥ 0`, which cannot name the tool;
in F and G it is invisible.

**4. A tool out of every dock and not on the carriage.** Two docks reading away
in topology A, or `mounted=false` with a tool away in E. Physically: a tool in
the operator's hand, on the bench, or dropped. It is not itself a motion hazard,
but it **falsifies the exactly-one-away identity inference**, which is why that
inference is capped at INFERRED in E and never promoted.

### 3.4 Where Q3 cannot be answered

Consolidated, because this is the routing rule:

| Topology | Q3 answerable without a confirm? |
|---|---|
| **A** dock per tool | **Only when all tools read docked** (carriage empty). Gabe's machine — see A′. |
| **B** engagement per tool | **Only when nothing reads engaged** (carriage empty). |
| **C** dock + engagement | **Only when nothing reads present and all tools read docked** (carriage empty). *Was "yes, both directions"; demoted by Q1 — the occupied direction cannot rule out an unlatched tool.* |
| **D** mounted per gantry | **Only when the sensor reads not-mounted.** |
| **E** dock + mounted | **Only when not-mounted and all docked.** |
| **F** none | **No.** |
| **G** unknown | **No** — and say it is unsurveyed, not unsensored. |

**Every row now has the same shape: the only provable state is the empty
carriage.** That is the honest consequence of Q1, and it is worth saying out
loud, because a design built around "better sensors unlock more motion" is built
around a promise this table cannot keep. What better sensing buys is a **better
sentence** — more of the confirm's clause 2 becomes a measurement instead of a
gap — not fewer confirms.

**Every "no" and every case outside a row's stated "yes" routes to §4.** The
refusal, where a refusal is chosen instead, follows the existing ladder: one new
`Refusal` arm, rendered by the `never`-armed `refusalText`
(`shaping/copy.ts`, exhaustive over `shaping/preconditions.ts:30-66`), or — per
the profile spec's §5 — the single `unknown-fact` arm delegating to `gapText`
(`2026-08-24-machine-profile-design.md:344-357`). **One arm, not one per
topology**, for the reason that spec gives: the fact set in two places drifts.

**Prefer refusing over assuming.** Where this document is uncertain, the
uncertain branch must produce a sentence, not a move.

---

## 4. The confirm path

For topology F, for G, and for every branch §3.4 leaves unanswered.

### 4.1 The flow

Copy the `autoConfirmRun` shape verbatim in structure (§1.4), and nothing else:

1. The control the operator pressed (Shaping *Measure*, or whatever #51's tool
   selection is fronted by) **arms instead of running**, through `createArmed`
   (`control/armed.ts:55`) — mandatory, not stylistic: the walking test in
   `test/armed.test.ts` rejects any other arming
   (`control/armed.ts:18-22`).
2. The armed value **carries the plan**, so the sentence and the motion cannot
   diverge — the same rule `cards/ShapingCards.tsx:616-620` already states for
   the run kind.
3. The button's label flips to `Confirm`; the sentence renders in the card's
   already-reserved note slot, at its declared height, so **nothing moves**
   (`cards/ShapingCards.tsx:1122-1129`; positional stability is the standing
   primary concern).
4. Escape cancels, globally, and the sentence says so — as
   `cards/ShapingCards.tsx:1925` and `:2134` already do.
5. Toggling the autoconfirm checkbox **disarms**, for the reason at
   `cards/FileCards.tsx:217-221`.

### 4.2 The sentence

Four clauses. Each is compulsory; a confirm missing any of them is a friction
device rather than an informative one.

1. **What is about to happen** — the actual motion in machine terms: *"travel to
   X150.0 Y150.0 at 200 mm/s."* Read off the plan, never re-derived.
2. **What could not be verified, and why** — naming the topology:
   - **A**: *"T1's dock reads empty and T0, T2 and T3 read docked; nothing on
     this machine senses the carriage."* The one that matters most — see §4.2.1.
   - F: *"this machine has no tool-presence sensors, so nothing can tell whether
     a tool is on the carriage or still in its dock."*
   - G: *"this machine has not been surveyed for tool-presence sensors"* + a link
     to the survey. **Different sentence, different remedy.**
   - B: *"T2 reads present on the carriage; nothing on this machine reports
     whether it is clear of its dock."*
   - C: *"T2 reads present on the carriage and its dock reads empty; nothing
     reports whether it is latched."*
   - E: *"T2's dock reads empty and the carriage reads occupied — nothing proves
     the thing on the carriage is T2."*
3. **What the firmware believes** — *"the firmware reports T0 selected"*, or
   *"…reports no tool selected"* — labelled as a report, not a fact.
4. **The physical consequence of being wrong** — *"if T0 is still in its dock,
   this move drives the carriage through it."* This is the clause that makes the
   confirm worth reading, and it is the one a generic "Are you sure?" omits.

### 4.2.1 The dock-only sentence, in full

Written out rather than described, because Q2 makes this **the common path on
the machine the feature will be verified on** (§3.2 A′), not an edge case. The
voice is `shaping/copy.ts` — `armedRunText` (`:585-594`) and `armedSaveText`
(`:604-607`): sentence case, *"Confirm ⟨verb⟩: ⟨what⟩"*, every figure read off
the plan, clauses separated by full stops, closing on *"Escape cancels."*
because `createArmed` guarantees it and a two-step whose way out is invisible has
no way out (`copy.ts:580-583`).

**Topology A, one tool away, `currentTool` naming it (the ordinary case):**

> **Confirm approach: travel to X150.0 Y150.0 at 200 mm/s. T1's dock reads
> empty; T0, T2 and T3 read docked. Nothing on this machine senses the carriage,
> so whether T1 is held — and whether it is clear of its dock — cannot be read.
> The firmware reports T1 selected, which records that the change macros ran.
> If T1 is still in its dock, this move drives the carriage through it. Escape
> cancels.**

Clause by clause, against §4.2: sentence 1 is the motion, read off the plan;
sentence 2 is **what the sensors actually measured**, named tool by tool, so the
operator can check it against the machine in front of them; sentence 3 is the
gap, stated as a gap; sentence 4 is `currentTool` **labelled as a report** — this
is Q3's "narrow, never skip" in one clause, and the phrase *"records that the
change macros ran"* is the whole of §1.5 compressed to six words; sentence 5 is
the consequence, in metal.

**Variants, all four clauses intact:**

- **`currentTool == -1`** — sentence 4 becomes *"The firmware reports no tool
  selected, and one dock is empty; those disagree."* The disagreement is a
  **measured refutation** of the firmware's belief (§3.2 A) and is the strongest
  thing this topology ever says. Sentence 5 becomes *"If T1 is on the carriage,
  this move takes it with it; if it is not, something has been moved by hand."*
- **Two or more docks empty** — sentence 2 lists them all; sentence 3 gains
  *"and which of them, if either, is on the carriage cannot be read"*; sentence 5
  names the set: *"If T1 or T3 is still in its dock, this move drives the
  carriage through it."*
- **A tool with no dock sensor mapped** (partial coverage, `coversAll` false —
  open question 7) — sentence 2 must say *"T3 has no dock sensor mapped"*, not
  omit T3. An omitted tool reads as a docked one, which is the silence-as-
  reassurance failure again.
- **All docked** — there is no sentence, because there is no confirm. That case
  is proved (§3.2 A′).

**What the sentence must never say:** *"T1 is on the carriage."* Nothing on this
machine measures that, and clause 4 exists precisely to keep the firmware's
report from being restated as a fact. The wording above says *reports*, once, and
attaches what the report is evidence of.

### 4.3 Where the checkbox lives, and its default

**Default `false`**, matching `autoConfirmRun` (`config/types.ts:296-297`) and
for a stronger version of the same reason: *"a fresh install asks before firing a
macro at the machine"* applies at least as hard to a machine whose sensor
topology is `unknown`.

**Placement — the constraint is `autoConfirmRun`'s own stated rationale**
(`config/types.ts:43-48`): it is persisted *because the checkbox is visible on
the Macros view whenever the list is*, so its state can always be read off the
screen. A persisted autoconfirm whose checkbox is on a different screen from the
control it silences **breaks that rationale** — it becomes exactly the invisible
outliving belief the comment says write-arming was rejected for. Two placements
satisfy it:

- **On each card that initiates motion** (Shaping Capture; #51's tool control) —
  visible with the control, matching the Macros precedent exactly. Cost: the
  same setting rendered in N places, which is the "two editors for one value"
  hazard the profile spec names (`2026-08-24-machine-profile-design.md:389-390`)
  — mitigated because it is one config field with N views, not N fields.
- **On the machine-profile card**, beside the topology it is a consequence of.
  Cost: it silences controls on a screen it is not on, which is what the
  `autoConfirmRun` comment warns against.

Whichever is chosen, **the affected control must state the current mode in
words** the way the Macros hint does (`cards/FileCards.tsx:225-227`): *"Move
fires on the first click"* / *"Move asks twice."*

### 4.4 May autoconfirm suppress an unprovable move? — **Decided: yes**

**Decided (Gabe, 2026-08-24): yes.** *"my machine, my call."* The argument is
kept below in both directions, unedited, because it is the reasoning behind the
default (§4.3) and behind every word of the sentence in §4.2.1 — but it is no
longer an open question, and the "against" column is **not** grounds for a later
session to reintroduce a gate.

**What the ruling settles:** with the checkbox ticked, an operation that §3.4
cannot prove safe **runs on the first click**, on the machine's own authority.
The third shape below — keep the sentence, drop only the two-step — was on the
table and was not the one chosen.

**What the ruling does not touch:** the default stays `false` (§4.3), the
sentence stays exactly as specified for every operator who has not ticked the
box, and nothing here weakens `Preconditions.read`'s existing `not-idle` gate
(§3.3 case 1), which is a firmware-state check rather than a presence one.

**For — autoconfirm suppresses it, exactly like `autoConfirmRun`.**

- Gabe's ruling names this remedy in the same breath as the existing one: *"or,
  like the other tools, give them a checkbox to 'autoconfirm' the movement."*
  The plainest reading is: same mechanism, same power.
- `autoConfirmRun` already suppresses a confirm for **an arbitrary operator macro
  fired at the machine** (`cards/FileCards.tsx:205-208`) — strictly less
  predictable than a planned travel leg whose coordinates the app computed and
  drew on a map first.
- A confirm that appears before *every single* operation on a no-sensor machine
  is a confirm that gets trained away. Habituation is a real safety failure, not
  a hypothetical: a dialog clicked through 200 times is not read the 201st, which
  is the one that mattered.
- The operator with no sensors is the operator who knows their machine by hand.
  Refusing to let them turn it off is the app substituting its judgement for
  theirs — the posture `controls-are-1to1-with-gcode` exists to reject.

**Against — autoconfirm suppresses "are you sure", never "I cannot check this".**

- The two confirms are not the same act. `autoConfirmRun` removes **friction**
  before a command *the operator chose from a list they are looking at*. This one
  removes **information** before motion *the app planned*, which the operator may
  not have in mind at all.
- The four-clause sentence (§4.2) is not a question. Clauses 2 and 4 are the only
  place the app ever says *"a tool may be in its dock and I would not know"*.
  Suppressing them deletes the only statement of the hazard.
- The asymmetry of being wrong is extreme and one-directional (`be-reasonable`:
  lean toward the mistake that is cheaper to undo). A needless confirm costs one
  click. A suppressed one costs a head, a dock, and possibly the machine's
  geometry.
- The habituation argument cuts both ways: a sentence that **changes** with the
  situation — naming a different tool, a different coordinate, a different
  unverified fact each time — is read differently from a fixed "Are you sure?".

**A third shape, named so it is on the table — offered, and not chosen:**
autoconfirm removes the *two-step*
but the sentence stays, rendered persistently beside the control as a standing
caveat rather than a gate — the exact idiom the interpretation layer already uses
for `caveated` evidence
(`2026-08-23-shaping-interpretation-layer-design.md:83-89`). The information
survives; the friction does not. This is the only option in which "autoconfirm
on" and "the operator was never told" are not the same state.

---

## 5. The tension with `controls-are-1to1-with-gcode`

The standing rule, from project memory (`controls-are-1to1-with-gcode`, Gabe
2026-07-15): every control sends a direct G-code; the only extra logic allowed is
a fixed convenience compound; **no GUI-encoded safeties, verdicts, gating or
interlocks.** Its stated rationale is worth quoting because the whole argument
turns on it:

> such a safety "is not available as a controller native function" — it exists
> only in this GUI, so PanelDue / DWC / a macro / raw G-code all bypass it. A
> safety that only some clients honor is a false sense of safety, worse than
> none.

And the same memory adds, specifically about dock sensors: *"displaying raw
dock/homed/HOT state is fine (that's just the live OM mirror), but the GUI must
NOT turn that into a computed 'failed pickup / crash risk' verdict or block a
toolchange on it."*

**This work looks exactly like the thing that forbids.** It must be argued, not
assumed away.

### 5.1 The distinction offered

**The rule's rationale is about bypassability, and bypassability is a property of
the ACTION, not of the check.** It bites precisely when the dangerous action is
also reachable another way: gate `T0` in this GUI and the operator reaches the
same `T0` from PanelDue, so the gate protects nobody and lies to somebody.

The motion this document is about is **not reachable another way.** The Shaping
lab's approach leg (#49) and the tool selection #51 wants the procedure to issue
are G-codes **the app itself authors**, on its own initiative, that no other
client emits. There is no PanelDue path to the shaping lab's travel leg. Deciding
not to author a move is not gating an operator's control; it is the app declining
to act.

Stated as a boundary:

| Governed by the 1:1 rule (unchanged) | Governed by this document |
|---|---|
| The `T<n>` button on the Tools card (`cards/ToolsHeatersCard.tsx:100-101`) — sends `cmd.selectTool`, ungated, whatever the sensors read. | The `T<n>` the shaping **procedure** issues to measure a specific tool (#51). |
| The dock dot (`cards/ToolsHeatersCard.tsx:53-60`) — displays a raw sensor reading, no verdict. | Whether the procedure plans an approach leg from a parked position (#49). |
| Jog, home, heater, macro-run. | Any `G1` this app composes that the operator did not type. |

So: **the operator's controls stay 1:1 and ungated. The app's own motion is
allowed to decline.** The dock dot stays a display of raw state, as the memory
requires, and gains no verdict.

### 5.2 Where the distinction is weakest — stated, not papered over

**The Shaping Run button is a control the operator presses, and refusing it on a
profile fact is gating a control.** That is not a hypothetical: it is what
`Preconditions.read` already does, ten ways, today
(`shaping/preconditions.ts:30-66` — `not-idle`, `not-homed`, `no-accelerometer`,
`no-envelope`, `head-outside-envelope`, …), and Gabe has accepted it for this
feature over several rulings.

The honest statement is therefore **not** that this work is outside the rule. It
is:

> **The Shaping lab is already an exception to the 1:1 rule, agreed in situ,
> because it is a procedure rather than a control.** Phase 5 extends that
> existing exception to a new fact. It does not create a new one.

A procedure is a plan the app builds, seals, shows and then executes as a unit
(`Procedure` keeps its commands in `#`-private fields; the only route to the
machine is `Procedure.run` — `cards/ShapingCards.tsx:586-589`). A control is a
button whose meaning is one G-code string. The rule was written about the second.

**If Gabe rejects the distinction, this design does not collapse — it simplifies.**
Every "route to the confirm path" in §3.4 stays; every "refuse" in §3 becomes a
confirm as well; §4 becomes the whole of Phase 5; and the sensor topology's job
narrows from *deciding* to *populating clause 2 of the confirm sentence with what
is actually known.* That is a smaller feature and a defensible one, and §2 and §3
are required for it either way — a confirm sentence that says *"nothing can tell
whether a tool is on the carriage"* still has to know that that is true of this
machine.

**Q4 relaxes this tension rather than sharpening it.** Because autoconfirm may
suppress the confirm (Decided), the operator retains a switch that returns
app-authored motion to first-click behaviour. What Phase 5 adds on a machine
whose owner has ticked the box is therefore **not a gate at all** — it is the
decision of *what to say* when it can say nothing, and the option to say nothing.
The refusals in §3 that remain unconditional are the ones already in
`Preconditions.read` (`shaping/preconditions.ts:30-66`), which Gabe accepted for
this feature before this campaign existed.

**One line that holds under either ruling**, from the interpretation layer
(`2026-08-23-shaping-interpretation-layer-design.md:114-116`, note 4): *"a caveat
never blocks a control that sends G-code; it makes the operator read one sentence
first. Firmware and the planner remain the only authorities on whether the
machine may move."*

---

## 6. Questions (Gabe)

Numbering is preserved so earlier cross-references stay valid. Four are answered
and carry their answers here; **five are still open and are the only things in
this document waiting on a ruling.**

1. ~~What does an "engagement sensor" physically sense?~~ **Decided (Gabe,
   2026-08-24): "tool present on the carriage", not "coupler locked."**
   Consequence: partial engagement is undetectable in every topology (§3.3
   case 2); **§3.2 row C is demoted** from MEASURED on Q3 to PARTIAL. A
   coupler-lock switch, if a machine has one, is a *different* role that this
   design does not yet define (§2.1).
2. ~~Is there an actual switch reading the coupler on your machine?~~
   **Decided (Gabe, 2026-08-24): no — dock sensors only.** Engagement is not
   sensed at all and the C axis is not a sensor. Consequence: **Gabe's machine is
   topology A, permanently** (§3.2 A′), so the confirm path is his normal
   operating path, not an exception.
3. ~~May the app trust `state.currentTool` when nothing corroborates it?~~
   **Decided (Gabe, 2026-08-24): it is evidence, never proof.** It may **narrow**
   a confirm — *"about to move with T2 held"* rather than *"unknown tool"* — and
   may **never skip** one. Consequence: nothing in §3 may be promoted to MEASURED
   on the strength of `currentTool` agreeing with a sensor.
4. ~~May autoconfirm suppress a confirm for a move the app cannot prove safe?~~
   **Decided (Gabe, 2026-08-24): yes — *"my machine, my call."*** The "sentence
   stays, two-step goes" variant was offered and not chosen. Consequence: with
   the box ticked on a sensorless or dock-only machine, the approach leg is sent
   with nothing checking. See **Decided → "The rule Q3 and Q4 compose into"**;
   default stays `false` (§4.3).

**Still open:**

5. **OPEN — Is autoconfirm global, per-operation-type, or per-machine?**
   (`autoConfirmRun` is currently person-scoped and global —
   `2026-08-24-machine-profile-design.md:292`.) Sharper now that Q4 is decided:
   the answer chooses how far one tick reaches.
6. **OPEN — Does "mounted, per gantry" ever mean more than one gantry** on a
   machine you care about (IDEX)? If never, `GantryId` collapses to a single
   implicit carriage and §2.2 gets smaller. Unaffected by the four answers.
7. **OPEN — Is a partially-mapped topology usable?** Three of four tools with
   dock sensors: refuse every all-tools conclusion (§2.2's `coversAll`), or let
   you declare the fourth tool sensorless? Q2 raises the stakes — on a dock-only
   machine, `coversAll` failing removes the *only* provable state there is
   (§3.2 A′), so a three-of-four map means every move confirms, forever.
8. **OPEN — Should the app parse your `tfree`/`tpre`/`tpost` to PROPOSE the
   topology** and ask you to confirm what it found — the same offer as open
   question 3 in the profile spec for dock positions — or is typing it in
   cleaner? Note what it could *not* find: the macros command the coupler, so
   they reveal wiring only where a macro reads an input.
9. **OPEN — Where does the autoconfirm checkbox live** (§4.3): on each motion
   card, or on the machine-profile card? Q4 makes this a safety question rather
   than a layout one — the checkbox now silences a confirm about motion, and
   `autoConfirmRun`'s own rationale (`config/types.ts:43-48`) is that a persisted
   suppression must be **visible on the screen it suppresses**.
