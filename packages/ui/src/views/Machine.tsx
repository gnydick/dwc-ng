import { useApp } from "../shell/context.ts";
import { PositionCard } from "../cards/PositionCard.tsx";
import { ToolsHeatersCard } from "../cards/ToolsHeatersCard.tsx";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
import { SensorsCard } from "../cards/SensorsCard.tsx";
import { TemperaturesCard } from "../cards/TemperaturesCard.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { MACHINE_PANEL_DEFAULTS } from "./machine.panelDefaults.ts";

/** The Machine view: live DRO, tools & heaters, current job. Every card is a
 *  self-contained component (cards/), so this view is just their arrangement. */
export default function Machine() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.machine", MACHINE_PANEL_DEFAULTS,
		// The camera panel is Show-gated on camera.pinned; when hidden it must
		// not block a visible panel from being moved or resized into its cells.
		id => (id === "camera" ? app.config.config.camera.pinned : true));

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<PositionCard canvas={canvas} />
				<ToolsHeatersCard canvas={canvas} />
				<ActiveJobCard canvas={canvas} />
				<SensorsCard canvas={canvas} />
				<TemperaturesCard canvas={canvas} />
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
