import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Heater } from "../om/types.ts";
import { sensorRows } from "./machine.sensors.ts";
import { TemperatureChart, type ChartSeries } from "../charts/TemperatureChart.tsx";
import { Panel } from "../shell/Panel.tsx";
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
	const canvas = createPanelCanvas("dwc-ng.canvas.machine", MACHINE_PANEL_DEFAULTS);

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));

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

	const jobProgress = createMemo(() => {
		const job = app.om.om.job;
		if (job.file === null || job.filePosition === null || job.file.size === 0) return null;
		return (job.filePosition / job.file.size) * 100;
	});

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas>
				<Panel id="position" canvas={canvas} ariaLabel="Position" orientationToggle>
					<div class="card-head">
						<h2 class="card-title">Position</h2>
						<span class="des">move.axes</span>
					</div>
					<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
						<Show
							when={canvas.orientationFor("position") === "horizontal"}
							fallback={
								<For each={visibleAxes()}>
									{axis => (
										<div class="dro-row" classList={{ unhomed: !axis.homed }}>
											<span class="dro-axis">
												{axis.letter}
												<Show when={app.config.config.axisRoles[axis.letter]}>
													{role => <span class="dro-role">{role()}</span>}
												</Show>
											</span>
											<span class="dro-val">
												{(axis.machinePosition ?? 0).toFixed(2)}<small>mm</small>
											</span>
											<span class="homed-tag" classList={{ yes: axis.homed, no: !axis.homed }}>
												{axis.homed ? "homed" : "unhomed"}
											</span>
										</div>
									)}
								</For>
							}
						>
							<div class="dro-h-row">
								<For each={visibleAxes()}>
									{axis => (
										<div class="dro-h-cell" classList={{ unhomed: !axis.homed }}>
											<span class="dro-h-axis">
												{axis.letter}
												<Show when={app.config.config.axisRoles[axis.letter]}>
													{role => <span class="dro-role">{role()}</span>}
												</Show>
											</span>
											<span class="dro-h-val">
												{(axis.machinePosition ?? 0).toFixed(2)}<small>mm</small>
											</span>
										</div>
									)}
								</For>
							</div>
						</Show>
					</Show>
				</Panel>

				<Panel id="tools-heaters" canvas={canvas} ariaLabel="Tools and heaters">
					<div class="card-head">
						<h2 class="card-title">Tools &amp; heaters</h2>
						<span class="des">tools · heat.heaters</span>
					</div>
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
															<td><span class={`heat-state ${h().state}`}>{h().state}</span></td>
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
										<td><span class={`heat-state ${h().state}`}>{h().state}</span></td>
									</tr>
								)}
							</Show>
						</tbody>
					</table>
				</Panel>

				<Panel id="job" canvas={canvas} ariaLabel="Job">
					<div class="card-head">
						<h2 class="card-title">Job</h2>
						<span class="des">job</span>
					</div>
					<Show
						when={app.om.om.job.file}
						fallback={
							<p class="job-empty">
								No job running.
								<Show when={app.om.om.job.lastFileName}> Last: {app.om.om.job.lastFileName}</Show>
							</p>
						}
					>
						{file => (
							<div class="job-line">
								<span class="fname">{file().fileName}</span>
								<Show when={app.om.om.job.layer !== null}>
									<span class="heat-set">layer {app.om.om.job.layer} / {file().numLayers}</span>
								</Show>
								<Show when={jobProgress() !== null}>
									<span class="pct">{jobProgress()!.toFixed(1)}%</span>
								</Show>
							</div>
						)}
					</Show>
				</Panel>

				<Panel id="sensors" canvas={canvas} ariaLabel="Sensors">
					<div class="card-head">
						<h2 class="card-title">Sensors</h2>
						<span class="des">sensors.endstops · filamentMonitors · probes</span>
					</div>
					<Show when={sensorList().length} fallback={<p class="job-empty">No sensors configured.</p>}>
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
					</Show>
				</Panel>

				<Panel id="temperatures" canvas={canvas} ariaLabel="Temperatures">
					<div class="card-head">
						<h2 class="card-title">Temperatures</h2>
						<span class="des">heat.heaters · live</span>
					</div>
					<Show when={chartSeries().length} fallback={<p class="job-empty">Waiting for heaters…</p>}>
						<TemperatureChart data={app.temps.data} series={chartSeries()} height={220} />
					</Show>
				</Panel>

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
