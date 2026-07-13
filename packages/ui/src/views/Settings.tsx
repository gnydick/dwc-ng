import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { CONFIG_FILE } from "../config/types.ts";

/**
 * Settings: per-machine UI metadata, editable without fear.
 * Everything here is an overlay on defaults — "Reset" drops the overlay
 * (it cannot fail), and every save snapshots first for one-click revert.
 */
export default function Settings() {
	const app = useApp();

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));

	const save = (): void => {
		void app.config.saveToMachine(app.connector).catch(() => undefined);
	};

	return (
		<div class="grid settings">
			<section class="card" aria-label="Axis roles">
				<div class="card-head">
					<h2 class="card-title">Axis roles</h2>
					<button class="link-btn" onClick={() => app.config.resetSection("axisRoles")}>Reset</button>
				</div>
				<p class="hint">
					Label what each axis physically is on this machine — the firmware only
					knows letters. Labels appear in the position readout and jog controls.
				</p>
				<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
					<For each={visibleAxes()}>
						{axis => (
							<label class="field">
								<span class="field-label">{axis.letter}</span>
								<input
									type="text"
									placeholder="e.g. Z motor 1"
									value={app.config.config.axisRoles[axis.letter] ?? ""}
									onChange={e => {
										const value = e.currentTarget.value.trim();
										if (value === "") app.config.clearAxisRole(axis.letter);
										else app.config.setAxisRole(axis.letter, value);
									}}
								/>
							</label>
						)}
					</For>
				</Show>
			</section>

			<section class="card" aria-label="Tool dock sensors">
				<div class="card-head">
					<h2 class="card-title">Tool dock sensors</h2>
					<button class="link-btn" onClick={() => app.config.resetSection("dockSensors")}>Reset</button>
				</div>
				<p class="hint">
					If a tool has a presence switch in its dock, map it here (sensors.gpIn
					index). The sensor reports docked or away — it cannot know "mounted".
				</p>
				<For each={app.om.om.tools}>
					{tool => (
						<Show when={tool}>
							{t => (
								<div class="field">
									<span class="field-label">T{t().number}</span>
									<input
										type="number"
										min="0"
										placeholder="gpIn #"
										value={app.config.config.dockSensors[String(t().number)]?.gpIn ?? ""}
										onChange={e => {
											const parsed = parseInt(e.currentTarget.value, 10);
											if (Number.isNaN(parsed)) app.config.clearDockSensor(t().number);
											else app.config.setDockSensor(t().number, {
												gpIn: parsed,
												inverted: app.config.config.dockSensors[String(t().number)]?.inverted,
											});
										}}
									/>
									<label class="check">
										<input
											type="checkbox"
											disabled={app.config.config.dockSensors[String(t().number)] === undefined}
											checked={app.config.config.dockSensors[String(t().number)]?.inverted ?? false}
											onChange={e => {
												const ref = app.config.config.dockSensors[String(t().number)];
												if (ref !== undefined) {
													app.config.setDockSensor(t().number, { gpIn: ref.gpIn, inverted: e.currentTarget.checked });
												}
											}}
										/>
										inverted
									</label>
								</div>
							)}
						</Show>
					)}
				</For>
			</section>

			<section class="card" aria-label="Camera">
				<div class="card-head">
					<h2 class="card-title">Camera</h2>
					<button class="link-btn" onClick={() => app.config.resetSection("camera")}>Reset</button>
				</div>
				<p class="hint">The camera shows as a floating tile you can keep on every view.</p>
				<label class="field">
					<span class="field-label">Stream URL</span>
					<input
						type="text"
						placeholder="http://printercams:8080/stream"
						value={app.config.config.camera.streamUrl}
						onChange={e => app.config.setCamera({ streamUrl: e.currentTarget.value.trim() })}
					/>
				</label>
			</section>

			<section class="card" aria-label="Saved versions">
				<div class="card-head">
					<h2 class="card-title">Saved versions</h2>
				</div>
				<p class="hint">
					Every save keeps a version here — experiment freely and go back with
					one click. Settings live on the SD card ({CONFIG_FILE}), so they
					follow the machine to any browser.
				</p>
				<Show when={app.config.snapshots.length} fallback={<p class="job-empty">No saved versions yet.</p>}>
					<For each={app.config.snapshots}>
						{(snap, index) => (
							<div class="field">
								<span class="field-label">
									{new Date(snap.takenAt).toLocaleTimeString(undefined, { hour12: false })}
								</span>
								<span class="hint">{snap.label}</span>
								<button class="link-btn" onClick={() => app.config.revert(index())}>Restore</button>
							</div>
						)}
					</For>
				</Show>
			</section>

			<div class="save-bar">
				<Show when={app.config.dirty} fallback={<span class="hint">All changes saved.</span>}>
					<span class="hint unsaved">Unsaved changes</span>
				</Show>
				<button class="primary-btn" disabled={!app.config.dirty} onClick={save}>
					Save to machine
				</button>
				<button class="link-btn" onClick={() => app.config.resetAll()}>Reset everything</button>
			</div>
		</div>
	);
}
