/**
 * Card definitions — the data half of the registry, and the source of CardId.
 *
 * Design: docs/composable-cards-design.md. Invariants owned here:
 *  - I1  `CardId = keyof typeof CARD_DEFS`: an unregistered id is a compile
 *        error in code; runtime strings pass parseCardId() or cease to exist.
 *  - I3  `visibleWhen` is the ONE visibility predicate — ComposedView derives
 *        BOTH the JSX mount and the canvas isActive cell-release from it.
 *  - I4  `size` is THE natural geometry; screens only place cards.
 *
 * Bodies (JSX) live in ./cards.tsx as a Record<CardId, body> — the compiler
 * makes the two halves total over each other in both directions: a def
 * without a body, or a body without a def, is a type error, not a review
 * item. Kept apart so this module stays pure and node-testable (type
 * stripping cannot load JSX).
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
		// The axis letter beside a Home button that already reads "Home X" is
		// the redundancy this toggle exists for.
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
