import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { BED_COMPOSITION } from "../compose/screens.ts";

/**
 * Bed — the height map, and re-probing single points of it. A composed
 * screen (A5); the store, the selected cell, the shared message line, and
 * the connection-gated load lifecycle all live in the heightmap service.
 */
export default function Bed() {
	return <ComposedScreen storageKey="dwc-ng.canvas.bed" composition={BED_COMPOSITION} class="bed" />;
}
