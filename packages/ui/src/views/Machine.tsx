import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Heater } from "../om/types.ts";

/** The Machine view: live DRO, tools & heaters, current job. */
export default function Machine() {
	const app = useApp();

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));

	const heaterAt = (index: number): Heater | null => app.om.om.heat.heaters[index] ?? null;
	const bedHeaterIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);

	const dockConfigured = createMemo(() => Object.keys(app.config.config.dockSensors).length > 0);

	/** docked/away from the user-mapped gpIn sensor; null = unknowable. */
	const dockState = (toolNumber: number): "docked" | "away" | null => {
		const ref = app.config.config.dockSensors[String(toolNumber)];
		if (ref === undefined) return null;
		const gpIn = (app.om.om.sensors as { gpIn?: Array<{ value?: number } | null> } | undefined)?.gpIn?.[ref.gpIn];
		if (gpIn === null || gpIn === undefined || typeof gpIn.value !== "number") return null;
		const active = gpIn.value >= 0.5;
		return (ref.inverted ? !active : active) ? "docked" : "away";
	};

	const jobProgress = createMemo(() => {
		const job = app.om.om.job;
		if (job.file === null || job.filePosition === null || job.file.size === 0) return null;
		return (job.filePosition / job.file.size) * 100;
	});

	return (
		<div class="grid">
			<section class="card" aria-label="Position">
				<div class="card-head">
					<h2 class="card-title">Position</h2>
					<span class="des">move.axes</span>
				</div>
				<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
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
				</Show>
			</section>

			<section class="card" aria-label="Tools and heaters">
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
							<Show when={dockConfigured()}><th scope="col">Dock</th></Show>
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
													{t().name || `Tool ${t().number}`} <span class="des">T{t().number}</span>
												</span>
											</td>
											<Show when={heaterAt(t().heaters[0] ?? -1)} fallback={<td colspan="4" class="heat-set">no heater</td>}>
												{h => (
													<>
														<td><HeaterCurrent heater={h()} /></td>
														<td><span class="heat-set"><b>{h().active}</b>°</span></td>
														<td><span class="heat-set">{h().standby}°</span></td>
													</>
												)}
											</Show>
											<Show when={dockConfigured()}>
												<td>
													<Show when={dockState(t().number)} fallback={<span class="heat-set">—</span>}>
														{state => <span class={`dock ${state()}`}>{state()}</span>}
													</Show>
												</td>
											</Show>
											<Show when={heaterAt(t().heaters[0] ?? -1)}>
												{h => <td><span class={`heat-state ${h().state}`}>{h().state}</span></td>}
											</Show>
										</tr>
									)}
								</Show>
							)}
						</For>
						<Show when={heaterAt(bedHeaterIndex())}>
							{h => (
								<tr>
									<td><span class="heat-name">Bed <span class="des">heater{bedHeaterIndex()}</span></span></td>
									<td><HeaterCurrent heater={h()} /></td>
									<td><span class="heat-set"><b>{h().active}</b>°</span></td>
									{/* the bed has no standby mode — no standby cell, ever */}
									<td><span class="heat-set">—</span></td>
									<Show when={dockConfigured()}><td><span class="heat-set">—</span></td></Show>
									<td><span class={`heat-state ${h().state}`}>{h().state}</span></td>
								</tr>
							)}
						</Show>
					</tbody>
				</table>
			</section>

			<section class="card" aria-label="Job">
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
			</section>
		</div>
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
