import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { CONTROL_COMPOSITION } from "../compose/screens.ts";

/**
 * Control — the interactive surface (Machine stays a read-only glance) — a
 * composed screen (design phase A4). The card bodies live in
 * cards/ControlCards.tsx; every control is 1:1 with G-code and wears its
 * command. No GUI-encoded safety: the firmware is the authority.
 */
export default function Control() {
	return <ComposedScreen storageKey="dwc-ng.canvas.control" composition={CONTROL_COMPOSITION} class="control" />;
}
