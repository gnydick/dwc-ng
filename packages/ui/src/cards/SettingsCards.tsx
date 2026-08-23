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
import { createArmed } from "../control/armed.ts";
import { useApp } from "../shell/context.ts";
import { MAX_LABEL_LEN, DEFAULT_THERMAL_COLORS, type Envelope, type ThermalColors } from "../config/types.ts";
import { commitMotionField, MOTION_FIELDS, type MotionField } from "../shaping/motionFields.ts";
import { parseAccelAddr } from "../control/commands.ts";
import { accelerometerOf } from "../shaping/preconditions.ts";
import {
	accelStatusText, draftEnvelope, draftOf, envelopeStatusText, judgeAccel, judgeDraft, sameDraft,
	type EnvelopeAxis, type EnvelopeDraft, type EnvelopeVerdict,
} from "../shaping/settingsDraft.ts";
import { heaterSeries } from "../om/heaterSeries.ts";
import { groundOf, theme } from "../shell/theme.ts";
import { nearestCollision, isHexColor } from "../util/colorDistance.ts";
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
			<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting…</p>}>
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
		}, app.config.config.heaterColors, groundOf(theme())),
	);
	/** Every OTHER line, so a row never reports colliding with itself. */
	const others = (index: number): Array<readonly [string, string]> =>
		series().flatMap((s, i) => (i === index ? [] : [[s.label, s.stroke] as const]));

	return (
		<>
			{/* No standing hint. The rows say it themselves: a swatch beside its
			    hex, a Reset that appears only on an override, and the ΔE warning
			    when two picks get close. A paragraph restating that was prose the
			    card had to be wide enough to hold. */}
			{/* Index, NOT For. heaterSeries() returns fresh objects on every
			    config change, so For — which keys by reference — would rebuild
			    each row's DOM on every keystroke of the picker. That destroys
			    the live <input type="color"> and the OS colour dialog closes
			    the instant you pick anything. Index keys by position and
			    updates in place, so the input element survives. */}
			<Show when={series().length} fallback={<p class="job-empty">Waiting…</p>}>
				<Index each={series()}>
					{(s, i) => {
						const clash = createMemo(() => nearestCollision(s().stroke, others(i)));
						const clashText = (): string => {
							const c = clash();
							return c === null ? "" : `close to ${c.label} (ΔE ${c.separation.toFixed(1)})`;
						};
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
								<Show when={overridden()}>
									<button type="button" class="lab-pill" onClick={() => app.config.clearHeaterColor(i)}>
										Reset
									</button>
								</Show>
								{/* ALWAYS rendered, empty when there is nothing to say. A box
								    that came and went would change the row's width, and with it
								    the card's own minimum, every time a pick landed near
								    another. */}
								<span class="color-clash" role="status" title={clashText()}>
									{clashText()}
								</span>
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
					const clashText = (): string => {
						const c = clash();
						return c === null ? "" : `close to ${c.label} (ΔE ${c.separation.toFixed(1)})`;
					};
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
							<span class="color-clash" role="status" title={clashText()}>
								{clashText()}
							</span>
						</div>
					);
				}}
			</Index>
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
			<Show when={sensorList().length} fallback={<p class="job-empty">Waiting…</p>}>
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

/** The two envelope rows, so the fields are addressed by NAME rather than by
 *  an axis letter re-tested in four attributes. */
const AXIS_ROWS = [
	{ axis: "X", lo: "xLo", hi: "xHi" },
	{ axis: "Y", lo: "yLo", hi: "yHi" },
] as const satisfies ReadonlyArray<{
	axis: EnvelopeAxis; lo: keyof EnvelopeDraft; hi: keyof EnvelopeDraft;
}>;

/**
 * The Shaping Lab's settings: the motion envelope, the capture defaults, and
 * which accelerometer belongs to which tool.
 *
 * This card is the ONLY way an envelope comes to exist (spec I8). Nothing
 * ships one, nothing derives one from axis limits or the object model, and the
 * lab refuses every procedure until a person has drawn the box — which is why
 * the lab's refusal copy names this card by location ("Settings › Input shaping").
 *
 * THE PROBLEM THIS CARD IS MOSTLY ABOUT. The envelope gate is whole-or-nothing:
 * one reversed, blank or non-numeric bound drops the WHOLE box to `null`, not
 * just its own axis. An editor that wrote and moved on would appear to accept
 * a box it did not store. So every commit here writes through the store's one
 * gate, reads the config BACK, and states what actually happened — which axis
 * was refused, and that the envelope is now unset — in a slot that is always
 * on screen, so saying it moves nothing.
 *
 * Nothing on this card validates anything. `setShaping` and `setAccelAddr` are
 * the gates (config/parse.ts via config/store.ts) and the card's whole job is
 * to make their verdicts legible; shaping/settingsDraft.ts carries the words
 * and the per-axis probe, and both go through `asEnvelope` itself.
 */
export function ShapingBody() {
	const app = useApp();
	const stored = (): Envelope | null => app.config.config.shaping.envelope;

	// `edit` is null while the four fields MIRROR the store, and holds the
	// operator's own text otherwise. `committed` is the draft as it was at the
	// last write, so the card can tell "typed but not applied" from "applied
	// and refused" — two states that look identical in the input.
	const [edit, setEdit] = createSignal<EnvelopeDraft | null>(null);
	const [committed, setCommitted] = createSignal<EnvelopeDraft | null>(null);
	const fields = createMemo<EnvelopeDraft>(() => edit() ?? draftOf(stored()));

	const verdict = createMemo<EnvelopeVerdict>(() => {
		const box = stored();
		const typed = edit();
		// Mirroring the store: whatever the store says IS the answer, so a
		// Reset in the card header lands as "unset" without this card being
		// told about it.
		if (typed === null) return box === null ? { kind: "unset" } : { kind: "set", envelope: box };
		const last = committed();
		if (last === null || !sameDraft(last, typed)) return { kind: "pending" };
		return judgeDraft(last, box);
	});

	const refused = (axis: EnvelopeAxis): boolean => {
		const v = verdict();
		return v.kind === "rejected" && v.axes.includes(axis);
	};

	const setBound = (key: keyof EnvelopeDraft, value: string): void => {
		setEdit({ ...fields(), [key]: value });
	};

	const commitEnvelope = (): void => {
		const draft = fields();
		setCommitted(draft);
		// The ONE write. draftEnvelope returns what `asEnvelope` minted, and
		// setShaping runs the same gate again on the way into the overlay.
		app.config.setShaping({ envelope: draftEnvelope(draft) });
		// Read BACK. An accepted box replaces the operator's text with the
		// numbers the gate kept, and hands the fields back to the store; a
		// refused one leaves the text where it is, beside the reason.
		if (stored() !== null) {
			setEdit(null);
			setCommitted(null);
		}
	};

	// A refused motion default is invisible on its own — parseShapingDefaults
	// drops the field and the effective value simply does not change — so the
	// commit puts the kept value back in the input and says which field.
	//
	// The note describes the last motion COMMIT and is replaced by the next
	// one; unlike the envelope's line it does not mirror the store, because
	// there is nothing in the store to mirror — a refused default leaves the
	// section byte-identical. So it also outlives a section Reset, which is
	// the honest reading: Reset did not make that commit succeed.
	const [motionNote, setMotionNote] = createSignal("");
	const commitMotion = (field: MotionField, input: HTMLInputElement): void => {
		// One writer, shared with the Capture card's editor of the same four
		// numbers (shaping/motionFields.ts): it commits through the config gate
		// and reads back, which is the only way a refused default is visible at
		// all — the gate drops the field and the effective value simply does not
		// change.
		const result = commitMotionField(
			field,
			Number(input.value),
			patch => { app.config.setShaping({ defaults: patch }); },
			() => app.config.config.shaping.defaults,
		);
		input.value = String(result.kept);
		setMotionNote(result.note);
	};

	// Same two-signal shape as the envelope, per tool.
	const [accelEdit, setAccelEdit] = createSignal<Record<number, string>>({});
	const [accelCommitted, setAccelCommitted] = createSignal<Record<number, string>>({});
	const storedAddr = (tool: number): string | undefined => app.config.config.shaping.accelByTool[tool];
	const accelField = (tool: number): string => accelEdit()[tool] ?? storedAddr(tool) ?? "";
	/** Does the machine report an accelerometer at this tool's address? The
	 *  SAME lookup the preconditions read makes, so a row here and a disabled
	 *  Capture button cannot disagree about whether the sensor is there. */
	const accelPresent = (tool: number): boolean => {
		const raw = storedAddr(tool);
		if (raw === undefined) return false;
		const addr = parseAccelAddr(raw);
		return addr !== null && accelerometerOf(app.om.om, addr) !== null;
	};
	const accelStatus = (tool: number): string =>
		accelStatusText(judgeAccel(
			accelField(tool), accelCommitted()[tool] ?? null, storedAddr(tool), accelPresent(tool),
		));
	const forget = (map: Record<number, string>, tool: number): Record<number, string> => {
		const next = { ...map };
		delete next[tool];
		return next;
	};
	const commitAccel = (tool: number): void => {
		const text = accelField(tool).trim();
		setAccelCommitted(prev => ({ ...prev, [tool]: text }));
		if (text === "") app.config.clearAccelAddr(tool);
		else app.config.setAccelAddr(tool, text);
		// Read back, exactly as the envelope does: if the config now says what
		// was typed, the row goes back to mirroring it.
		if ((storedAddr(tool) ?? "") === text) {
			setAccelEdit(prev => forget(prev, tool));
			setAccelCommitted(prev => forget(prev, tool));
		}
	};

	return (
		<>
			{/* No standing paragraph. Prose rewraps as the card is resized, and a
			    hint here was the one child the layout audit reported drifting —
			    the same reflow source Saved versions deleted for the same reason.
			    Everything it said is said by the status line below the fields,
			    which has to exist anyway: "Not set — shaping cannot move until
			    you draw this box." */}
			<span class="set-cap">Envelope</span>
			<For each={AXIS_ROWS}>
				{row => (
					<div class="field">
						<span class="field-label">{row.axis} range</span>
						<input
							type="number"
							class="env-bound"
							step="1"
							aria-label={`Envelope ${row.axis} low`}
							aria-invalid={refused(row.axis)}
							value={fields()[row.lo]}
							onInput={e => setBound(row.lo, e.currentTarget.value)}
							onChange={commitEnvelope}
							onKeyDown={e => { if (e.key === "Enter") commitEnvelope(); }}
						/>
						<span class="env-sep">to</span>
						<input
							type="number"
							class="env-bound"
							step="1"
							aria-label={`Envelope ${row.axis} high`}
							aria-invalid={refused(row.axis)}
							value={fields()[row.hi]}
							onInput={e => setBound(row.hi, e.currentTarget.value)}
							onChange={commitEnvelope}
							onKeyDown={e => { if (e.key === "Enter") commitEnvelope(); }}
						/>
						<span class="env-unit">mm</span>
					</div>
				)}
			</For>
			{/* ALWAYS rendered, at a fixed height. The refusal is the whole point
			    of the card and it must not arrive by pushing everything below it
			    down the screen — the same reserved-slot discipline .color-clash
			    uses on the chart-colour rows. */}
			<p class="env-status" role="status" classList={{ bad: verdict().kind === "rejected" }}>
				{envelopeStatusText(verdict())}
			</p>

			<span class="set-cap">Motion defaults</span>
			<For each={MOTION_FIELDS}>
				{field => (
					<div class="field">
						<span class="field-label">{field.label}</span>
						<input
							type="number"
							step={field.step}
							aria-label={field.label}
							value={field.read(app.config.config.shaping.defaults)}
							onChange={e => commitMotion(field, e.currentTarget)}
						/>
						<span class="env-unit">{field.unit}</span>
					</div>
				)}
			</For>
			<p class="env-status" role="status" classList={{ bad: motionNote() !== "" }}>{motionNote()}</p>

			<span class="set-cap">Accelerometers</span>
			<Show when={app.om.om.tools.length} fallback={<p class="job-empty">Waiting…</p>}>
				<For each={app.om.om.tools}>
					{tool => (
						<Show when={tool}>
							{t => (
								<div class="field">
									<span class="field-label">T{t().number}</span>
									<input
										type="text"
										class="accel-addr"
										placeholder="board.device"
										aria-label={`T${String(t().number)} accelerometer address`}
										value={accelField(t().number)}
										onInput={e => setAccelEdit(prev => ({ ...prev, [t().number]: e.currentTarget.value }))}
										onChange={() => commitAccel(t().number)}
										onKeyDown={e => { if (e.key === "Enter") commitAccel(t().number); }}
									/>
									{/* Reserved, like the envelope's line: four tools that each
									    gain and lose a sentence would reflow the card on every
									    edit. */}
									<span class="accel-status" role="status" title={accelStatus(t().number)}>
										{accelStatus(t().number)}
									</span>
								</div>
							)}
						</Show>
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
			{/* The three-line paragraph that used to sit here was the card's biggest
			    reflow source — 63px of prose at 600 wide, 126px at 240, so the card
			    rearranged itself at every size. The one fact in it that was not
			    already obvious from a list of dated rows with Restore buttons is
			    WHERE the settings live, and that is what the card's tip is for. */}
			<Show when={app.config.snapshots.length} fallback={<p class="job-empty">No saved versions</p>}>
				<For each={app.config.snapshots}>
					{(snap, index) => (
						<div class="field saved-version">
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
	const [armed, setArmed] = createArmed<true>();
	const [label, setLabel] = createSignal("");

	const disarm = (): void => {
		setArmed(null);
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
			{/* The status and the save controls share a line and may wrap; Reset
			    everything gets its own, below. It used to sit in the same flex
			    flow, so arming the save (which swaps a name field in) pushed it
			    onto a second line and back again — a destructive control moving
			    under the pointer as a side effect of starting a save. */}
			<div class="save-actions">
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
			</div>
			<button
				class="link-btn reset-all"
				title="Return every setting and built-in screen to defaults. Your custom cards and screens are kept — delete those individually."
				onClick={() => app.config.resetAll()}
			>
				Reset everything
			</button>
		</div>
	);
}
