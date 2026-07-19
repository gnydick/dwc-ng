import { createMemo } from "solid-js";
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
const ACTIVE_STATUSES = new Set(["processing", "paused", "pausing", "resuming", "cancelling", "simulating"]);

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const app = useApp();

	// ---- active job ----
	const job = () => app.om.om.job;
	// An idle machine can still carry a job.file object whose fields are null;
	// only treat it as a real job when it names a file.
	const jobFile = createMemo(() => {
		const f = job().file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f : null;
	});
	const isActive = createMemo(() => ACTIVE_STATUSES.has(app.om.om.state.status) || jobFile() !== null);

	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS, id => {
		if (id === "active-job") return isActive();
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
