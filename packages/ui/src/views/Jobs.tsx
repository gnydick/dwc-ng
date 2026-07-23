import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { JOBS_COMPOSITION } from "../compose/screens.ts";

/**
 * Jobs — this domain owns the gcodes listing (no central Files section). A
 * click OPENS a file (metadata + thumbnail), it never runs it; starting a
 * print is an explicit action on the details card. A composed screen (A5);
 * the browser/selection/fileinfo state lives in the jobsBrowser service.
 */
export default function Jobs() {
	return <ComposedScreen storageKey="dwc-ng.canvas.jobs" composition={JOBS_COMPOSITION} class="jobs" />;
}
