import { createSignal, onCleanup } from "solid-js";
import { useApp } from "../shell/context.ts";

/** How long the sent/failed acknowledgement stays visible. */
const ACK_MS = { sent: 1100, failed: 3000 } as const;

type SendState = "idle" | "sending" | "sent" | "failed";

/**
 * The signature control primitive: a button that wears its G-code. The label
 * says what it does; the mono stamp shows the exact command it fires. A button
 * IS its command — that's the 1:1 guarantee made structural. `command` is a
 * prop (not a child) so callers can compute it reactively (e.g. a heater button
 * whose stamp updates live as the target temp changes).
 *
 * Sending is acknowledged ON THE BUTTON, and the acknowledgement follows the
 * connector's promise rather than the click: "sent" means the board actually
 * took it, "failed" means it didn't (a rejected code, or the dev write guard).
 * A click that reports success while the command never left would be worse
 * than no feedback at all.
 *
 * Every state is a colour change on fixed geometry — nothing resizes, moves, or
 * reflows between them, so a control never shifts under the pointer.
 */
export function GcodeButton(props: {
	label: string;
	command: string;
	variant?: "go" | "danger" | "quiet";
	disabled?: boolean;
	/** Called after the command is sent (e.g. to clear an input). */
	onSent?: () => void;
	/** Hide the mono stamp (dense rows where the command is obvious/shown once). */
	stamp?: boolean;
	/**
	 * This button's mode is the one the machine is currently IN — it lights up.
	 * Purely a mirror of reported state: an engaged button stays clickable (you
	 * may well want to re-send Active after editing the setpoint), because a
	 * control that greys itself out is the UI deciding what the firmware will
	 * accept, which this project does not do.
	 */
	engaged?: boolean;
	/** Extra class(es) for layout variants (e.g. the jog pad's square keys). */
	class?: string;
	/**
	 * Accessible name, when the visible label is only unambiguous because of
	 * where the button SITS. The homing table has two buttons reading "All" —
	 * one in the Home column, one in Release — and column position is a purely
	 * visual cue that a screen reader does not convey.
	 */
	ariaLabel?: string;
	/**
	 * There is an edit sitting in this button's field that has not been sent.
	 * Lights the ack dot in copper and pulses it — the same fixed-size dot the
	 * send states use, so signalling "unapplied" cannot change the button's box.
	 */
	pending?: boolean;
}) {
	const app = useApp();
	const [state, setState] = createSignal<SendState>("idle");
	let timer: ReturnType<typeof setTimeout> | undefined;

	// A button unmounted mid-flight (panel hidden, view switched) must not have
	// its timer fire into a disposed scope.
	onCleanup(() => clearTimeout(timer));

	const settle = (next: "sent" | "failed"): void => {
		setState(next);
		clearTimeout(timer);
		timer = setTimeout(() => setState("idle"), ACK_MS[next]);
	};

	const send = async (): Promise<void> => {
		clearTimeout(timer);
		setState("sending");
		try {
			await app.connector.sendCode(props.command);
			settle("sent");
			props.onSent?.();
		} catch {
			// Rejected by the board or blocked by the dev write guard. The reason
			// is surfaced in the console drawer; the button only reports that it
			// did NOT happen, which is the part the finger needs to know.
			settle("failed");
		}
	};

	return (
		<button
			class={`gcode-btn ${props.class ?? ""}`}
			classList={{
				"gcode-go": props.variant === "go",
				"gcode-danger": props.variant === "danger",
				"gcode-quiet": props.variant === "quiet",
				"is-engaged": props.engaged === true,
				// Only while idle: a live send's own dot outranks it, or the
				// button would claim "unapplied" during the very send applying it.
				"is-pending": props.pending === true && state() === "idle",
				"is-sending": state() === "sending",
				"is-sent": state() === "sent",
				"is-failed": state() === "failed",
			}}
			disabled={props.disabled}
			aria-label={props.ariaLabel}
			aria-pressed={props.engaged}
			title={props.command}
			onClick={() => void send()}
		>
			<span class="gcode-label">{props.label}</span>
			{props.stamp !== false && <span class="gcode-cmd">{props.command}</span>}
			{/* Always in the DOM at a fixed size — only its colour changes, so an
			    acknowledgement can never resize the button it appears on. */}
			<span class="gcode-ack" aria-hidden="true" />
		</button>
	);
}
