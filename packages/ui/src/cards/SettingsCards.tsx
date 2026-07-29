/**
 * Settings card bodies — per-machine UI metadata, editable without fear.
 * Everything is an overlay on defaults: "Reset" (each card's header action,
 * declared in the compose registry) drops that section's overlay and cannot
 * fail; every save snapshots first for one-click revert.
 *
 * ConfigSaveBody is the former view-level save-bar as a card (design §"the
 * save-bar becomes a card"): dirty state, save-to-SD, reset-everything.
 * Extracted from views/Settings.tsx in the A6 conversion.
 */
import { For, Index, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { CONFIG_FILE, MAX_LABEL_LEN, DEFAULT_THERMAL_COLORS, type ThermalColors } from "../config/types.ts";
import { heaterSeries } from "../om/heaterSeries.ts";
import { nearestCollision, isHexColor, MIN_SEPARATION } from "../util/colorDistance.ts";
import { sensorRows } from "../om/sensorRows.ts";
import { captureScreenGeometry } from "../compose/screens.ts";
import { formatTimestamp } from "../files/format.ts";

export function AxisRolesBody() {
	const app = useApp();
	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	return (
		<>
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
		</>
	);
}

/**
 * Chart line colours, one per heater.
 *
 * The shipped palette guarantees no two lines are perceptually confusable
 * (om/heaterSeries.ts). A user pick is free to break that, so each row states
 * the collision instead: same ΔE arithmetic the palette test enforces
 * (util/colorDistance.ts), reported and not blocked. The operator is allowed
 * two similar colours; they are not allowed to be surprised by them.
 */
export function HeaterColorsBody() {
	const app = useApp();
	const series = createMemo(() =>
		heaterSeries({
			heaters: app.om.om.heat.heaters,
			bedHeaters: app.om.om.heat.bedHeaters,
			chamberHeaters: app.om.om.heat.chamberHeaters,
			tools: app.om.om.tools,
		}, app.config.config.heaterColors),
	);
	/** Every OTHER line, so a row never reports colliding with itself. */
	const others = (index: number): Array<readonly [string, string]> =>
		series().flatMap((s, i) => (i === index ? [] : [[s.label, s.stroke] as const]));

	return (
		<>
			<p class="hint">
				Line colours on the temperature chart. The shipped palette keeps every
				line distinguishable; your own picks are flagged when they get close,
				never blocked. Reset restores the palette.
			</p>
			{/* Index, NOT For. heaterSeries() returns fresh objects on every
			    config change, so For — which keys by reference — would rebuild
			    each row's DOM on every keystroke of the picker. That destroys
			    the live <input type="color"> and the OS colour dialog closes
			    the instant you pick anything. Index keys by position and
			    updates in place, so the input element survives. */}
			<Show when={series().length} fallback={<p class="job-empty">Waiting for heaters…</p>}>
				<Index each={series()}>
					{(s, i) => {
						const clash = createMemo(() => nearestCollision(s().stroke, others(i)));
						const overridden = (): boolean => app.config.config.heaterColors[String(i)] !== undefined;
						return (
							<div class="field">
								<span class="field-label">{s().label}</span>
								<input
									type="color"
									class="color-swatch"
									aria-label={`${s().label} chart colour`}
									value={s().stroke}
									onInput={e => app.config.setHeaterColor(i, e.currentTarget.value)}
								/>
								<span class="color-hex">{s().stroke}</span>
								<Show when={clash()}>
									{c => (
										<span class="color-clash" role="status">
											close to {c().label} (ΔE {c().separation.toFixed(1)})
										</span>
									)}
								</Show>
								<Show when={overridden()}>
									<button type="button" class="lab-pill" onClick={() => app.config.clearHeaterColor(i)}>
										Reset
									</button>
								</Show>
							</div>
						);
					}}
				</Index>
			</Show>
		</>
	);
}

/** The cold → warm → hot ramp the temperature READINGS are keyed to. */
export function ThermalColorsBody() {
	const app = useApp();
	const channels: Array<{ key: keyof ThermalColors; label: string; range: string }> = [
		{ key: "cold", label: "Cold", range: "below 45 °C" },
		{ key: "warm", label: "Warm", range: "45 – 160 °C" },
		{ key: "hot", label: "Hot", range: "160 °C and above" },
	];
	const current = (): ThermalColors => app.config.config.thermalColors;
	return (
		<>
			<p class="hint">
				How a temperature reading is coloured as it warms. Applies everywhere a
				reading is shown, not just the chart.
			</p>
			{/* Index for the same reason as the chart rows above: the picker
			    element must outlive its own input events. */}
			<Index each={channels}>
				{chAccessor => {
					const ch = chAccessor();
					const value = (): string => current()[ch.key];
					const clash = createMemo(() =>
						nearestCollision(value(), channels
							.filter(o => o.key !== ch.key)
							.map(o => [o.label, current()[o.key]] as const)));
					return (
						<div class="field">
							<span class="field-label">{ch.label}</span>
							<input
								type="color"
								class="color-swatch"
								aria-label={`${ch.label} reading colour`}
								value={isHexColor(value()) ? value() : DEFAULT_THERMAL_COLORS[ch.key]}
								onInput={e => app.config.setThermalColors({ [ch.key]: e.currentTarget.value })}
							/>
							<span class={`color-hex t-${ch.key}`}>{value()}</span>
							<span class="color-range">{ch.range}</span>
							<Show when={clash()}>
								{c => (
									<span class="color-clash" role="status">
										close to {c().label} (ΔE {c().separation.toFixed(1)})
									</span>
								)}
							</Show>
						</div>
					);
				}}
			</Index>
			<p class="hint">
				Readings below ΔE {MIN_SEPARATION} apart are hard to tell at a glance.
			</p>
		</>
	);
}

export function DockSensorsBody() {
	const app = useApp();
	return (
		<>
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
		</>
	);
}

export function BedProbeBody() {
	const app = useApp();
	return (
		<>
			<p class="hint">
				Sent to re-probe one height-map point on the Bed view. <code>{"{x}"}</code> and{" "}
				<code>{"{y}"}</code> become that point's bed coordinates. The motion belongs in your
				macro, not here — including whatever preconditions it should honour, the way mesh.g
				refuses to probe with a tool undocked.
			</p>
			<label class="field">
				<span class="field-label">Probe point command</span>
				<input
					type="text"
					value={app.config.config.bed.probePointCommand}
					onChange={e => app.config.setBed({ probePointCommand: e.currentTarget.value.trim() })}
				/>
			</label>
		</>
	);
}

export function CameraConfigBody() {
	const app = useApp();
	return (
		<>
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
		</>
	);
}

export function SensorNamesBody() {
	const app = useApp();
	const sensorList = createMemo(() => sensorRows(app.om.om.sensors, app.om.om.move.axes));
	return (
		<>
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
		</>
	);
}

export function SavedVersionsBody() {
	const app = useApp();
	return (
		<>
			<p class="hint">
				Every save keeps a version here — experiment freely and go back with
				one click. Settings live on the SD card ({CONFIG_FILE}), so they
				follow the machine to any browser.
			</p>
			<Show when={app.config.snapshots.length} fallback={<p class="job-empty">No saved versions yet.</p>}>
				<For each={app.config.snapshots}>
					{(snap, index) => (
						<div class="field">
							{/* Date AND time: a list of times alone cannot tell yesterday's
							    backup from this morning's. Same format as the file
							    browser's modified column. */}
							<span class="field-label stamp">{formatTimestamp(snap.takenAt)}</span>
							<span class="hint">{snap.label}</span>
							<button class="link-btn" onClick={() => app.config.revert(index())}>Restore</button>
						</div>
					)}
				</For>
			</Show>
		</>
	);
}

/** The former view-level save-bar, as a card: config dirty state, save to
 *  the machine's SD, reset everything. */
export function ConfigSaveBody() {
	const app = useApp();
	const [saveError, setSaveError] = createSignal<string | null>(null);
	// Armed = the name field is open and nothing has been saved yet. Clicking
	// "Save to machine" arms; the second click (or Enter) is what actually
	// writes. Same two-step shape as the file browser's rename and armed
	// delete, which is this app's convention for a single text field — there
	// is no modal for one input anywhere in the UI.
	const [armed, setArmed] = createSignal(false);
	const [label, setLabel] = createSignal("");

	const disarm = (): void => {
		setArmed(false);
		setLabel("");
	};

	const save = (): void => {
		setSaveError(null);
		// Fold every screen's current local geometry into the overlay first, so
		// the SD copy carries screens AND layouts (they seed any new browser).
		// Deliberately at SAVE time, not at arm time: geometry changed while the
		// name field was open still belongs in this save.
		captureScreenGeometry(app.config);
		// A blank name is not an error — snapshot() falls back to "saved", so
		// the prompt can never block a save.
		void app.config.saveToMachine(app.connector, label()).catch((err: unknown) => {
			setSaveError(err instanceof Error ? err.message : String(err));
		});
		disarm();
	};

	return (
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
			<Show
				when={armed()}
				fallback={
					<button class="primary-btn" disabled={!app.config.dirty} onClick={() => setArmed(true)}>
						Save to machine
					</button>
				}
			>
				<input
					class="fb-input save-label"
					placeholder="Name this backup"
					aria-label="Name this backup"
					maxLength={MAX_LABEL_LEN}
					value={label()}
					ref={el => queueMicrotask(() => el.focus())}
					onInput={e => setLabel(e.currentTarget.value)}
					onKeyDown={e => {
						if (e.key === "Enter") save();
						if (e.key === "Escape") disarm();
					}}
				/>
				<button class="primary-btn" onClick={save}>Save</button>
				<button class="link-btn save-cancel" onClick={disarm}>Cancel</button>
			</Show>
			<button
				class="link-btn"
				title="Return every setting and built-in screen to defaults. Your custom cards and screens are kept — delete those individually."
				onClick={() => app.config.resetAll()}
			>
				Reset everything
			</button>
		</div>
	);
}
