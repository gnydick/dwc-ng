import { Show, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import type { Heater } from "../om/types.ts";

/**
 * A heater's state, and — when it has faulted — the only way to clear it.
 *
 * RRF latches a heater fault and refuses to heat until M562 clears it, so
 * surfacing the fault without offering the reset (what we did before) leaves
 * the operator stuck at the UI with no path forward but the console.
 *
 * The reset is deliberately two-step, matching the run-a-macro confirm in
 * Macros.tsx. A fault means the firmware caught something real — a detached
 * thermistor, a runaway — and clearing it re-arms that heater. This is UI
 * friction on a destructive action, NOT a machine-state verdict: we never
 * decide whether resetting is safe, we only make it hard to do by reflex.
 * (DWC instead disables its button behind a 5s countdown.)
 */
export function HeaterState(props: { heater: Heater; index: number }) {
	const app = useApp();
	const [armed, setArmed] = createSignal(false);

	const reset = (): void => {
		if (!armed()) {
			setArmed(true);
			return;
		}
		setArmed(false);
		void app.connector.sendCode(cmd.resetHeaterFault(props.index)).catch(() => undefined);
	};

	return (
		<Show
			when={props.heater.state === "fault"}
			fallback={<span class={`heat-state ${props.heater.state}`}>{props.heater.state}</span>}
		>
			<button
				class="heat-state fault heat-reset"
				classList={{ armed: armed() }}
				title={`Clear the fault on heater ${props.index} (M562 P${props.index})`}
				onClick={reset}
				onBlur={() => setArmed(false)}
			>
				{armed() ? "confirm" : "fault"}
			</button>
		</Show>
	);
}
