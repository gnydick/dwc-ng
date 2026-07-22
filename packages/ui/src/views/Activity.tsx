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
import { LayerChart } from "../charts/LayerChart.tsx";
import { layerChartData, layerStats } from "../charts/layerData.ts";
import { ACTIVITY_PANEL_DEFAULTS } from "./activity.panelDefaults.ts";

/** RRF statuses where a job is on the machine and controllable. */

/** Activity: live Position + Job progress + G-code toolpath in one place. */
export default function Activity() {
	const app = useApp();

	// ---- active job ----

	/** Jobs only carry objects when the slicer emitted M486 markers. */
	const hasObjects = createMemo(() => (app.om.om.job.build?.objects.length ?? 0) > 0);
	/** No layers recorded until a print has completed at least one. */
	const stats = createMemo(() => layerStats(app.om.om.job.layers));
	const hasLayers = createMemo(() => stats().count > 0);
	const chartData = createMemo(() => layerChartData(app.om.om.job.layers));

	const canvas = createPanelCanvas("dwc-ng.canvas.activity", ACTIVITY_PANEL_DEFAULTS, id => {
		if (id === "camera") return app.config.config.camera.pinned;
		// Reported as hidden, not merely un-rendered: otherwise its cells stay
		// reserved and block the panels around it from being resized into them.
		if (id === "build-objects") return hasObjects();
		if (id === "layers") return hasLayers();
		return true;
	});

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<PositionCard canvas={canvas} />
				<ActiveJobCard canvas={canvas} detailed />
				<GcodeViewer canvas={canvas} />
				<Show when={hasObjects()}>
					<Card id="build-objects" canvas={canvas} ariaLabel="Objects" title="Objects" tip="M486 · job.build">
						<BuildObjects />
					</Card>
				</Show>
				<Show when={hasLayers()}>
					<Card id="layers" canvas={canvas} ariaLabel="Layer times" title="Layer times" tip="job.layers">
						<div class="layer-summary">
							<span><b>{stats().count}</b> layers</span>
							<span>avg <b>{Math.round(stats().mean)}s</b></span>
							<span>min <b>{Math.round(stats().min)}s</b></span>
							<span>max <b>{Math.round(stats().max)}s</b></span>
						</div>
						<LayerChart data={chartData} />
					</Card>
				</Show>
				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
