/**
 * Is the accelerometer this tool is addressed at actually on the machine?
 *
 * ITS OWN MODULE for the reason `resultsCodec.ts` is its own module: one file
 * was carrying two things with different lifetimes. `preconditions.ts` is 18 KB
 * of run-time gating that only the Shaping Lab needs and that is now behind the
 * lazy boundary (#126) — but the Settings › Input shaping card, which is
 * deliberately EAGER (small, on a screen the operator uses constantly), needs
 * exactly this one fifteen-line read to grey out a sampling control for a tool
 * whose sensor is not there. Importing the whole of `preconditions.ts` for it
 * put the entire Lab's gating on the critical path of every cold load.
 *
 * Same shape-vs-format split as `results.ts` / `resultsCodec.ts`, recorded in
 * packages/deploy/eager-budget.json: a module that is two modules.
 *
 * ONE definition, not a copy. `preconditions.ts` and `procedure.ts` import it
 * from here, so "the sensor `read` insisted was present" and "the sensor the
 * run loop watches `runs` on" cannot become two different lookups.
 */
import type { AccelAddr } from "../control/commands.ts";
import type { Accelerometer, ObjectModel } from "../om/types.ts";

/**
 * The accelerometer at this address, or null when that board has none.
 *
 * The address is `board.device` (or the bare `0` the mainboard answers to), so
 * the board half is what selects the entry in `boards`. Matching on
 * `canAddress` rather than the array index is the point: the index is the
 * order the firmware happens to report boards in, and addressing a capture at
 * the wrong board produces a real-looking file from the wrong sensor.
 */
export function accelerometerOf(om: ObjectModel, accel: AccelAddr): Accelerometer | null {
	const boardAddress = Number(String(accel).split(".")[0]);
	if (!Number.isInteger(boardAddress)) return null;
	const board = om.boards.find((b) => b !== null && (b.canAddress ?? 0) === boardAddress);
	return board?.accelerometer ?? null;
}
