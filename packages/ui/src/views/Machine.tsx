import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Heater } from "../om/types.ts";
import { sensorRows } from "./machine.sensors.ts";
import { TemperatureChart, type ChartSeries } from "../charts/TemperatureChart.tsx";
import { Card } from "../shell/Card.tsx";
import { PositionCard } from "../cards/PositionCard.tsx";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
import { HeaterState } from "../cards/HeaterState.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { MACHINE_PANEL_DEFAULTS } from "./machine.panelDefaults.ts";

/** Distinct line colors for tool heaters; the bed gets gold (see below). */
const TOOL_COLORS = ["#f0a050", "#6fbf8f", "#5aa9e6", "#c88ce0", "#e0b84a", "#8fd0c0"];

/** The Machine view: live DRO, tools & heaters, current job. */
export default function Machine() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.machine", MACHINE_PANEL_DEFAULTS,
		// The camera panel is Show-gated on camera.pinned; when hidden it must
		// not block a visible panel from being moved or resized into its cells.
		id => (id === "camera" ? app.config.config.camera.pinned : true));

	const heaterAt = (index: number): Heater | null => app.om.om.heat.heaters[index] ?? null;
	const bedHeaterIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);

	/** docked/away from the user-mapped gpIn sensor; null = unknowable. */
	const dockState = (toolNumber: number): "docked" | "away" | null => {
		const ref = app.config.config.dockSensors[String(toolNumber)];
		if (ref === undefined) return null;
		const gpIn = app.om.om.sensors.gpIn[ref.gpIn];
		if (gpIn === null || gpIn === undefined) return null;
		const active = gpIn.value >= 0.5;
		return (ref.inverted ? !active : active) ? "docked" : "away";
	};

	const sensorList = createMemo(() => sensorRows(app.om.om.sensors, app.om.om.move.axes, app.config.config.sensorNames));

	// One chart series per heater (index == heat.heaters index == chart series
	// index), labeled and colored by tool/bed semantics.
	const chartSeries = createMemo<ChartSeries[]>(() => {
		const heaters = app.om.om.heat.heaters;
		const bedSet = new Set(app.om.om.heat.bedHeaters);
		const toolByHeater = new Map<number, string>();
		for (const t of app.om.om.tools) {
			if (t) for (const h of t.heaters) toolByHeater.set(h, t.name || `Tool ${t.number}`);
		}
		return heaters.map((_, i) => ({
			label: bedSet.has(i) ? "Bed" : toolByHeater.get(i) ?? `Heater ${i}`,
			stroke: bedSet.has(i) ? "#c9a227" : TOOL_COLORS[i % TOOL_COLORS.length]!,
		}));
	});

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<PositionCard canvas={canvas} />

				<Card id="tools-heaters" canvas={canvas} ariaLabel="Tools and heaters" title="Tools & heaters" tip="tools · heat.heaters" orientationToggle>
					<Show
						when={canvas.orientationFor("tools-heaters") === "horizontal"}
						fallback={
							<table class="heat-table">
								<thead>
									<tr>
										<th scope="col">Heater</th>
										<th scope="col">Current</th>
										<th scope="col">Active</th>
										<th scope="col">Standby</th>
										<th scope="col">State</th>
									</tr>
								</thead>
								<tbody>
									<For each={app.om.om.tools}>
										{tool => (
											<Show when={tool}>
												{t => (
													<tr>
														<td>
															<span class="heat-name">
																<span class="heat-tool">{t().name || `Tool ${t().number}`}</span>
																<span class="des">T{t().number}</span>
																{/* Dock presence: a single dot by the tool, no column
																    to scroll off. Green = docked, gold = away. */}
																<Show when={dockState(t().number)}>
																	{state => (
																		<span
																			class={`dock-dot ${state()}`}
																			title={state() === "docked" ? "Docked" : "Away"}
																			aria-label={state() === "docked" ? "Docked" : "Away"}
																		/>
																	)}
																</Show>
															</span>
														</td>
														<Show when={heaterAt(t().heaters[0] ?? -1)} fallback={<td colspan="4" class="heat-set">no heater</td>}>
															{h => (
																<>
																	<td><HeaterCurrent heater={h()} /></td>
																	<td><span class="heat-set"><b>{h().active}</b>°</span></td>
																	<td><span class="heat-set">{h().standby}°</span></td>
																	<td><HeaterState heater={h()} index={t().heaters[0] ?? -1} /></td>
																</>
															)}
														</Show>
													</tr>
												)}
											</Show>
										)}
									</For>
									<Show when={heaterAt(bedHeaterIndex())}>
										{h => (
											<tr>
												<td>
													<span class="heat-name">
														<span class="heat-tool">Bed</span>
														<span class="des">heater{bedHeaterIndex()}</span>
													</span>
												</td>
												<td><HeaterCurrent heater={h()} /></td>
												<td><span class="heat-set"><b>{h().active}</b>°</span></td>
												{/* the bed has no standby mode — no standby cell, ever */}
												<td><span class="heat-set">—</span></td>
												<td><HeaterState heater={h()} index={bedHeaterIndex()} /></td>
											</tr>
										)}
									</Show>
								</tbody>
							</table>
						}
					>
						<div class="heat-h-row">
							<For each={app.om.om.tools}>
								{tool => (
									<Show when={tool}>
										{t => (
											<div class="heat-h-cell">
												<span class="heat-name">
													<span class="heat-tool">{t().name || `Tool ${t().number}`}</span>
													<span class="des">T{t().number}</span>
													<Show when={dockState(t().number)}>
														{state => (
															<span
																class={`dock-dot ${state()}`}
																title={state() === "docked" ? "Docked" : "Away"}
																aria-label={state() === "docked" ? "Docked" : "Away"}
															/>
														)}
													</Show>
												</span>
												<Show when={heaterAt(t().heaters[0] ?? -1)} fallback={<span class="heat-set">no heater</span>}>
													{h => (
														<>
															<HeaterCurrent heater={h()} />
															<span class="heat-h-meta">
																<b>{h().active}</b>°&nbsp;/&nbsp;{h().standby}°
																<HeaterState heater={h()} index={t().heaters[0] ?? -1} />
															</span>
														</>
													)}
												</Show>
											</div>
										)}
									</Show>
								)}
							</For>
							<Show when={heaterAt(bedHeaterIndex())}>
								{h => (
									<div class="heat-h-cell">
										<span class="heat-name">
											<span class="heat-tool">Bed</span>
											<span class="des">heater{bedHeaterIndex()}</span>
										</span>
										<HeaterCurrent heater={h()} />
										<span class="heat-h-meta">
											<b>{h().active}</b>°&nbsp;/&nbsp;—
											<HeaterState heater={h()} index={bedHeaterIndex()} />
										</span>
									</div>
								)}
							</Show>
						</div>
					</Show>
				</Card>

				<ActiveJobCard canvas={canvas} />

				<Card id="sensors" canvas={canvas} ariaLabel="Sensors" title="Sensors" tip="sensors.endstops · filamentMonitors · probes" orientationToggle>
					<Show when={sensorList().length} fallback={<p class="job-empty">No sensors configured.</p>}>
						<Show
							when={canvas.orientationFor("sensors") === "horizontal"}
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
				</Card>

				<Card id="temperatures" canvas={canvas} ariaLabel="Temperatures" title="Temperatures" tip="heat.heaters · live">
					<Show when={chartSeries().length} fallback={<p class="job-empty">Waiting for heaters…</p>}>
						<TemperatureChart data={app.temps.data} series={chartSeries()} height={220} />
					</Show>
				</Card>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}

function HeaterCurrent(props: { heater: Heater }) {
	return (
		<span
			class="heat-cur"
			classList={{
				"t-cold": props.heater.current < 45,
				"t-warm": props.heater.current >= 45 && props.heater.current < 160,
				"t-hot": props.heater.current >= 160,
			}}
		>
			{props.heater.current.toFixed(1)}<small>°C</small>
		</span>
	);
}
