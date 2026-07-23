import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { MACHINE_COMPOSITION } from "../compose/screens.ts";

/**
 * The Machine view — the first composed screen (design phase A3): pure data
 * rendered by ComposedScreen. The storage key is unchanged, so layouts saved
 * before the conversion keep working.
 */
export default function Machine() {
	return <ComposedScreen storageKey="dwc-ng.canvas.machine" composition={MACHINE_COMPOSITION} />;
}
