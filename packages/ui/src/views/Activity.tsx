import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { ACTIVITY_PANEL_DEFAULTS } from "./activity.panelDefaults.ts";

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS);

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
