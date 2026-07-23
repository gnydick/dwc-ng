/**
 * Example specs for the card-authoring editor's "insert example" — a working
 * starting point an author edits rather than a blank page.
 *
 * The spindle card is the machine-diversity proof: CNC controls this FFF
 * appliance never shipped, expressed entirely in data. G-code forms verified
 * against reference/duet-gcode.md (M3/M4/M5): S is spindle RPM in CNC mode
 * (laser power in laser mode); RRF 3.5+ accepts them in FFF mode too.
 */
import type { ControlSpec } from "./spec.ts";

export const SPINDLE_EXAMPLE: ControlSpec = {
	inputs: {
		rpm: { kind: "number", label: "RPM", default: 12000 },
	},
	nodes: [
		{
			type: "row",
			label: "Spindle",
			items: [
				{ input: "rpm" },
				{ type: "gcode-button", label: "CW", template: "M3 S{input.rpm}", variant: "go" },
				{ type: "gcode-button", label: "CCW", template: "M4 S{input.rpm}" },
				{ type: "gcode-button", label: "Stop", template: "M5", variant: "danger" },
			],
		},
	],
};

export const SPINDLE_EXAMPLE_NAME = "Spindle";
export const SPINDLE_EXAMPLE_JSON = JSON.stringify(SPINDLE_EXAMPLE, null, 2);
