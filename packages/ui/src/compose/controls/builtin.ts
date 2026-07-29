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
			type: "grid",
			items: [
				{ type: "gcode-button", label: "Home All", template: "G28", variant: "go" },
				{
					type: "forEach",
					from: "move.axes[visible]",
					as: "axis",
					enrich: "axisLabel",
					node: { type: "gcode-button", label: "Home {axis.label}", template: "G28 {axis.letter}" },
				},
				// Bed tramming (G32 → bed.g) as the last grid cell, right after
				// the per-axis homes (…Home C) — bed.g wants the machine homed
				// first, so it reads as the step after homing.
				{ type: "gcode-button", label: "Bed Tram", template: "G32", variant: "go" },
			],
		},
		{
			// Releasing drops the homed state the grid above establishes, so it
			// belongs on this card. Stamp-free: sixteen full-size stamps would
			// not fit, and the card tip already names M84.
			type: "row",
			label: "Release",
			class: "release-row",
			items: [
				{ type: "gcode-button", label: "All", template: "M84", variant: "danger", stamp: false, class: "rel-key" },
				{
					type: "forEach",
					from: "move.axes[visible]",
					as: "axis",
					node: { type: "gcode-button", label: "{axis.letter}", template: "M84 {axis.letter}", variant: "quiet", stamp: false, class: "rel-key" },
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
