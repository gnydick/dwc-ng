import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { SYSTEM_COMPOSITION } from "../compose/screens.ts";

/**
 * System — the 0:/sys listing + editor (sys files are invoked by the
 * firmware, so there is deliberately no Run), firmware update, and the
 * object-model inspector. A composed screen (A5); the browser/selection
 * state lives in the sysBrowser service.
 */
export default function System() {
	return <ComposedScreen storageKey="dwc-ng.canvas.system" composition={SYSTEM_COMPOSITION} class="system" />;
}
