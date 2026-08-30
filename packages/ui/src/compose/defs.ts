/**
 * Card definitions — the data half of the registry, and the source of CardId.
 *
 * Design: docs/composable-cards-design.md (its I-numbers are superseded by the
 * ids below — see docs/invariant-register.md).
 *
 * Kept apart from ./cards.tsx so this module stays pure and node-testable:
 * type stripping cannot load JSX.
 *
 * @invariant registered-card-ids
 * @rung 7  `CardId = keyof typeof CARD_DEFS` — an unregistered id is a compile
 *          error in code, and a runtime string either passes parseCardId or
 *          ceases to exist. Was design I1
 * @why a screen holding an id nothing renders is a hole the user cannot fill or
 *      remove; deriving the type from the registry means the set of legal ids
 *      and the set of rendered cards are ONE fact
 *
 * @invariant def-body-totality
 * @rung 7  ./cards.tsx is a Record<CardId, body>, so the compiler makes the two
 *          halves total over each other in BOTH directions — a def with no
 *          body, or a body with no def, is a type error rather than a review
 *          item
 * @why the halves are deliberately split for testability, and two artifacts
 *      that must agree need a mechanism rather than diligence
 *
 * @invariant one-visibility-predicate
 * @rung 6  choke-point — `visibleWhen` is the single predicate, and ComposedView
 *          derives BOTH the JSX mount and the canvas isActive cell-release from
 *          that one call. Was design I3
 * @why a card mounted but still holding its cells, or released but still
 *      rendered, is the unpinned-camera bug in both directions. One predicate
 *      means the two answers cannot disagree
 * @debt the derivation is one call site today; a second consumer could read the
 *       predicate separately. Promote by exposing visibility only as a computed
 *       value both consumers must take, rather than a predicate they may call.
 *
 * @invariant redesigned-cards-grow
 * @rung 6  choke-point — `size` here is the card's natural geometry, and
 *          growToDefaults (shell/panelCanvas.ts) takes the LARGER of stored and
 *          natural per axis at mount, so a card redesigned taller grows on
 *          every screen that already held it. Was design I4
 * @why the 2026-07-24 case: position 95->103 and active-job 40->46 changed
 *      nothing anywhere, because a stored span won outright and the new content
 *      rendered below the fold on every browser that had ever laid the screen out
 * @debt RESTATED 2026-08-01. This was declared as "screens carry placement,
 *       never dimensions of their own", which is simply false — a stored Slot
 *       IS a PanelRect and parseComposition reads colSpan/rowSpan straight out
 *       of it. The property that actually holds is the growth rule above, and
 *       it holds by one function rather than by the storage shape. Promote by
 *       storing position plus a size REFERENCE, so a stale span has no
 *       encoding and growToDefaults becomes unnecessary rather than load-bearing.
 */
import { baseName } from "../files/format.ts";
import { CONFIG_FILE } from "../config/types.ts";
import type { CardCtx } from "./ctx.ts";

export interface CardSize {
	colSpan: number;
	rowSpan: number;
}

/** A static string, or one derived per render (a selected file's name, a
 *  browser's current directory). */
export type CardText = string | ((ctx: CardCtx) => string);

export interface CardMeta {
	title: CardText;
	ariaLabel: string;
	/** What powers the card (OM path, G-code, endpoint) — the CardTip text. */
	tip?: CardText;
	class?: string;
	orientationToggle?: boolean;
	/** Offer the hide-labels toggle. For cards whose label cells restate what
	 *  the control beside them already says (Homing's axis letters, Movement's
	 *  jog names). */
	labelsToggle?: boolean;
	/** THE natural geometry (I4). */
	size: CardSize;
	/** THE visibility predicate (I3). Absent = always visible. */
	visibleWhen?: (ctx: CardCtx) => boolean;
}

/** Identity constructor — the single throat future cross-field rules live in. */
function defineCard(meta: CardMeta): CardMeta {
	return meta;
}

/**
 * The registry's data half. Entries land here as views convert (design
 * phases A2–A6); the starting entry proves the mechanism end to end.
 *
 * ── GIT_170: EVERY MEASURED FLOOR BELOW MOVED BY THE SAME −1 CELL. ──────────
 *
 * The inter-card gutter went from 2u to 1u (index.css `--sp-card-gutter`), so
 * a card spanning n cells renders n·u − 1u px instead of n·u − 2u. The gutter
 * is a term in the sum `contentRowSpan`/`contentColSpan` take, so every card's
 * measured floor dropped by exactly 1 cell on BOTH axes. MEASURED, not
 * reasoned: the Card Lab scale sweep was run on the parent commit (f2f8d07)
 * and on this one, over all 54 registry cards × 2 scale steps × 2 scenarios
 * (default and `shaping-measured`), and the delta was −1/−1 on every single
 * row — one value, no exceptions.
 *
 * (It briefly went to 0, at c59b398, where the same sweep read −2/−2. Gabe
 * drove that on the mock and ruled it too tight, so the value is now the
 * smallest gutter the quantum can express. The intermediate figure is recorded
 * because that commit is in this branch's history, and a reader who lands on
 * it needs to know which offset belongs to which commit.)
 *
 * The per-card numbers written in the comments below were taken BEFORE any of
 * this, so each is 1 higher than the same sweep reports today. They are
 * deliberately NOT rewritten one by one: sixty hand-edited numbers is sixty
 * chances to put one in wrong, and a single stated offset cannot disagree with
 * itself. Read any figure below as "the floor at the time, which is today's
 * floor + 1".
 *
 * The `size` values themselves are also deliberately UNCHANGED, and that is
 * not an oversight. Each composition in compose/screens.ts packs its rows
 * contiguously — SYSTEM_COMPOSITION runs 0, 56, 176, 288, 363, each row the
 * previous row plus its span — so a span trimmed by 1 without moving every
 * card below it by 1 does not tighten the screen at all: it re-opens between
 * the cards exactly the 4px the gutter gave up, and the change would have
 * bought nothing. Trimming the defaults therefore means re-flowing every
 * composition, which is a different piece of work with its own collision
 * assertions (test/composition.test.ts) and its own review. Until then a card
 * keeps its old span and spends the reclaimed cell on its own content, which
 * is why cards that used to overflow their default overflow less, and the
 * shallowest of them (Tuning, Tool dock sensors) reached zero on the mock.
 * ───────────────────────────────────────────────────────────────────────────
 */
export const CARD_DEFS = {
	/** 7-axis DRO. */
	position: defineCard({
		title: "Position",
		ariaLabel: "Position",
		tip: "move.axes · move.currentMove",
		orientationToggle: true,
		// 95 -> 103 for the speed footer. MEASURED, not chosen: run through
		// contentRowSpan() (shell/panelCanvas.ts:277) against the rendered card
		// on the Machine screen, so the default tracks what the content
		// actually needs rather than a second hand-maintained guess at it.
		size: { colSpan: 156, rowSpan: 103 },
	}),
	/** Tools & heaters table: state + setpoint entry and per-heater actions. */
	"tools-heaters": defineCard({
		title: "Tools & heaters",
		ariaLabel: "Tools and heaters",
		tip: "tools · heat.heaters · M568 · M562",
		orientationToggle: true,
		size: { colSpan: 156, rowSpan: 110 },
	}),
	/** The print card — progress + pause/resume/cancel; Reprint when idle. */
	"active-job": defineCard({
		title: "Printing",
		ariaLabel: "Active job",
		tip: "job · state",
		class: "job-active",
		// 40 -> 46, MEASURED via contentRowSpan(). 40 never fit: Pause/Cancel
		// sat below the fold on every surface that placed this card. Moving them
		// onto the facts row cut the need from ~58 to 46; this closes the rest.
		size: { colSpan: 156, rowSpan: 46 },
	}),
	/**
	 * Same card with the three-source estimate breakdown (monitoring surfaces).
	 *
	 * The name must differ from "active-job" above. They were BOTH called
	 * "Printing", identical in every visible field — title, aria-label, tip,
	 * class, size — so the card picker, the lab's pills and the import review
	 * all showed two entries a person could not tell apart, while they are
	 * separate cards with separately remembered geometry. Resize one, later
	 * pick the other, and it reads exactly like a size that reverted (reported
	 * 2026-07-24). Alphabetising the picker put the two side by side, which
	 * made choosing between them a coin flip.
	 */
	"active-job-detailed": defineCard({
		title: "Printing · estimates",
		ariaLabel: "Active job, with estimates",
		tip: "job · state · estimates",
		class: "job-active",
		// 52, not the compact card's 46: this variant carries the extra
		// est-sources row. Measured the same way.
		size: { colSpan: 156, rowSpan: 52 },
	}),
	/** Endstops, filament monitors, probes. */
	sensors: defineCard({
		title: "Sensors",
		ariaLabel: "Sensors",
		// Just the subtree. The three leaves it holds — endstops, filamentMonitors,
		// probes — spelled the tip out to 300-odd px, and the header IS the card's
		// absolute minimum width (headerColSpan in shell/panelCanvas.ts), so
		// naming them cost the card a floor it never needed. Each row already
		// says which kind of sensor it is.
		tip: "sensors",
		orientationToggle: true,
		size: { colSpan: 156, rowSpan: 42 },
	}),
	/** Live heater chart. */
	temperatures: defineCard({
		title: "Temperatures",
		ariaLabel: "Temperatures",
		tip: "heat.heaters · live",
		size: { colSpan: 312, rowSpan: 80 },
	}),
	/** Console — reply log + G-code entry. */
	console: defineCard({
		title: "Console",
		ariaLabel: "Console",
		class: "console-panel",
		size: { colSpan: 312, rowSpan: 75 },
	}),
	/** Camera stream. The ONE encoding of the pinned condition (I3) — it
	 *  drives both the mount and the cell-release on composed screens. */
	camera: defineCard({
		title: "Camera",
		ariaLabel: "Camera",
		class: "cam-panel",
		size: { colSpan: 104, rowSpan: 75 },
		visibleWhen: ctx => ctx.config.config.cameraPrefs.pinned,
	}),
	/** Per-object cancel (M486) — already content-only, zero props. Always
	 *  shown: with no objects it says the job didn't specify any, rather than
	 *  vanishing (which reads as "the card is broken", not "nothing to cancel"). */
	"build-objects": defineCard({
		title: "Cancel Objects",
		ariaLabel: "Cancel Objects",
		tip: "M486 · job.build",
		size: { colSpan: 156, rowSpan: 53 },
	}),
	/** Live 3D toolpath of the active job. */
	"gcode-viewer": defineCard({
		title: "Toolpath",
		ariaLabel: "G-code toolpath",
		tip: "job.file · job.filePosition",
		size: { colSpan: 312, rowSpan: 180 },
	}),
	/** Per-layer print times — no layers until a print completes one; the body
	 *  says so rather than the card vanishing. */
	layers: defineCard({
		title: "Layer times",
		ariaLabel: "Layer times",
		tip: "job.layers",
		size: { colSpan: 312, rowSpan: 67 },
	}),
	/** Per-axis Home/Release table, plus the machine-wide row (G28/G32/M84). */
	homing: defineCard({
		title: "Homing",
		ariaLabel: "Homing",
		tip: "G28 · G32 · M84",
		// The axis letters (and their role names — "Z motor 1", "coupler") are the
		// redundancy this hides: the button beside them already reads Home X.
		labelsToggle: true,
		// Sized for the DEFAULT pitch (1.27) with 7 axes plus the machine-wide
		// row — 338px of content + 36px head + 22px of frame, rounded onto the
		// 4px quantum. A tighter pitch leaves slack, which the operator can
		// resize away; the reverse (sized for tight, overflowing at default)
		// would hide the last axis behind a scroll on a fresh install.
		// Measured 2026-07-29, was 51 when the card was a 2-column grid.
		size: { colSpan: 156, rowSpan: 101 },
	}),
	/** ATX PSU. state.atxPower is null on a board with no PS_ON port — the body
	 *  shows a message there rather than a DEAD switch (which is worse than
	 *  none), but the card no longer vanishes. */
	atx: defineCard({
		title: "ATX power",
		ariaLabel: "ATX power",
		tip: "M80 · M81",
		size: { colSpan: 156, rowSpan: 32 },
	}),
	/** The extruders: what each one is loaded with, and manual feed for the
	 *  current tool. A tool with no extruder appears in neither. Called
	 *  Extruders rather than Filament because it now holds both — the load
	 *  macros AND the G1 E that moves the selected one. */
	filament: defineCard({
		title: "Extruders",
		ariaLabel: "Extruders",
		tip: "M701 · M702 · M703 · G1 E",
		// +6 (one row) for the manual-feed footer.
		size: { colSpan: 156, rowSpan: 56 },
	}),
	/** Tools: select a tool by its label, plus its heater setpoints. */
	heaters: defineCard({
		title: "Tools",
		ariaLabel: "Tools",
		tip: "T · tools · heat.heaters",
		// 62 -> 115 when each tool gained a second setpoint field and two Set
		// buttons: the row no longer fits one line, so every tool is two lines
		// (entry, then modes). Sized for the DEFAULT pitch — 444px of content
		// at 1.27 — because a card sized for a tight pitch hides its last tool
		// behind a scroll on a fresh install. Measured 2026-07-29.
		size: { colSpan: 156, rowSpan: 115 },
	}),
	/** Jog pad, aux axes, coupler, extrude. */
	movement: defineCard({
		title: "Movement",
		ariaLabel: "Movement",
		tip: "M120 · G91 · M121",
		// Same redundancy as Homing: the axis letter sits beside a −/+ pair that
		// already carries it. Worth more here, where the letters are a whole
		// column down the left of the jog rows.
		labelsToggle: true,
		// 156x123 -> 99x76, and NOT the 156 the cards around it use: this one
		// stopped being a quarter-canvas card when the step bank moved out of a
		// full-width row above the jog table and into a column beside it. Both
		// numbers are the card AS ARRANGED in the Card Lab at the default pitch
		// (396 x 304px), which is also exactly where contentColSpan() and
		// contentRowSpan() put its stops — so the default is the card fitted to
		// its content on both axes, with no slack to resize away.
		//
		// A narrower card than Homing or Position beside it, so their right
		// edges no longer agree. Deliberate: the jog keys are fixed-width by
		// design (see .jog-table) and padding this out to 156 would be 228px of
		// empty ground inside the card rather than beside it.
		//
		// Lowering a default cannot shrink an existing layout — growToDefaults()
		// merges with Math.max(stored, coded), so this reaches fresh installs,
		// Reset Layout and the Card Lab only.
		size: { colSpan: 99, rowSpan: 76 },
	}),
	/** Manual fans only — thermostatic ones belong to the firmware. The body
	 *  says so when there are none rather than the card disappearing. */
	fans: defineCard({
		title: "Fans",
		ariaLabel: "Fans",
		tip: "M106",
		orientationToggle: true,
		size: { colSpan: 156, rowSpan: 62 },
	}),
	/** Arbitrary G-code re-sent on an interval to override a running job. */
	"pinned-commands": defineCard({
		title: "Pinned commands",
		ariaLabel: "Pinned commands",
		tip: "M-code · re-sent 0.5s",
		size: { colSpan: 156, rowSpan: 50 },
	}),
	/** Speed factor + babystep. */
	tuning: defineCard({
		title: "Tuning",
		ariaLabel: "Tuning",
		tip: "M220 · M221 · M290",
		size: { colSpan: 156, rowSpan: 33 },
	}),
	/** Job file listing (0:/gcodes) — click opens, never runs. */
	"job-files": defineCard({
		title: "Jobs",
		ariaLabel: "Job files",
		class: "jobs-browse",
		tip: ctx => ctx.service("jobsBrowser").browser.dir(),
		size: { colSpan: 156, rowSpan: 135 },
	}),
	/** Metadata + thumbnail + start/simulate for the selected job file. */
	"job-details": defineCard({
		title: ctx => baseName(ctx.service("jobsBrowser").selected()) || "Job details",
		ariaLabel: "Job details",
		class: "jobs-detail",
		tip: "rr_fileinfo",
		size: { colSpan: 156, rowSpan: 135 },
	}),
	/** The same job listing with Rename, Delete and the create/upload bar, on
	 *  its own browser so it can sit beside the Jobs card without moving it. */
	"jobs-inventory": defineCard({
		title: "Jobs · inventory",
		ariaLabel: "Jobs inventory",
		tip: ctx => ctx.service("jobsBrowser").browser.dir(),
		size: { colSpan: 156, rowSpan: 150 },
	}),
	/** Macro listing (0:/macros) with two-step Run. */
	macros: defineCard({
		title: "Macros",
		ariaLabel: "Macros",
		tip: ctx => ctx.service("macrosBrowser").browser.dir(),
		size: { colSpan: 130, rowSpan: 150 },
	}),
	/** The same macro listing with Rename and Delete, on its own browser so it
	 *  can sit beside the Macros card without moving it. */
	"macros-inventory": defineCard({
		title: "Macros · inventory",
		ariaLabel: "Macros inventory",
		tip: ctx => ctx.service("macrosBrowser").browser.dir(),
		size: { colSpan: 130, rowSpan: 150 },
	}),
	/** Macro editor — placeholder until a file is opened. */
	"macros-editor": defineCard({
		title: ctx => ctx.service("macrosBrowser").selected() ?? "Editor",
		// Distinct from system-editor's: the visible title is dynamic (the open
		// file's name), so for anyone navigating by screen reader this label is
		// the ONLY way to tell the two editors apart.
		ariaLabel: "Macro editor",
		class: "editor-card",
		size: { colSpan: 182, rowSpan: 150 },
	}),
	/**
	 * Which machine the UI thinks it is talking to — identity, its source
	 * (board uniqueId vs the MAC fallback), and any settings the operator
	 * should know about (a profile claimed from another board's SD card, or
	 * sections re-read from this board's card after an upgrade). See
	 * cards/SystemCards.tsx and docs/superpowers/specs/
	 * 2026-08-24-machine-profile-design.md §3.
	 */
	"machine-identity": defineCard({
		title: "This machine",
		ariaLabel: "Machine identity",
		tip: "boards · network.interfaces",
		size: { colSpan: 312, rowSpan: 56 },
	}),
	/** System file listing (0:/sys) — sys files are invoked by the firmware,
	 *  so there is deliberately no Run here. */
	"system-files": defineCard({
		title: "System files",
		ariaLabel: "System files",
		tip: ctx => ctx.service("sysBrowser").browser.dir(),
		size: { colSpan: 104, rowSpan: 120 },
	}),
	/** System file editor. */
	"system-editor": defineCard({
		title: ctx => ctx.service("sysBrowser").selected() ?? "Editor",
		ariaLabel: "System file editor",
		class: "editor-card",
		size: { colSpan: 208, rowSpan: 120 },
	}),
	/** The live object model, browsable. */
	"object-model": defineCard({
		title: "Object model",
		ariaLabel: "Object model",
		class: "om-card",
		tip: "live · rr_model",
		size: { colSpan: 156, rowSpan: 112 },
	}),
	/** Per-board firmware update (M997). */
	firmware: defineCard({
		title: "Firmware update",
		ariaLabel: "Firmware update",
		tip: "M997 · boards",
		size: { colSpan: 156, rowSpan: 112 },
	}),
	/** The height map grid + save/reload. */
	heightmap: defineCard({
		title: "Height map",
		ariaLabel: "Height map",
		// Not a fixed filename any more — the Mesh card chooses which map is
		// loaded, and naming one here would be wrong for every other choice.
		tip: "0:/sys/*.csv",
		size: { colSpan: 208, rowSpan: 150 },
	}),
	/** Single-point re-probe + manual nudge for the selected cell. */
	"probe-point": defineCard({
		title: "Probe point",
		ariaLabel: "Probe point",
		tip: "config: bed.probePointCommand",
		size: { colSpan: 104, rowSpan: 90 },
	}),
	/** Which height map is in use, and probe / load / save-as / clear. */
	mesh: defineCard({
		title: "Mesh",
		ariaLabel: "Mesh bed compensation",
		tip: "G29 · G29 S1 · G29 S2 · G29 S3",
		size: { colSpan: 104, rowSpan: 60 },
	}),
	/** Bed tramming (bed.g), the re-home it requires, and the last result. */
	"bed-tram": defineCard({
		title: "Bed tram",
		ariaLabel: "Bed tram",
		tip: "G32 · G28 Z",
		size: { colSpan: 104, rowSpan: 40 },
	}),
	/** Axis role labels (config overlay). */
	"axis-roles": defineCard({
		title: "Axis roles",
		ariaLabel: "Axis roles",
		size: { colSpan: 156, rowSpan: 109 },
	}),
	/**
	 * Per-heater chart line colours (config overlay).
	 *
	 * RE-MEASURED after #142 (Card Lab arithmetic, mock, --u: 4px, 1600x1200,
	 * 2026-08-28): contentColSpan 92 -> 85 cells, contentRowSpan 69 (unchanged).
	 * The 7 cells are the reserved clash slot leaving the min-content probe;
	 * what stops the drag now is the card's own HEADER (298.5px of title, tip
	 * and controls) rather than its rows, which measure 204px.
	 *
	 * RE-MEASURED AGAIN after the per-row Reset got a reserved slot: contentColSpan
	 * STILL 85. The slot is `flex: 0 0 calc(15 * var(--u))` and does put 60px into
	 * the row's min-content (274px per row, from 214), but the header still wants
	 * 298.5px and the body's padding puts it at 330.5px, so the rows are nowhere
	 * near binding and the fix is free at this card's stop. What it bought,
	 * measured the same session: overriding one heater's colour used to move that
	 * row's clash slot 68.5px sideways, and now moves it 0.
	 *
	 * The size below is NOT that floor and is deliberately left alone: `size`
	 * is the card's natural geometry (see this file's redesigned-cards-grow
	 * invariant), it already sat well ABOVE the floor before #142, and shrinking
	 * it would re-lay the Settings screen, which #142 did not ask for.
	 */
	"heater-colors": defineCard({
		title: "Chart colours",
		ariaLabel: "Chart colours",
		tip: "heat.heaters",
		size: { colSpan: 156, rowSpan: 76 },
	}),
	/**
	 * The cold/warm/hot ramp for temperature readings (config overlay).
	 *
	 * RE-MEASURED after #142, same conditions: contentColSpan 104 -> 76 cells,
	 * contentRowSpan 48 (unchanged). Header-bound at 260.2px, as above; `size`
	 * stays the natural geometry for the same reason.
	 *
	 * RE-MEASURED AGAIN after the band labels went from prose to symbols (Gabe,
	 * 2026-08-28: "temp gradient is shrinking below the prose horizontally").
	 * The STOPS DID NOT MOVE — still 76 x 48, body min-content still 292.2px —
	 * because this card has been header-bound since the first #142 change: the
	 * title, tip and controls want 260.2px and the widest ROW now wants 235.8px.
	 *
	 * WHAT MOVED IS THE TRUNCATION BAND, and the figures below REPLACE an
	 * earlier set that mixed two different measurements into one sentence. Two
	 * quantities are involved and they are not the same quantity:
	 *
	 *   · a row's MIN-content is what it contributes to the card's floor. It is
	 *     the width of the row's widest unbreakable piece, so shortening a
	 *     label only moves it if that label held the record.
	 *   · a row's MAX-content is the width at which that row is fully drawn —
	 *     nothing wrapped, nothing clipped. That is the "every label legible"
	 *     number, and it is always the larger of the two.
	 *
	 * Re-measured from scratch 2026-08-28 in Edge on the mock, at data-scale 100
	 * (--u 4px, 1600x1200), by setting `width: min-content` / `max-content` on
	 * each `.field` row and on `.panel-body` and reading getBoundingClientRect —
	 * the same construction panelCanvas.ts's intrinsicWidthPx uses, so these
	 * numbers and contentColSpan's are taken the same way. Prose labels were
	 * restored in the source for the BEFORE pass and the AFTER pass re-run on
	 * the shipped strings, rather than recalled:
	 *
	 *                       min-content            max-content
	 *   row          before      after       before      after
	 *   Cold          249.9  ->  228.6        285.3  ->  258.6
	 *   Warm          235.8  ->  235.8        281.7  ->  281.7
	 *   Hot           250.2  ->  235.8        319.1  ->  265.9
	 *   widest        250.2  ->  235.8        319.1  ->  281.7
	 *
	 * The card's floor is `body min-content + gutter` = 292.2 + 8 = 300.2px
	 * (76 cells), unchanged, because the header's 260.2px + the body's 32px of
	 * padding beat every row in both passes. Full legibility is
	 * `widest max-content + gutter`: 327.1px before, 289.7px after.
	 *
	 * SO THE BAND CLOSED COMPLETELY, which is stronger than the "~44px to ~8px"
	 * the earlier note claimed and is the honest answer to the ruling. Before,
	 * the card could be dragged to 300.2px and the Hot label needed 327.1px, so
	 * there were 26.9px of width in which a label was cut. After, full legibility
	 * (289.7px) is BELOW the floor (300.2px): there is no width this card can be
	 * dragged to at which any of the three labels is not fully drawn. The 14.4px
	 * that came off the widest min-content and the 37.4px that came off full
	 * legibility are different quantities and were never required to agree.
	 */
	"thermal-colors": defineCard({
		title: "Temperature Gradient",
		ariaLabel: "Temperature Gradient",
		size: { colSpan: 156, rowSpan: 60 },
	}),
	/** Tool dock presence sensors (config overlay). */
	"tool-dock-sensors": defineCard({
		title: "Tool dock sensors",
		ariaLabel: "Tool dock sensors",
		size: { colSpan: 156, rowSpan: 76 },
	}),
	/** The Bed view's probe-point command template (config overlay). */
	"bed-probe": defineCard({
		title: "Bed probing",
		ariaLabel: "Bed probing",
		// 45 -> 54 (#138): the label moved onto its own row above the input, so
		// the field row went 47px -> 74px. MEASURED with auditCard against the
		// `idle` scenario, 2026-08-28 headless — rowStop 54 at forced heights of
		// 200/120/80/60/40 cells (spread 0) and 54 at scale 075, 100 AND 150.
		// The card was ALREADY 7px over its old 45-cell pin before this change
		// (body client 172 / scroll 179), which is #94 drift this corrects in
		// passing rather than inherits. colStop 55 at every scale step — the
		// same number as before the stack, which is the check that mattered:
		// `width: auto` on the stacked input took it to 61/61/64 and that
		// three-cell scale drift is why the input is contained (see app.css).
		size: { colSpan: 156, rowSpan: 54 },
	}),
	/** Camera stream URL (config overlay). */
	"camera-config": defineCard({
		title: "Camera URL",
		ariaLabel: "Camera URL",
		// 40 -> 49 (#138), the same +9 as bed-probe and for the same reason —
		// the two cards share the stacked-field modifier, so they move together.
		// MEASURED the same way: rowStop 49 at forced heights 200/120/80/60/40
		// (spread 0) and at scale 075, 100 and 150; colStop 53 at all three,
		// unchanged from before the stack.
		size: { colSpan: 156, rowSpan: 49 },
	}),
	/** Sensor display names (config overlay). */
	"sensor-names": defineCard({
		title: "Sensor names",
		ariaLabel: "Sensor names",
		size: { colSpan: 312, rowSpan: 72 },
	}),
	/**
	 * The Shaping Lab's own settings: the motion envelope (the ONLY way one
	 * comes to exist — spec I8) and the capture-run defaults.
	 *
	 * The title is load-bearing, not decoration: the lab's refusal copy sends
	 * the operator to "Settings › Input shaping" by name, and a test pins the
	 * phrase to this def plus the screen this card sits on.
	 *
	 * The accelerometer address and its sampling rate were two more sections
	 * here until #140 moved them to `accelerometers` — machine facts, not
	 * shaping settings. The card lost two of its four sections; the rowSpan
	 * below is re-measured, not scaled down by eye.
	 */
	"settings-shaping": defineCard({
		title: "Input shaping",
		ariaLabel: "Input shaping",
		// No longer "· M955 P" — the codes went with the sampling rows.
		tip: "config.shaping",
		// Was 88 × 178 with four sections (Card Lab, 2026-08-23). RE-MEASURED with
		// auditCard after the #140 split, against the `multi-tool` scenario: row
		// stop 112, col stop 87, unchanged across all three height probes and with
		// no child drift. 156 wide to sit in the Settings screen's column like its
		// neighbours — that colSpan is the screen's choice, not the card's floor.
		size: { colSpan: 156, rowSpan: 112 },
	}),
	/**
	 * The machine's accelerometers: address per tool, and the sample rate and
	 * resolution the sensor is running.
	 *
	 * NOT shaping-branded, in id or title, and that is the whole reason it
	 * exists separately (#140). An accelerometer address is a property of the
	 * printer — #47's machine-dynamics battery reads the same two facts — and
	 * until this card existed, an operator asking which sensor is on T2 had to
	 * look under a feature card to find out.
	 */
	accelerometers: defineCard({
		title: "Accelerometers",
		ariaLabel: "Accelerometers",
		tip: "config.shaping.accelByTool · M955",
		// RE-MEASURED with auditCard against the `multi-tool` scenario — four
		// tools, which is this card's worst case because every row it has is
		// per-tool — after #142 combined the two sections into one row per tool
		// and took the reserved slots out of the min-content probe (mock, --u:
		// 4px, 1600x1200, 2026-08-28):
		//
		//   #140, two sections of four rows   row 128, col 117 (body 456.1px)
		//   rows combined, slots unchanged    row  64, col 173 (body 680.1px)
		//   + the .accel-status remedy        row  64, col 114 (body 444.1px)
		//   + the floor and width fixes below row  64, col 132 (body 518.8px)
		//
		// Half the height, and a WIDER row that nonetheless reports a NARROWER
		// floor than the eight-row card did — the two reserved sentences were
		// worth 59 cells of min-content between them. Identical stops at
		// data-scale 075 / 100 / 150 (0 cell drift), no child drift, and the
		// floor still counts the body (chrome 17 of 64).
		//
		// THE LAST LINE IS 18 CELLS BACK, and both halves of it are bought
		// deliberately (Gabe, 2026-08-28, dragging this card on the mock: "the
		// accelerometer card narrows just a hair too much, it clips the text
		// 'not asked'"):
		//
		//   +10.5u  .accel-reply's min-width, 4u -> 14.5u. 4u was the width of
		//           the MARK, borrowed from .accel-status, and the argument for
		//           a mark-sized floor is "the slot is empty in the ordinary
		//           session". reportText is total and never returns "" — every
		//           row on a machine that has not been Read says "not asked" —
		//           so this slot has no empty state to degrade to and its floor
		//           has to fit the message instead. 14.25u measured, at all
		//           three scale steps. (app.css, .accel-reply)
		//   + 8.16u .fb-tool.accel-set's declared width. The arming button's
		//           label changes SET -> CONFIRM, 10.34u -> 18.195u, and an
		//           undeclared button is padding around its label: arming a row
		//           moved the Read button, the reply and the verdict 31.4px.
		//           Declared at 18.5u, that shift is now 0.
		//
		// Re-verified after both: 132 cells at data-scale 075 / 100 / 150 with
		// zero drift, and at that width "not asked" is fully drawn on all four
		// rows at all three steps (measured scrollWidth == clientWidth, and
		// looked at). The 312-column placement below is UNAFFECTED — it was
		// argued from legibility of the two sentences at 156 columns, not from
		// the floor, and 132 is still far under 312.
		//
		// 312 wide, and that is a CHANGE from #140's 156: one row per tool is
		// twice the row, and at 156 (≈616px) the address verdict and the board's
		// reply cannot both be legible — measured, both are intact from 676px up.
		// The screen has 312 columns, so the card takes the pair rather than
		// clipping every reply it draws.
		size: { colSpan: 312, rowSpan: 64 },
	}),
	/** Config snapshot history + one-click revert. */
	"saved-versions": defineCard({
		title: "Saved versions",
		ariaLabel: "Saved versions",
		// Where the settings actually live, in the header rather than as a
		// paragraph in the body — prose rewraps as the card is resized, and this
		// card is a list of dated rows that explains itself.
		tip: CONFIG_FILE,
		size: { colSpan: 156, rowSpan: 40 },
	}),
	/** Save the config overlay to the machine's SD / reset everything —
	 *  the former Settings save-bar, now composable like everything else. */
	"config-save": defineCard({
		title: "Configuration",
		ariaLabel: "Configuration save",
		tip: "0:/sys/dwc-ng-config.json",
		size: { colSpan: 312, rowSpan: 26 },
	}),
	// ---- Shaping Lab (docs/superpowers/specs/2026-08-22-shaping-lab-campaign-design.md)
	// Eight cards in the order the operator follows: measure, look, choose,
	// prove, apply. Ids are `shaping-*` rather than `tuning-*` because `tuning`
	// is already the speed-factor/babystep card and a second meaning of the word
	// on the same registry is a card picker nobody can read.
	//
	// EVERY rowSpan below is MEASURED, not chosen: contentRowSpan() in the Card
	// Lab against the `shaping-measured` scenario (four tools, T0 fingerprinted,
	// ranked and verified), audited at the 720 / 400 / 200 px probes so the
	// number is a floor and not a reading of the card's current height. Column
	// floors all came out between 66 and 118, so 156 leaves every one of them
	// slack on a two-column screen; the colSpan is the screen's, not the card's.
	/** Per-tool session state and what M593 the machine is running now. */
	"shaping-status": defineCard({
		title: "Shaping",
		ariaLabel: "Shaping status",
		tip: "M593 · M955 · M956",
		// Four tool rows of two lines each, the running-shaper line, the
		// next-step region and the five-step workflow list.
		//
		// The tools table used to be MEASURED with every tpost row COLLAPSED,
		// on the argument that reserving ~11u for a disclosure most sessions use
		// once was worse than letting the body scroll while it was open. #128
		// overruled that outright (Gabe: "the whole card should be fixed size so
		// expanding the tool row doesn't change the contents size"), so the note
		// arguing for it is gone rather than left standing beside a design that
		// no longer works that way. The table now lives in `.shp-tools-region`,
		// whose height is DECLARED at 28u — enough for the header, the tool row
		// and the open macro row — so this floor is the same number whether the
		// disclosure is open or shut, which is the whole point of the number.
		//
		// 138 -> 156 for the next-step region (GIT_37): the caption+action row
		// declares 8.5u, its sentence 5u on one line, and the rule and margins
		// under it 4.5u; the step rows each gained an ordinal track and a state
		// chip, both of which fit inside the row height the button already set.
		// Re-measured with auditCard against `shaping-measured`: row stop 156,
		// unchanged across the 720 / 400 / 200 px probes, body worth 141 of it.
		// The COLUMN floor came down rather than up, 171 -> 125: the step
		// sentences were voting their longest nowrap line into the card's
		// minimum width, which had this card's floor 15 cells WIDER than the
		// card itself (see .shp-step-note in app.css). 125 is now the tools
		// table's declared tracks and nothing else.
		//
		// 156 -> 158 for the tool picker (GIT_90): a `.shp-active` row (5u
		// declared) between the message line and the table, present whether the
		// machine reports four tools or one. Re-measured via contentRowSpan()
		// against `shaping-measured` (unchanged, still four tools): row stop 158,
		// unchanged across the 720 / 400 / 200 px probes, body worth 143 of it,
		// no child moved. colStop held at 125 — the picker's row is shorter than
		// the tools table it sits above, so it set no new floor. Scale sweep
		// 158/158 rows, 125/125 cols, both deltas 0. The table itself now
		// contributes exactly ONE row (or the one-row fallback) rather than up to
		// four, which is most of why the net cost of an entire new control is
		// two rows and not more: the picker adds 5u, the table gives back most
		// of what it used to cost with several tools' rows open.
		//
		// 158 -> 139 for the removal of the "Next" region (GIT_90 fix round 4,
		// Gabe: "awkward navigation" — a second, redundant `runStep` entry point
		// beside the per-step list's own). Re-measured via contentRowSpan()
		// against `shaping-measured`: row stop 139, unchanged across the
		// 720 / 400 / 200 px probes, body worth 124 of it, no child moved.
		// colStop held at 125 — the removed block never set the column floor,
		// only the tools table did. The walk block is now the card's first
		// child; nothing above the step list has height that varies with
		// `workflow()`'s progress, so the list's own positions do not move as
		// steps complete (verified live: identical row `top` offsets before and
		// after a step's readiness text changed entirely, and before and after
		// running one).
		//
		// 139 -> 108 for the removal of the "Means" walk (GIT_90 fix round 5,
		// Gabe: "there's a big section above the picker that we don't need in the
		// shaping card" — a deliberate override of the walk's own rationale, not
		// an accident; see the file-header note in ShapingCards.tsx). Re-measured
		// via contentRowSpan() against `shaping-measured`: row stop 108, unchanged
		// across the 720 / 400 / 200 px probes (reproduced twice), body worth 93
		// of it, no child moved. colStop held at 125 — the walk never set the
		// column floor, only the tools table did.
		//
		// 108 -> 102 for the message row (#98, live UAT: "remove all of the dead
		// space from the top of the Shaping card"). `.shp-msg` held 4.5u of
		// line-height plus 1u of margin whether or not there was a message; it
		// now renders only when `message()` is non-empty. Re-measured via
		// contentRowSpan() against `shaping-measured` (empty message): row stop
		// 102, reproduced twice, body worth 87 of it, no child moved across the
		// 720 / 400 / 200 px probes. colStop held at 125 — the message row never
		// set the column floor.
		//
		// 102 -> 116 for #128, and the +14 is two separate numbers.
		//
		// +2 is UNIVERSAL and is a correction, not a cost: `.card-head` declares
		// `margin-bottom: calc(2 * var(--u))`, which `margin-bottom: auto`
		// overrode and `--absorbs-slack: 1` then excluded from contentRowSpan's
		// sum entirely. With the auto margin deleted the real 8px is counted, so
		// every one of the 53 cards in the Card Lab sweep reported exactly +2
		// rows — measured before and after on 2026-08-28. Nothing renders
		// differently; the stored pins were simply two rows short of their own
		// content, which is a finding for #94 and is not fixed here.
		//
		// +12 is this card's: `.shp-tools-region` is 28u where the shut table
		// measured 16.75u. That reservation is what buys the fixed size. Note
		// what it is NOT — it is not 102 bumped until the open row fits, which
		// the ticket forbids on sight as a number correct until the next scale
		// step. 116 is the floor of a card whose content size does not vary:
		// re-measured via "Audit this card" against `shaping-measured`, row stop
		// 116 with the disclosure SHUT and 116 with it OPEN, unchanged across the
		// 720 / 400 / 200 px probes, body worth 99 of it, no child moved on
		// either axis. Scale sweep 116/116 rows, 125/125 cols, both deltas 0.
		//
		// The message row's old caveat is void with it: it noted that a message
		// toggling on or off moved the picker/table/steps only when the card sat
		// AT its floor, because the head's auto margin absorbed the change
		// anywhere else. There is no such absorption now — content is anchored to
		// the top at every card height, so a toggle moves what is below it and
		// nothing above it, whatever size the card is.
		size: { colSpan: 156, rowSpan: 116 },
	}),
	/** The test motion: the box it may move in, the sensor, the moves it will
	 *  make, and the armed control that makes them. */
	"shaping-capture": defineCard({
		title: "Capture",
		ariaLabel: "Shaping capture",
		tip: "M955 · M956 · G1",
		// 66 -> 140 when the card gained the run (D3): it was two fact rows and a
		// hint, and it is now a motion editor, an XY map of the planned moves, an
		// armed run control and a progress strip. MEASURED with auditCard against
		// the `shaping-measured` scenario with an envelope set (the state the card
		// can actually plan in), and it is a FLOOR rather than a reading: the two
		// fact rows declare 6.5u each, the two editor rows 8u each, the map stage
		// 46u, its caption 5u, the run bar 8u, the progress track 1.5u and the
		// status box 20u, and every one of those is a declared length. Checked
		// with no envelope, with a 12-capture measure plan drawn, and with the run
		// control armed — 139 rows in all three, body worth 124 of it, NO CHILD
		// MOVED. The scale sweep reported 139 at 0.75 and 140 at 1.5, so 140 was
		// the number that was a floor at both.
		//
		// RE-SWEPT 2026-08-29 (GIT_170), `shaping-measured`, both scale steps:
		// 148 rows × 113 cols, identical at 0.75 and 1.5. One of those cells is
		// this change — the same sweep on the parent commit (f2f8d07) read
		// 149 × 114, and at the intermediate zero-gutter commit c59b398 it read
		// 147 × 112 — so colStop is 113, still inside the 156 the screen gives
		// it, still set by the motion editor's declared tracks.
		// The ROW figure has also drifted from the 139/140 recorded above, by 9
		// cells that predate GIT_170 and are NOT diagnosed here: the number is
		// reported as measured rather than reconciled, because a guess about
		// where 9 cells went would read as a finding.
		//
		// The map's stage declares its WIDTH as well as its height, unlike the
		// canvas stages on Decay and Sweep. An SVG's legs are DOM children, so a
		// stage that filled the card moved all thirteen of them on a resize (9
		// moved children, measured); a declared box moves none, and a map that
		// means the same thing at every card width is the better drawing anyway.
		size: { colSpan: 156, rowSpan: 140 },
	}),
	/** One capture at a time: the ring-down and the mode fitted from it. */
	"shaping-decay": defineCard({
		title: "Decay",
		ariaLabel: "Shaping decay",
		tip: "0:/sys/accelerometer",
		// 75 -> 159 for the chart (E1), 159 -> 189 for the board browser and the
		// fingerprint bar. MEASURED with auditCard against the
		// `shaping-measured` scenario, and it is a floor rather than a reading:
		// the figure row declares 55u, the verdict box 15u, the controls 8u,
		// the filter 8u, the list 60u of scroll, the batch bar 8u and its report
		// 10u. Every one of those is a declared length, so the number is the
		// same with 276 captures listed, with 12, and with none — checked at all
		// three. The scale sweep put it at 189 x 133 cells at BOTH 0.75 and 1.5
		// (rowDelta 0, colDelta 0), which is the claim that matters: the chart
		// is a canvas and the filter row is full of text, and either sized in
		// screen pixels would have broken it.
		//
		// RE-SWEPT 2026-08-29 (GIT_170), `shaping-measured`, both scale steps:
		// 154 rows × 132 cols, identical at 0.75 and 1.5 — the invariant still
		// holds, which is what this note exists to record. One of those cells
		// is this change (the parent commit f2f8d07 read 155 × 133 in the same
		// sweep; the zero-gutter commit c59b398 read 153 × 131), so colStop is
		// 132 and still sits inside the 156 this screen gives, still set by the
		// captures table's declared tracks. The ROW
		// figure differs from the 189 above by 34 cells that predate GIT_170;
		// as with Capture, that gap is reported and not explained here.
		size: { colSpan: 156, rowSpan: 189 },
	}),
	/** Frequency × speed: which peaks shaping can touch and which it cannot. */
	"shaping-sweep": defineCard({
		title: "Sweep heat map",
		ariaLabel: "Shaping sweep heat map",
		tip: "0:/sys/accelerometer · speed × Hz",
		// 39 -> 118 when the three text rows became the heat map (E2). MEASURED
		// with auditCard against the `shaping-measured` scenario, and it is a
		// FLOOR rather than a reading of some content: the tool row and the run
		// row declare 8u each, the plot stage 60u, the readout 5u and the status
		// line 15u, and every one of those is a declared length. Checked with no
		// sweep, with the nine-speed `lowspeed_stock_X` matrix drawn, and with a
		// pointer over the loudest cell — no child moved. colStop 125 sits
		// inside the 156 the screen gives it, and is set by the run row's
		// declared tracks.
		//
		// 118 -> 134 (#136), RE-MEASURED 2026-08-28 headless against the same
		// three states, because the old number was taken while two of the
		// card's own rows were lying about their size:
		//   · `.shp-caveat` had `overflow: hidden` and no flex declaration, so
		//     its automatic minimum was ZERO and it was squeezed flat — 0px at
		//     this card's own coded pin. It contributed nothing to the sum
		//     contentRowSpan takes, and the sum itself moved with the card
		//     (rowStop 129 at rowSpan 200, 121 at 118). +8u of it is real.
		//   · `.shp-sweep-note` went from three lines to four, so the idle
		//     sentence is not cut at any width at or above colStop 125. +5u.
		// Both rows now declare a floor, so the measured number is a floor
		// again: rowStop 134 at rowSpans 200/160/134/130/118/100/60 with spread
		// 0, and 134 at scale 075, 100 AND 150 — the number is the same at
		// every scale step rather than the largest of three.
		//
		// RE-SWEPT 2026-08-29 (GIT_170): 133 × 124, identical at 0.75 and 1.5.
		// This is the one shaping card whose recorded figure was still exactly
		// current before the change — the same sweep on the parent commit
		// (f2f8d07) read 134 × 125, and the zero-gutter commit c59b398 read
		// 132 × 123 — so the whole of the −1/−1 here is half the gutter
		// leaving the sum, and nothing else moved.
		//
		// The ID is unchanged on purpose: it is the key saved layouts are stored
		// under, so renaming it would drop the card off every screen the
		// operator has already arranged.
		size: { colSpan: 156, rowSpan: 134 },
	}),
	/** Ranked shapers with their predicted residual and robustness. */
	"shaping-candidates": defineCard({
		title: "Candidates",
		ariaLabel: "Shaping candidates",
		tip: "M593 F S · predicted",
		// Same 60u scroll as Decay, hence the same number.
		size: { colSpan: 156, rowSpan: 75 },
	}),
	/** The two-mode custom train, as M593's H/T form takes it. */
	"shaping-custom": defineCard({
		title: "Custom shaper",
		ariaLabel: "Custom shaper",
		tip: 'M593 P"custom" H T',
		size: { colSpan: 156, rowSpan: 71 },
	}),
	/** Predicted versus measured, and any mode the shaper introduced itself. */
	"shaping-verify": defineCard({
		title: "Verify",
		ariaLabel: "Shaping verify",
		tip: "M593 · M956 · measured",
		size: { colSpan: 156, rowSpan: 62 },
	}),
	/** The line to put on the machine, and the macro it belongs in. */
	"shaping-apply": defineCard({
		title: "Apply",
		ariaLabel: "Shaping apply",
		tip: "M593 · 0:/sys/tpostN.g",
		size: { colSpan: 156, rowSpan: 50 },
	}),
	/** Define the materials this machine knows about: the filament directories
	 *  under 0:/filaments and their load/unload/config macros. Machine
	 *  management, not a file browser. */
	"filament-editor": defineCard({
		title: "Filament editor",
		ariaLabel: "Filament editor",
		tip: "0:/filaments · M703",
		size: { colSpan: 312, rowSpan: 130 },
	}),
} as const satisfies Record<string, CardMeta>;

/** I1: the only card identity that exists past a boundary. */
export type CardId = keyof typeof CARD_DEFS;

const CARD_IDS = Object.keys(CARD_DEFS) as CardId[];

export function allCardIds(): readonly CardId[] {
	return CARD_IDS;
}

/**
 * Parse, don't validate: a runtime string (storage, import, URL) becomes a
 * CardId here or nowhere. Unknown ids yield null — callers drop the slot
 * tolerantly, never the screen.
 */
export function parseCardId(raw: string): CardId | null {
	return (CARD_IDS as string[]).includes(raw) ? (raw as CardId) : null;
}

/** A card's display name where no ctx exists (pickers, the lab's pills,
 *  import reviews): static titles verbatim, dynamic ones fall back to the id.
 *  Lives here (not the JSX wrapper) so pure modules can import it. */
export function cardTitleOf(id: CardId): string {
	const meta = CARD_DEFS[id];
	// A dynamic title needs a ctx we do not have here — this is for pickers and
	// lists, not for the rendered card. Fall back to the ARIA LABEL, not the id:
	// the label is a static human name that already exists on every card
	// ("Job details"), while the id is kebab-case and sorted into the Card Lab's
	// alphabetical rail as though it were one, which is how "job-details" ended
	// up sitting between "Jobs" and "Layer times".
	return typeof meta.title === "string" ? meta.title : meta.ariaLabel;
}
