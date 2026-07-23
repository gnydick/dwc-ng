import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { MACROS_COMPOSITION } from "../compose/screens.ts";

/**
 * Macros — the 0:/macros listing with an explicit two-step Run (files never
 * run on click) and the editor beside it. A composed screen (A5); the
 * browser/selection state lives in the macrosBrowser service.
 */
export default function Macros() {
	return <ComposedScreen storageKey="dwc-ng.canvas.macros" composition={MACROS_COMPOSITION} />;
}
