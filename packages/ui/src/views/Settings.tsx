import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { CONFIG_FILE } from "../config/types.ts";
import { sensorRows } from "./machine.sensors.ts";
import { Panel } from "../shell/Panel.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { SETTINGS_PANEL_DEFAULTS } from "./settings.panelDefaults.ts";

/**
 * Settings: per-machine UI metadata, editable without fear.
 * Everything here is an overlay on defaults — "Reset" drops the overlay
 * (it cannot fail), and every save snapshots first for one-click revert.
 */
export default function Settings() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.settings", SETTINGS_PANEL_DEFAULTS);

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const sensorList = createMemo(() => sensorRows(app.om.om.sensors, app.om.om.move.axes));

	const [saveError, setSaveError] = createSignal<string | null>(null);

	const save = (): void => {
		setSaveError(null);
		void app.config.saveToMachine(app.connector).catch((err: unknown) => {
			setSaveError(err instanceof Error ? err.message : String(err));
		});
	};

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="settings">
				<Panel id="axis-roles" canvas={canvas} ariaLabel="Axis roles">
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
				</Panel>

				<Panel id="tool-dock-sensors" canvas={canvas} ariaLabel="Tool dock sensors">
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
				</Panel>

				<Panel id="camera-config" canvas={canvas} ariaLabel="Camera">
					<div class="card-head">
						<h2 class="card-title">Camera</h2>
						<button class="link-btn" onClick={() => app.config.resetSection("camera")}>Reset</button>
					</div>
					<p class="hint">Pin the camera (top-right, on any view) to show it as a panel on that view — position and size are set independently per view.</p>
					<label class="field">
						<span class="field-label">Stream URL</span>
						<input
							type="text"
							placeholder="http://printercams:8080/stream"
							value={app.config.config.camera.streamUrl}
							onChange={e => app.config.setCamera({ streamUrl: e.currentTarget.value.trim() })}
						/>
					</label>
				</Panel>

				<Panel id="sensor-names" canvas={canvas} ariaLabel="Sensor names">
					<div class="card-head">
						<h2 class="card-title">Sensor names</h2>
						<button class="link-btn" onClick={() => app.config.resetSection("sensorNames")}>Reset</button>
					</div>
					<p class="hint">
						Name the endstops, filament monitors, and probes that show up on the
						Machine view's Sensors card — RRF only knows them by index.
					</p>
					<Show when={sensorList().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
						<For each={sensorList()}>
							{row => (
								<label class="field">
									<span class="field-label">{row.label}</span>
									<input
										type="text"
										placeholder="Custom name"
										value={app.config.config.sensorNames[row.key] ?? ""}
										onChange={e => {
											const value = e.currentTarget.value.trim();
											if (value === "") app.config.clearSensorName(row.key);
											else app.config.setSensorName(row.key, value);
										}}
									/>
								</label>
							)}
						</For>
					</Show>
				</Panel>

				<Panel id="saved-versions" canvas={canvas} ariaLabel="Saved versions">
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
				</Panel>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>

			<div class="save-bar">
				<Show
					when={saveError()}
					fallback={
						<Show when={app.config.dirty} fallback={<span class="hint">All changes saved.</span>}>
							<span class="hint unsaved">Unsaved changes</span>
						</Show>
					}
				>
					{msg => <span class="hint unsaved">Save failed: {msg()}</span>}
				</Show>
				<button class="primary-btn" disabled={!app.config.dirty} onClick={save}>
					Save to machine
				</button>
				<button class="link-btn" onClick={() => app.config.resetAll()}>Reset everything</button>
			</div>
		</>
	);
}
