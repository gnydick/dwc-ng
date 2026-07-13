import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { createOmStore } from "./om/store.ts";
import { PollConnector } from "./connector/index.ts";
import type { Heater } from "./om/types.ts";
import "./app.css";

/**
 * Minimal Machine/status view (CLAUDE.md Task #4): proves the
 * poll → seqs → rr_model → reconcile loop end to end against mock-duet.
 * Visual language follows design/dashboard-comp.html (preflight strip,
 * DRO, tools & heaters, console) — trimmed to what the loop demonstrates.
 */
export default function App() {
	const store = createOmStore();
	const connector = new PollConnector({ baseUrl: "", events: store.events });
	const [code, setCode] = createSignal("");

	onMount(() => void connector.connect().catch(() => undefined));
	onCleanup(() => void connector.disconnect());

	const visibleAxes = createMemo(() => store.om.move.axes.filter(a => a.visible));
	const unhomedCount = createMemo(() => visibleAxes().filter(a => !a.homed).length);
	const anyHeaterHot = createMemo(() =>
		store.om.heat.heaters.some(h => h !== null && h.current >= 45));

	const heaterAt = (index: number): Heater | null => store.om.heat.heaters[index] ?? null;
	const bedHeaterIndex = createMemo(() => store.om.heat.bedHeaters.find(i => i >= 0) ?? -1);

	const jobProgress = createMemo(() => {
		const job = store.om.job;
		if (job.file === null || job.filePosition === null || job.file.size === 0) return null;
		return (job.filePosition / job.file.size) * 100;
	});

	const sendCode = (event: SubmitEvent): void => {
		event.preventDefault();
		const value = code().trim();
		if (value === "") return;
		setCode("");
		void connector.sendCode(value).catch(() => undefined);
	};

	return (
		<main class="page">
			<header class="preflight" aria-label="Machine preflight">
				<span class="wordmark">dwc<span>·</span>ng</span>

				<Switch>
					<Match when={store.connection.status === "connected"}>
						<span class="chip" classList={{
							"chip-ok": store.om.state.status === "idle",
							"chip-busy": store.om.state.status === "processing" || store.om.state.status === "busy",
							"chip-warn": store.om.state.status === "paused",
							"chip-fault": store.om.state.status === "halted",
						}}>
							<span class="dot" />{store.om.state.status}
						</span>
					</Match>
					<Match when={store.connection.status === "connecting" || store.connection.status === "reconnecting"}>
						<span class="chip chip-warn"><span class="dot" />{store.connection.status}…</span>
					</Match>
					<Match when={true}>
						<span class="chip chip-fault"><span class="dot" />disconnected</span>
					</Match>
				</Switch>

				<Show when={unhomedCount() > 0}>
					<span class="chip chip-warn">
						unhomed · {unhomedCount() === visibleAxes().length ? "all axes" : `${unhomedCount()} axes`}
					</span>
				</Show>
				<Show when={anyHeaterHot()}>
					<span class="chip chip-hot">hot</span>
				</Show>
				<Show when={store.om.state.currentTool < 0}>
					<span class="chip chip-quiet">no tool selected</span>
				</Show>

				<Show when={store.connection.status === "disconnected"}>
					<button class="reconnect" onClick={() => void connector.connect().catch(() => undefined)}>
						Connect
					</button>
				</Show>
			</header>

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
									<span class="dro-axis">{axis.letter}</span>
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
								<th scope="col">State</th>
							</tr>
						</thead>
						<tbody>
							<For each={store.om.tools}>
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
										<td><span class="heat-name">Bed <span class="des">heater{bedHeaterIndex()}</span></span></td>
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
				</section>

				<section class="card" aria-label="Job">
					<div class="card-head">
						<h2 class="card-title">Job</h2>
						<span class="des">job</span>
					</div>
					<Show
						when={store.om.job.file}
						fallback={
							<p class="job-empty">
								No job running.
								<Show when={store.om.job.lastFileName}> Last: {store.om.job.lastFileName}</Show>
							</p>
						}
					>
						{file => (
							<div class="job-line">
								<span class="fname">{file().fileName}</span>
								<Show when={store.om.job.layer !== null}>
									<span class="heat-set">layer {store.om.job.layer} / {file().numLayers}</span>
								</Show>
								<Show when={jobProgress() !== null}>
									<span class="pct">{jobProgress()!.toFixed(1)}%</span>
								</Show>
							</div>
						)}
					</Show>
				</section>

				<section class="card console" aria-label="Console">
					<div class="card-head">
						<h2 class="card-title">Console</h2>
						<span class="des">rr_reply</span>
					</div>
					<Show when={store.console.length} fallback={<p class="console-empty">No replies yet.</p>}>
						<div class="console-lines">
							<For each={store.console.slice(-4)}>
								{line => (
									<div class="console-line">
										<time>{new Date(line.receivedAt).toLocaleTimeString(undefined, { hour12: false })}</time>
										<span>{line.text}</span>
									</div>
								)}
							</For>
						</div>
					</Show>
					<form class="console-form" onSubmit={sendCode}>
						<input
							type="text"
							placeholder="Send G-code — e.g. M114"
							aria-label="G-code command"
							value={code()}
							onInput={e => setCode(e.currentTarget.value)}
						/>
						<button type="submit">Send</button>
					</form>
				</section>
			</div>

			<footer class="statusbar">
				<span classList={{ live: store.connection.status === "connected", down: store.connection.status !== "connected" }}>
					● {store.connection.status}
				</span>
				<Show when={store.om.boards[0]}>
					{board => <span>{board().name} · {board().firmwareVersion ?? ""}</span>}
				</Show>
				<span>up {formatUptime(store.om.state.upTime)}</span>
			</footer>
		</main>
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

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (d > 0) return `${d} d ${h} h`;
	if (h > 0) return `${h} h ${m} m`;
	return `${m} m ${s} s`;
}
