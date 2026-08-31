/**
 * Send/ack state for ControlList's data-defined emitters (slider, toggle):
 * the acknowledgement follows the connector's PROMISE, not the gesture —
 * "sent" means the board took it, "failed" means it did not (a rejected
 * code, or the dev write guard) — and every state is a colour change on
 * fixed geometry (the GcodeButton discipline).
 *
 * Shared helper (rung 5, the weakest acceptable form — extracted when the
 * toggle would have been the SECOND paste of the slider's hand-rolled copy).
 * Promotion path: fold slider + toggle rendering onto a GcodeButton-grade
 * primitive that owns both the send route and the ack, if a third
 * data-defined emitter appears.
 */
import { createSignal, onCleanup } from "solid-js";
import type { GcodeCommand } from "@dwc-ng/connector";

export type SendFeedbackState = "idle" | "sending" | "sent" | "failed";

/** How long the sent acknowledgement stays visible (GcodeButton's ACK_MS). */
const SENT_ACK_MS = 1100;

export function createSendFeedback(sendCode: (code: GcodeCommand) => Promise<unknown>): {
	state: () => SendFeedbackState;
	error: () => string;
	fire: (code: GcodeCommand) => Promise<void>;
} {
	const [state, setState] = createSignal<SendFeedbackState>("idle");
	const [error, setError] = createSignal("");
	let ackTimer: ReturnType<typeof setTimeout> | undefined;
	// A control unmounted mid-flight must not have its timer fire into a
	// disposed scope — so this helper is called from component setup only.
	onCleanup(() => clearTimeout(ackTimer));

	const fire = async (code: GcodeCommand): Promise<void> => {
		clearTimeout(ackTimer);
		setState("sending");
		setError("");
		try {
			await sendCode(code);
			setState("sent");
			ackTimer = setTimeout(() => setState("idle"), SENT_ACK_MS);
		} catch (err) {
			// Refused. Colour and the reserved refusal slot only — geometry is
			// fixed, so a refusal cannot move the control under the pointer.
			setState("failed");
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return { state, error, fire };
}
