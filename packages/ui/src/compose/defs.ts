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
		visibleWhen: ctx => ctx.config.config.camera.pinned,
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
	/** Per-heater chart line colours (config overlay). */
	"heater-colors": defineCard({
		title: "Chart colours",
		ariaLabel: "Chart colours",
		tip: "heat.heaters",
		size: { colSpan: 156, rowSpan: 76 },
	}),
	/** The cold/warm/hot ramp for temperature readings (config overlay). */
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
		size: { colSpan: 156, rowSpan: 45 },
	}),
	/** Camera stream URL (config overlay). */
	"camera-config": defineCard({
		title: "Camera URL",
		ariaLabel: "Camera URL",
		size: { colSpan: 156, rowSpan: 40 },
	}),
	/** Sensor display names (config overlay). */
	"sensor-names": defineCard({
		title: "Sensor names",
		ariaLabel: "Sensor names",
		size: { colSpan: 312, rowSpan: 72 },
	}),
	/**
	 * The Shaping Lab's own settings: the motion envelope (the ONLY way one
	 * comes to exist — spec I8), the capture-run defaults, and which
	 * accelerometer belongs to which tool.
	 *
	 * The title is load-bearing, not decoration: the lab's refusal copy sends
	 * the operator to "Settings › Input shaping" by name, and a test pins the
	 * phrase to this def plus the screen this card sits on.
	 */
	"settings-shaping": defineCard({
		title: "Input shaping",
		ariaLabel: "Input shaping",
		tip: "config.shaping · M955 P",
		// Measured in the Card Lab, 2026-08-23: floor 88 cols × 178 rows, stable
		// across the height probes and with no child drift. 156 wide to sit in
		// the Settings screen's column like its neighbours.
		size: { colSpan: 156, rowSpan: 178 },
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
		// Four tool rows of two lines each, the running-shaper line, and the
		// five-step workflow list. MEASURED with every tpost row COLLAPSED,
		// which is how the card opens: one open row needs ~11 more and all four
		// need ~44, and reserving that for a disclosure most sessions use once
		// is worse than letting the body scroll while it is open.
		size: { colSpan: 156, rowSpan: 138 },
	}),
	/** The test motion: the box it may move in, the sensor, and the run. */
	"shaping-capture": defineCard({
		title: "Capture",
		ariaLabel: "Shaping capture",
		tip: "M955 · M956 · G1",
		size: { colSpan: 156, rowSpan: 66 },
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
		// three. The scale sweep puts it at 189 x 133 cells at BOTH 0.75 and 1.5
		// (rowDelta 0, colDelta 0), which is the claim that matters: the chart
		// is a canvas and the filter row is full of text, and either sized in
		// screen pixels would have broken it. colStop 133 is set by the captures
		// table's declared tracks and sits inside the 156 this screen gives.
		size: { colSpan: 156, rowSpan: 189 },
	}),
	/** Frequency × speed: which peaks shaping can touch and which it cannot. */
	"shaping-sweep": defineCard({
		title: "Speed sweep",
		ariaLabel: "Shaping speed sweep",
		tip: "M956 · G1 F",
		// The smallest of the eight: measured with no sweep recorded, which is
		// the state it ships in. The heatmap (task E2) will raise this.
		size: { colSpan: 156, rowSpan: 39 },
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
