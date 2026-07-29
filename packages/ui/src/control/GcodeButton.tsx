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
	/**
	 * Called after the command is sent (e.g. to clear an input), with the exact
	 * text that went out. The argument matters: `command` is reactive, and by
	 * the time a send resolves the machine has often already been re-polled and
	 * recomputed it into something else — a caller that re-read props.command
	 * here would be asking what the button will do NEXT, not what it just did.
	 */
	onSent?: (sent: string) => void;
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
	/**
	 * Extra class(es) for layout variants (e.g. the jog pad's square keys).
	 * STATIC ONLY. `class` and `classList` both write this element's class
	 * attribute, and a `class` re-assignment overwrites the whole string —
	 * wiping every classList-managed flag until something else toggles it. A
	 * reactive `class` here silently unsets is-engaged/is-sent. Anything that
	 * varies belongs in classList below, as its own prop.
	 */
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
	/**
	 * This mode's heater has REACHED its setpoint. Only meaningful alongside
	 * `engaged`: together they mean "in this mode and arrived", which is what
	 * earns the filled ground. Engaged without it stays outlined.
	 */
	atTarget?: boolean;
	/** Reading is above the setpoint by more than the overshoot margin. */
	overTarget?: boolean;
	/**
	 * A setpoint was just written from this button's field and the machine has
	 * acknowledged it, but the mode has not been set yet — so the NEXT click is
	 * the one that acts on it. Without this the two-click sequence has an
	 * invisible middle: the first click lands, nothing changes on screen, and
	 * there is nothing to say a second press is what starts the heater.
	 */
	applied?: boolean;
	/**
	 * This press leaves the machine SHORT of what the key stands for, so its
	 * acknowledgement flashes copper instead of green.
	 *
	 * The flash reports the state you end up in, not which command went out. On
	 * a heater's mode key the first press only stores the target — the tool is
	 * still not in that mode — so copper, the same colour the pending dot uses
	 * for "there is more to do here". The press that actually switches the mode
	 * gets the green one, because after it there is nothing left.
	 */
	ackAccent?: boolean;
}) {
	const app = useApp();
	const [state, setState] = createSignal<SendState>("idle");
	// Snapshotted when the send starts: props.ackAccent is derived from the
	// machine's own state, which the send itself changes — left reactive, the
	// flash would switch colour halfway through as the poll lands.
	const [ackAccent, setAckAccent] = createSignal(false);
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
		// Read ONCE, up front: this is the command this press is committed to,
		// whatever props.command becomes while it is in flight.
		const sending = props.command;
		setAckAccent(props.ackAccent === true);
		try {
			await app.connector.sendCode(sending);
			settle("sent");
			props.onSent?.(sending);
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
				"at-target": props.atTarget === true,
				"over-target": props.overTarget === true,
				"is-applied": props.applied === true,
				// Snapshot, not props.ackAccent: the flash must keep the colour of
				// the press that produced it.
				"ack-mode": ackAccent(),
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
