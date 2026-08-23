/**
 * The four numbers a capture run is made of, and what happens when one is
 * committed.
 *
 * TWO cards edit them — Settings › Input shaping, where they are set up, and
 * the Capture card, where they are adjusted with the map of the run in front of
 * you — and they are the SAME four numbers in the same config section. A second
 * table of labels, steps and patch functions beside the first is the duplicated
 * processing step this repo treats as a design fault: the two would agree until
 * somebody added a fifth field to one of them, and the failure mode is a
 * setting the operator can see on one card and cannot reach on the other.
 *
 * NOTHING HERE VALIDATES ANYTHING. `parseShapingDefaults` (config/parse.ts) is
 * the one gate on what a legal motion default is, and `setShaping` runs it.
 * This module's whole job is to commit through that gate and then READ BACK,
 * because a refused default is otherwise invisible: the field is dropped, the
 * effective value simply does not change, and an editor that wrote and moved on
 * would appear to have accepted it.
 *
 * @invariant one-motion-field-table
 * @rung 6  choke-point — `MOTION_FIELDS` is the only description of these four
 *          settings and `commitMotionField` the only writer of one from an
 *          editor. Both cards iterate the table rather than naming fields, so a
 *          field added here appears on both and a field added to neither cannot
 *          be edited at all
 * @why the Capture card states the run an armed confirm is about to perform.
 *      If its editor and the Settings editor could describe different sets of
 *      numbers, the run the operator approved and the run the plan was built
 *      from would be describable apart
 */
import type { ShapingDefaults } from "../config/types.ts";

export interface MotionField {
	/** Which of the four. Also the input's stable key for a `<For>`. */
	readonly key: keyof ShapingDefaults;
	readonly label: string;
	/** What the number means, in the words beside the input. */
	readonly unit: string;
	/** The `step` attribute — the granularity the spinner moves in. */
	readonly step: string;
	/** Short form, for the Capture card's tighter row. */
	readonly short: string;
	read(d: ShapingDefaults): number;
	patch(value: number): Partial<ShapingDefaults>;
}

export const MOTION_FIELDS: readonly MotionField[] = [
	{
		key: "distMm",
		label: "Distance",
		unit: "mm",
		short: "mm",
		step: "5",
		read: (d) => d.distMm,
		patch: (distMm) => ({ distMm }),
	},
	{
		key: "speedMmS",
		label: "Speed",
		unit: "mm/s",
		short: "mm/s",
		step: "10",
		read: (d) => d.speedMmS,
		patch: (speedMmS) => ({ speedMmS }),
	},
	{
		key: "repeats",
		label: "Repeats",
		unit: "per axis",
		short: "reps",
		step: "1",
		read: (d) => d.repeats,
		patch: (repeats) => ({ repeats }),
	},
	{
		key: "samples",
		label: "Samples",
		unit: "M956 S",
		short: "samples",
		step: "100",
		read: (d) => d.samples,
		patch: (samples) => ({ samples }),
	},
];

export interface MotionCommit {
	/** What the config holds after the write — what the input is put back to. */
	readonly kept: number;
	/** Empty when the gate took the value; otherwise which field was refused
	 *  and what stands instead. */
	readonly note: string;
}

/**
 * Commit one field through the config gate and report what actually happened.
 *
 * `apply` writes, `read` reads BACK. That order is the point: the gate drops a
 * field it refuses, so "what is in the config now" is the only honest answer to
 * "was that accepted", and asking the gate's rule a second time here would be a
 * second opinion about a decision that has already been made.
 *
 * Pure over its two callbacks, so node can drive every refusal case without a
 * config store, a DOM or a machine.
 */
export function commitMotionField(
	field: MotionField,
	typed: number,
	apply: (patch: Partial<ShapingDefaults>) => void,
	read: () => ShapingDefaults,
): MotionCommit {
	apply(field.patch(typed));
	const kept = field.read(read());
	return {
		kept,
		note: kept === typed ? "" : `${field.label} refused — kept ${String(kept)}.`,
	};
}
