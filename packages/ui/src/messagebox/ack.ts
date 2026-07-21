/**
 * M291 message boxes and the M292 that answers them.
 *
 * Why this is correctness rather than cosmetics: when RRF raises a box with
 * mode >= okOnly it BLOCKS, waiting for M292. A UI that doesn't render it shows
 * a machine that has silently stopped mid-job with no explanation and no way
 * forward. Toolchange and filament-change macros use these constantly.
 *
 * Everything here is pure so the wire format is testable without a browser or a
 * board. Forms verified against the vendored DWC
 * (reference/dwc/src/components/dialogs/MessageBoxDialog.vue) and the object
 * model (reference/objectmodel/src/state/MessageBox.ts) — not from memory.
 */
import type { MessageBox } from "../om/types.ts";

/** reference/objectmodel/src/state/MessageBox.ts (MessageBoxMode) — order is the wire value. */
export const MessageBoxMode = {
	noButtons: 0,
	closeOnly: 1,
	okOnly: 2,
	okCancel: 3,
	multipleChoice: 4,
	intInput: 5,
	floatInput: 6,
	stringInput: 7,
} as const;

/** What the operator did: dismissed it, or supplied a value/choice. */
export interface AckInput {
	cancelled?: boolean;
	/** Number for int/float, string for text, choice INDEX for multiple choice. */
	value?: number | string;
}

/**
 * True when the firmware is waiting. Modes 0 and 1 are informational and may be
 * dismissed locally; anything from okOnly up must be answered, so the prompt
 * has to be unskippable and cannot be closed by clicking away.
 */
export function isBlocking(box: MessageBox): boolean {
	return box.mode >= MessageBoxMode.okOnly;
}

export function needsInput(box: MessageBox): boolean {
	return box.mode === MessageBoxMode.intInput
		|| box.mode === MessageBoxMode.floatInput
		|| box.mode === MessageBoxMode.stringInput;
}

/**
 * Seed value for the input field. `default` is typed loosely in the model, so a
 * string default on a numeric box (or vice versa) must not leak through as the
 * wrong type — that would produce a malformed M292 expression.
 */
export function initialInput(box: MessageBox): number | string {
	if (box.mode === MessageBoxMode.stringInput) {
		return typeof box.default === "string" ? box.default : "";
	}
	return typeof box.default === "number" ? box.default : 0;
}

/** Indices into move.axes whose jog controls this box asks us to show. */
export function axisControlIndices(box: MessageBox): number[] {
	const bits = box.axisControls ?? 0;
	const out: number[] = [];
	for (let i = 0; i < 32; i++) {
		if ((bits & (1 << i)) !== 0) out.push(i);
	}
	return out;
}

/**
 * Quote a string as an RRF expression literal. RRF escapes a quote by doubling
 * it; an unescaped quote from an operator's free text would otherwise produce a
 * malformed expression and leave the machine blocked forever.
 */
function quote(value: string): string {
	return `"${value.replace(/"/g, '""').replace(/'/g, "''")}"`;
}

/**
 * The M292 that answers `box`, or null when there is nothing to answer.
 *
 * `S<seq>` is on every form deliberately: RRF ignores an M292 whose seq doesn't
 * match the box it currently has open, so echoing it is what prevents a click
 * from acknowledging a DIFFERENT box that replaced this one between render and
 * press. Tool-change macros that raise several boxes in a row make that a real
 * race, not a theoretical one.
 */
export function ackCommand(box: MessageBox, input: AckInput | null): string | null {
	if (box.mode === MessageBoxMode.noButtons) return null;

	// Cancel is a distinct answer (P1), never "OK with an empty value".
	if (input?.cancelled === true) return `M292 P1 S${box.seq}`;

	switch (box.mode) {
		case MessageBoxMode.closeOnly:
		case MessageBoxMode.okOnly:
		case MessageBoxMode.okCancel:
			return `M292 S${box.seq}`;
		case MessageBoxMode.multipleChoice:
		case MessageBoxMode.intInput:
		case MessageBoxMode.floatInput:
			return `M292 R{${Number(input?.value ?? 0)}} S${box.seq}`;
		case MessageBoxMode.stringInput:
			return `M292 R{${quote(String(input?.value ?? ""))}} S${box.seq}`;
		default:
			// An unknown future mode still needs answering, or the machine hangs.
			return `M292 S${box.seq}`;
	}
}
