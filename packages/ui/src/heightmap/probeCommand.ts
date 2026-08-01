import { operatorTyped } from "../control/commands.ts";
import type { GcodeCommand } from "../connector/types.ts";

/**
 * The probe command is a template the operator owns, not motion this UI
 * composes.
 *
 * Clearance, probe deploy, tool state — and on this machine the dock guard
 * `mesh.g` already enforces before it will probe at all — differ per machine
 * and belong in config, not here. The UI sends exactly one command, which it
 * displays.
 */

/**
 * Trim to a compact G-code literal: 24.333333 -> "24.333", 5 -> "5".
 *
 * Three decimals because the grid's Y step is 290/15 = 19.3333…, so rows land
 * on fractional coordinates; sending the raw float would put a
 * twelve-significant-figure number in the command line.
 */
const coord = (v: number): string => String(Number(v.toFixed(3)));

/**
 * The template is config the operator wrote, so this goes through the one named
 * escape hatch rather than pretending to be a builder's output. Only the
 * coordinates are ours; the command shape is theirs.
 */
export function buildProbeCommand(template: string, x: number, y: number): GcodeCommand {
	return operatorTyped(template.split("{x}").join(coord(x)).split("{y}").join(coord(y)));
}
