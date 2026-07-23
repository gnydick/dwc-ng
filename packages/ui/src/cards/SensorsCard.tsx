import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { sensorRows } from "../views/machine.sensors.ts";
import { Card } from "../shell/Card.tsx";
import type { Orientation } from "../shell/panelOrientation.ts";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

/**
 * Endstops, filament monitors, and probes as a status list (or a horizontal
 * table via the toggle). ok = green dot, not-ok = gold. Rows and their labels
 * come from sensorRows, which folds the user's sensor names in.
 *
 * Content-only body; chrome comes from the compose registry
 * (compose/defs.ts "sensors") or the legacy wrapper below.
 */
export function SensorsBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	const sensorList = createMemo(() => sensorRows(app.om.om.sensors, app.om.om.move.axes, app.config.config.sensorNames));

	return (
		<Show when={sensorList().length} fallback={<p class="job-empty">No sensors configured.</p>}>
			<Show
				when={props.orientation() === "horizontal"}
				fallback={
					<div class="sensor-list">
						<For each={sensorList()}>
							{row => (
								<div class="sensor-row">
									<span class={`sensor-dot ${row.ok ? "ok" : "warn"}`} />
									<span class="sensor-label">{row.label}</span>
									<span class="sensor-state">{row.state}</span>
								</div>
							)}
						</For>
					</div>
				}
			>
				<table class="sensor-h-table">
					<thead>
						<tr>
							<For each={sensorList()}>
								{row => (
									<th scope="col">
										<span class={`sensor-dot ${row.ok ? "ok" : "warn"}`} />
										{row.label}
									</th>
								)}
							</For>
						</tr>
					</thead>
					<tbody>
						<tr>
							<For each={sensorList()}>
								{row => <td classList={{ ok: row.ok, warn: !row.ok }}>{row.state}</td>}
							</For>
						</tr>
					</tbody>
				</table>
			</Show>
		</Show>
	);
}

/** Legacy self-carding wrapper — dies with its last un-converted consumer (Card Lab). */
export function SensorsCard(props: { canvas: PanelCanvasController }) {
	return (
		<Card id="sensors" canvas={props.canvas} ariaLabel="Sensors" title="Sensors" tip="sensors.endstops · filamentMonitors · probes" orientationToggle>
			<SensorsBody orientation={() => props.canvas.orientationFor("sensors")} />
		</Card>
	);
}
