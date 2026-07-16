import { useApp } from "../shell/context.ts";

/**
 * The signature control primitive: a button that wears its G-code. The label
 * says what it does; the mono stamp shows the exact command it fires. A button
 * IS its command — that's the 1:1 guarantee made structural. `command` is a
 * prop (not a child) so callers can compute it reactively (e.g. a heater button
 * whose stamp updates live as the target temp changes).
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
}) {
	const app = useApp();
	const send = (): void => {
		void app.connector.sendCode(props.command).catch(() => undefined);
		props.onSent?.();
	};
	return (
		<button
			class="gcode-btn"
			classList={{
				"gcode-go": props.variant === "go",
				"gcode-danger": props.variant === "danger",
				"gcode-quiet": props.variant === "quiet",
			}}
			disabled={props.disabled}
			title={props.command}
			onClick={send}
		>
			<span class="gcode-label">{props.label}</span>
			{props.stamp !== false && <span class="gcode-cmd">{props.command}</span>}
		</button>
	);
}
