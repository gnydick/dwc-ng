import { useApp } from "../shell/context.ts";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { PositionCard } from "../cards/PositionCard.tsx";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
import { GcodeViewer } from "../gcode/GcodeViewer.tsx";
import { ACTIVITY_PANEL_DEFAULTS } from "./activity.panelDefaults.ts";

/** RRF statuses where a job is on the machine and controllable. */

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const app = useApp();

	// ---- active job ----

	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS, id => {
		if (id === "camera") return app.config.config.camera.pinned;
		return true;
	});

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<PositionCard canvas={canvas} />
				<ActiveJobCard canvas={canvas} />
				<GcodeViewer canvas={canvas} />
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
