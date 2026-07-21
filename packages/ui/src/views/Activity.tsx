import { Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { PositionCard } from "../cards/PositionCard.tsx";
import { Card } from "../shell/Card.tsx";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
import { BuildObjects } from "../cards/BuildObjects.tsx";
import { GcodeViewer } from "../gcode/GcodeViewer.tsx";
import { ACTIVITY_PANEL_DEFAULTS } from "./activity.panelDefaults.ts";

/** RRF statuses where a job is on the machine and controllable. */

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const app = useApp();

	// ---- active job ----

	/** Jobs only carry objects when the slicer emitted M486 markers. */
	const hasObjects = createMemo(() => (app.om.om.job.build?.objects.length ?? 0) > 0);

	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS, id => {
		if (id === "camera") return app.config.config.camera.pinned;
		// Reported as hidden, not merely un-rendered: otherwise its cells stay
		// reserved and block the panels around it from being resized into them.
		if (id === "build-objects") return hasObjects();
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
				<Show when={hasObjects()}>
					<Card id="build-objects" canvas={canvas} ariaLabel="Objects" title="Objects" tip="M486 · job.build">
						<BuildObjects />
					</Card>
				</Show>
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
