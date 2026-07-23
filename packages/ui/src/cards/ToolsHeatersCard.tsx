import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Heater } from "../om/types.ts";
import { Card } from "../shell/Card.tsx";
import { HeaterState } from "./HeaterState.tsx";
import type { Orientation } from "../shell/panelOrientation.ts";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

/**
 * Tools & heaters: one row per tool (current / active / standby / state) plus
 * the bed, which has no standby mode and so never shows a standby cell. A
 * dock-presence dot sits by each tool name (green docked, gold away) from the
 * user-mapped gpIn sensor. Vertical table or horizontal strip via the toggle.
 *
 * Content-only body; chrome comes from the compose registry
 * (compose/defs.ts "tools-heaters") or the legacy wrapper below.
 */
export function ToolsHeatersBody(props: { orientation: () => Orientation }) {
	const app = useApp();

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

	return (
		<>
			<Show
				when={props.orientation() === "horizontal"}
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
		</>
	);
}

/** Legacy self-carding wrapper — dies with its last un-converted consumer (Card Lab). */
export function ToolsHeatersCard(props: { canvas: PanelCanvasController }) {
	return (
		<Card id="tools-heaters" canvas={props.canvas} ariaLabel="Tools and heaters" title="Tools & heaters" tip="tools · heat.heaters" orientationToggle>
			<ToolsHeatersBody orientation={() => props.canvas.orientationFor("tools-heaters")} />
		</Card>
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
