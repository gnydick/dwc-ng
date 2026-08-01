/**
 * The pinned-command re-assert loop.
 *
 * Every INTERVAL_MS, all ENABLED pins are concatenated into ONE G-code string
 * and sent as a single request. Batching is the whole point: however many
 * commands are pinned, the loop costs the machine a fixed ~2 requests/sec, so
 * it stays within RRF's weak-embedded-server budget (CLAUDE.md hard
 * constraint). It also means the pins arrive together each tick rather than
 * racing as separate requests.
 *
 * This is the mechanism behind a user-requested exception to the
 * controls-are-1:1-with-gcode rule (see PinnedCommand): while enabled, the app
 * is re-authoring these values against whatever the running job asks for.
 *
 * It sends through the SAME guarded connector every control uses, so the dev
 * write guard still gates it — unarmed, each tick's send simply rejects locally
 * and is swallowed, never reaching the network.
 */
import { operatorTyped } from "./commands.ts";
import type { GcodeCommand } from "../connector/types.ts";
import type { PinnedCommand } from "../config/types.ts";

export const PIN_INTERVAL_MS = 500;

export interface PinSenderDeps {
	/** The current pins (read fresh each tick — reactivity handled by caller). */
	pins: () => readonly PinnedCommand[];
	/** True when it is worth sending at all (connected). */
	canSend: () => boolean;
	/** The guarded connector's sendCode. */
	sendCode: (code: GcodeCommand) => Promise<unknown>;
	/** Override the interval (tests). */
	intervalMs?: number;
}

/** Start the loop; returns a stop function. */
export function startPinSender(deps: PinSenderDeps): () => void {
	// A tick is skipped while the previous send is still in flight, so a slow
	// machine can never accumulate a backlog of overlapping re-asserts.
	let inFlight = false;

	const tick = (): void => {
		if (inFlight || !deps.canSend()) return;
		const code = batchPins(deps.pins());
		if (code === null) return;
		inFlight = true;
		void deps.sendCode(code)
			.catch(() => undefined)
			.finally(() => { inFlight = false; });
	};

	const timer = setInterval(tick, deps.intervalMs ?? PIN_INTERVAL_MS);
	return () => clearInterval(timer);
}

/**
 * The single G-code for one tick, or null when there is nothing to send.
 *
 * Pure and exported so the batching — which enabled pins fire, in what order,
 * joined how — is testable without timers or a connector.
 *
 * A pin's text is the OPERATOR's, typed into Settings, so it enters through the
 * one named escape hatch rather than pretending to be a builder's output.
 */
export function batchPins(pins: readonly PinnedCommand[]): GcodeCommand | null {
	const commands = pins
		.filter(p => p.enabled && p.command.trim() !== "")
		.map(p => p.command.trim());
	return commands.length > 0 ? operatorTyped(commands.join("\n")) : null;
}
