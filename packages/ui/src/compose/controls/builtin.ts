/**
 * Built-in control specs — the first cards WRITTEN IN the control vocabulary
 * (phase B dogfood): Homing and Movement are now data rendered by
 * ControlList, exercising every primitive a user-authored card will use
 * (gcode-button templates, forEach over OM selectors with except/enrich,
 * jog-pad/axis-jog bound to shared inputs, rows/grids).
 *
 * G-code forms: motion primitives emit through control/commands.ts inside the
 * renderer; the raw templates below are welded to the same cmd.* authority by
 * test/control-spec.test.ts — a template drifting from commands.ts fails CI,
 * so the two cannot quietly disagree (the data mirrors the authority, the
 * test enforces the mirror).
 */
import { compileControlSpec } from "./spec.ts";

export const HOMING_SPEC = compileControlSpec({
	inputs: {},
	nodes: [
		{
			// One row per axis, Home and Release as COLUMNS. Previously these
			// were two separate blocks — a 184px-tracked grid of "Home U · Z
			// motor 1" buttons, then a wrapping bank of single-letter release
			// keys — so the same axis appeared twice, in two idioms, at two
			// sizes. As a table the axis is named once and its two verbs line
			// up under their headings.
			//
			// The column tracks live on THIS container and every row spends
			// them via display: contents (see .home-table), so Home and Release
			// align across all seven axes by construction.
			type: "row",
			class: "home-table",
			items: [
				{
					// The machine-wide row, IN the table's own columns rather
					// than above it. "All" appears twice on purpose: the column
					// it sits in supplies the verb, exactly as it does for every
					// axis row below. That is a visual cue only, so each carries
					// an explicit accessible name — a screen reader would
					// otherwise announce two identical "All" buttons.
					// Tram takes the axis-name slot: G32 acts on the machine,
					// not on one axis, and bed.g wants it homed first.
					type: "row",
					class: "home-row",
					items: [
						{ type: "gcode-button", label: "Tram", template: "G32", variant: "go", stamp: false, aria: "Tram the bed" },
						{ type: "gcode-button", label: "All", template: "G28", variant: "go", stamp: false, aria: "Home all axes" },
						{ type: "gcode-button", label: "All", template: "M84", variant: "danger", stamp: false, aria: "Release all motors" },
					],
				},
				{
					type: "forEach",
					from: "move.axes[visible]",
					as: "axis",
					enrich: "axisLabel",
					node: {
						type: "row",
						class: "home-row",
						// Letter and role in separate slots — the role renders as
						// the <small> beside the letter, so a long role name
						// cannot widen the button columns.
						label: "{axis.letter}",
						sub: "{axis.role}",
						items: [
							{ type: "gcode-button", label: "Home", template: "G28 {axis.letter}", stamp: false },
							{ type: "gcode-button", label: "Release", template: "M84 {axis.letter}", variant: "quiet", stamp: false },
						],
					},
				},
			],
		},
	],
});

export const MOVEMENT_SPEC = compileControlSpec({
	inputs: {
		step: { kind: "chips", label: "Step", default: 1, options: [0.1, 1, 10, 100], unit: "mm" },
		feed: { kind: "number", label: "Feed", default: 6000 },
		extMm: { kind: "number", label: "mm", default: 5 },
		extFeed: { kind: "number", label: "F", default: 300 },
	},
	nodes: [
		{ type: "row", label: "Step", class: "step-row", items: [{ input: "step" }, { input: "feed" }] },
		{
			// EVERY visible axis, one row each, in one table — no cardinal pad.
			// The pad only ever covered X/Y/Z, so a 7-axis machine read as two
			// unrelated interfaces: a compass for three axes and a list for the
			// rest, with the same jog meaning two different gestures.
			//
			// This is a `row` (not a `grid`) purely so it can carry a class: the
			// column tracks live on THIS container and every axis row spends them
			// via `display: contents`, so the −/+ columns align across rows by
			// construction rather than by the axis letters happening to measure
			// the same. Adding an axis cannot shift the buttons under a finger.
			//
			// The jog-pad primitive is untouched and still available to
			// user-authored cards; the built-in card just stops using it.
			type: "row",
			class: "jog-table",
			items: [
				{
					type: "forEach",
					from: "move.axes[visible]",
					as: "axis",
					node: { type: "axis-jog", axisVar: "axis", step: "step", feed: "feed" },
				},
			],
		},
		{
			// The coupler row exists exactly when a C axis does — a forEach over
			// a filtered selector doubles as the existence gate.
			type: "forEach",
			from: "move.axes[letter=C]",
			as: "axis",
			node: {
				type: "row",
				label: "Coupler",
				sub: "C",
				class: "coupler-row coupler-stack",
				items: [
					{ type: "gcode-button", label: "Lock", template: 'M98 P"/macros/tool_lock"' },
					{ type: "gcode-button", label: "Unlock", template: 'M98 P"/macros/tool_unlock"', variant: "quiet" },
				],
			},
		},
		{
			type: "row",
			label: "Extruder",
			class: "extrude-row extrude-stack",
			items: [
				{ input: "extMm" },
				{ input: "extFeed" },
				{ type: "gcode-button", label: "Retract", template: "M83\nG1 E-{input.extMm} F{input.extFeed}", stamp: false },
				{ type: "gcode-button", label: "Extrude", template: "M83\nG1 E{input.extMm} F{input.extFeed}", stamp: false },
			],
		},
	],
});
