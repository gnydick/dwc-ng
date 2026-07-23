import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { ACTIVITY_COMPOSITION } from "../compose/screens.ts";

/**
 * Activity: live Position + Job progress + G-code toolpath in one place —
 * a composed screen (design phase A4). Note: the detailed job card's slot id
 * changed from "active-job" to "active-job-detailed" in the conversion, so a
 * customized activity layout re-seats that one card at its default.
 */
export default function Activity() {
	return <ComposedScreen storageKey="dwc-ng.canvas.activity" composition={ACTIVITY_COMPOSITION} />;
}
