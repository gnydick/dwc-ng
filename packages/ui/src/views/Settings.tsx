import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { SETTINGS_COMPOSITION } from "../compose/screens.ts";

/**
 * Settings: per-machine UI metadata, editable without fear — everything is
 * an overlay on defaults; per-card Reset drops that section's overlay and
 * cannot fail; every save snapshots first. A composed screen (A6); the old
 * out-of-canvas save-bar is the config-save card.
 */
export default function Settings() {
	return <ComposedScreen storageKey="dwc-ng.canvas.settings" composition={SETTINGS_COMPOSITION} class="settings" />;
}
