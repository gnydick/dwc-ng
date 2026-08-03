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
import type { GcodeCommand } from "@dwc-ng/connector";
import type { MessageBox } from "../om/types.ts";
import { cmd } from "../control/commands.ts";

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

// String quoting comes from the one authority (control/commands.ts
// gcodeQuote): an unescaped quote from an operator's free text would
// produce a malformed expression and leave the machine blocked forever.

/**
 * The M292 that answers `box`, or null when there is nothing to answer.
 *
 * `S<seq>` is on every form deliberately: RRF ignores an M292 whose seq doesn't
 * match the box it currently has open, so echoing it is what prevents a click
 * from acknowledging a DIFFERENT box that replaced this one between render and
 * press. Tool-change macros that raise several boxes in a row make that a real
 * race, not a theoretical one.
 *
 * @invariant ack-answers-the-box-it-was-shown
 * @rung 6  choke-point over four signatures that already require it — every
 *          M292 builder takes `seq` as its first mandatory parameter, so an
 *          unsequenced ack does not compile, and this function is their SOLE
 *          caller (verified by search), reading seq from the box it was handed
 * @why RRF ignores an M292 whose seq does not match the box it currently has
 *      open. A toolchange macro raises several boxes in a row, so the operator
 *      can press OK on a box that was replaced between render and click —
 *      without the echo that press answers the NEW box, agreeing to something
 *      never read, and the machine acts on it
 * @debt the seq is a bare number, so the builders would accept any. Promote by
 *       making it a branded BoxSeq obtainable only from a MessageBox, which
 *       also removes the need for this function to be the sole caller.
 */
export function ackCommand(box: MessageBox, input: AckInput | null): GcodeCommand | null {
	if (box.mode === MessageBoxMode.noButtons) return null;

	// Cancel is a distinct answer (P1), never "OK with an empty value".
	if (input?.cancelled === true) return cmd.ackCancel(box.seq);

	// The M292 forms live in control/commands.ts with every other G-code form —
	// this module decides WHICH answer a mode takes, not how one is spelled.
	switch (box.mode) {
		case MessageBoxMode.closeOnly:
		case MessageBoxMode.okOnly:
		case MessageBoxMode.okCancel:
			return cmd.ackOk(box.seq);
		case MessageBoxMode.multipleChoice:
		case MessageBoxMode.intInput:
		case MessageBoxMode.floatInput:
			return cmd.ackNumber(box.seq, Number(input?.value ?? 0));
		case MessageBoxMode.stringInput:
			return cmd.ackText(box.seq, String(input?.value ?? ""));
		/*
		 * @invariant every-blocking-box-has-an-answer
		 * @rung 6  choke-point with a deliberate default — this is the only
		 *          function producing an M292, and it returns null for exactly
		 *          one mode (noButtons, which RRF does not block on). Every
		 *          other input, including a mode this build has never heard of,
		 *          leaves here with a command
		 * @why the union is OPEN: MessageBoxMode is firmware's, and a future RRF
		 *      may add a mode. Exhaustiveness is the wrong tool here — the cost
		 *      of not answering is not a missing feature but a machine stopped
		 *      mid-job, blocking on an M292 no button can send, with the job
		 *      still loaded and the heaters still on
		 * @debt a default arm is normally the anti-pattern (technique 9), and it
		 *       is chosen here because the failure is asymmetric. What it cannot
		 *       do is TELL anyone: an unknown mode is answered OK and looks
		 *       identical to a known one. Promote by returning the answer
		 *       alongside whether the mode was recognised, so the prompt can say
		 *       "this firmware asked something this UI does not understand"
		 *       rather than silently agreeing on the operator's behalf.
		 */
		default:
			// An unknown future mode still needs answering, or the machine hangs.
			return cmd.ackOk(box.seq);
	}
}
