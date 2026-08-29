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
import { reportText } from "../shaping/accelReport.ts";
import type { CardCtx } from "../compose/ctx.ts";
import { useApp } from "../shell/context.ts";
import { MAX_LABEL_LEN, DEFAULT_THERMAL_COLORS, type Envelope, type ThermalColors } from "../config/types.ts";
import { commitMotionField, MOTION_FIELDS, type MotionField } from "../shaping/motionFields.ts";
import { parseAccelAddr } from "../control/commands.ts";
import { accelerometerOf } from "../shaping/accelPresence.ts";
import {
	accelStatusText, draftEnvelope, draftOf, envelopeStatusText, judgeAccel, judgeDraft, sameDraft,
	type EnvelopeAxis, type EnvelopeDraft, type EnvelopeVerdict,
} from "../shaping/settingsDraft.ts";
import { heaterSeries } from "../om/heaterSeries.ts";
import { groundOf, theme } from "../shell/theme.ts";
import { nearestCollision, isHexColor } from "../util/colorDistance.ts";
import { sensorRows } from "../om/sensorRows.ts";
import { captureScreenGeometry } from "../compose/screens.ts";
import { machineStoreFor } from "../config/machineStore.ts";
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
								<span class={`color-clash${clashText() === "" ? "" : " speaking"}`} role="status" title={clashText()}>
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
	/**
	 * SYMBOLS, NOT PROSE, on the two outer bands (Gabe, 2026-08-28: "temp
	 * gradient is shrinking below the prose horizontally, just change the last
	 * row to '>160...' instead of the words, change first row to '<45...'").
	 * "below 45 °C" and "160 °C and above" are wrappable prose whose longest
	 * word still went into this card's width stop; the middle band was already
	 * the compact range form and is left exactly as it was.
	 *
	 * `≥` rather than the `>` Gabe typed, on the hot band ONLY. The thresholds
	 * these three strings describe are ToolsHeatersCard.tsx:473-474 — warm is
	 * `>= 45 && < 160`, hot is `>= 160` — so 160.0 °C reads HOT, and "> 160 °C"
	 * would be the one temperature at which the legend disagreed with the
	 * colour beside it. Cold needs no such care: the band really is exclusive
	 * at 45, so `<` is literal.
	 */
	const channels: Array<{ key: keyof ThermalColors; label: string; range: string }> = [
		{ key: "cold", label: "Cold", range: "< 45 °C" },
		{ key: "warm", label: "Warm", range: "45 – 160 °C" },
		{ key: "hot", label: "Hot", range: "≥ 160 °C" },
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
							<span class={`color-clash${clashText() === "" ? "" : " speaking"}`} role="status" title={clashText()}>
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
 * The Shaping Lab's settings: the motion envelope and the capture defaults.
 *
 * WHAT IS NOT HERE, AND WHY (#140). The accelerometer address and its sampling
 * rate used to be two more sections on this card. They are properties of the
 * MACHINE, not of the shaping feature — #47's machine-dynamics battery wants
 * the same two facts — and they were here only because the Lab was the first
 * thing to want them. They are now `AccelerometersBody` below. What stayed is
 * what genuinely belongs to a shaping RUN: the box it is allowed to move in,
 * and the move it performs. `MOTION_FIELDS` in particular stays because it is
 * shared with the Lab's Capture card under `one-motion-field-table` — it
 * describes the move, not the sensor.
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
 * Nothing on this card validates anything. `setShaping` is the gate
 * (config/parse.ts via config/store.ts) and the card's whole job is to make its
 * verdicts legible; shaping/settingsDraft.ts carries the words and the per-axis
 * probe, and both go through `asEnvelope` itself.
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
		</>
	);
}

/**
 * The machine's accelerometers: which sensor is on which tool, and what rate
 * and resolution it is running.
 *
 * SPLIT OUT OF THE SHAPING SETTINGS CARD (#140). Gabe, 2026-08-28: "split
 * accelerometers & sampling configs out of the input shaping card into 1 shared
 * card". The two sections were on a shaping-branded card only because the
 * Shaping Lab was the first thing that wanted them, and an operator asking
 * "which sensor is on T2" had to look under Input shaping to find out. An
 * address and a sample rate are properties of the MACHINE — #47's
 * machine-dynamics battery reads exactly these two facts — so the card is named
 * for the hardware and nothing about it is shaping-branded.
 *
 * ONE card for both, not two, and that is the point of the "shared" in the
 * ruling: the two failure modes look identical on a card that shows only one of
 * them — no accelerometer, and an accelerometer sampling too slowly to see what
 * you are asking it about. Splitting them across two cards would let an
 * operator read the address without ever seeing the rate.
 *
 * NOTHING HERE DECIDES ANYTHING, in either half.
 *
 *  - The address goes through `setAccelAddr` (config/parse.ts via
 *    config/store.ts), which is the one gate on what an address is, and the row
 *    reports its verdict through `judgeAccel`/`accelStatusText` rather than
 *    saying anything of its own.
 *  - The rate does not go into the config at all. RRF adjusts the resolution to
 *    be no greater than R and then picks a rate supported AT that resolution,
 *    so what is typed here and what the sensor does are routinely different
 *    numbers. The line under each row is the BOARD'S reply to `M955 P`, not an
 *    echo of the fields.
 *
 * THE ACCEL SERVICE, not the Lab's. This card is eager (see compose/cards.tsx)
 * and reaching the Lab's service from here is what put 23 modules of shaping/**
 * on every cold load (#126). Same pool entry the Lab's Capture card takes, so
 * the two cannot disagree about what the sensor reported.
 *
 * NO `Reset` ACTION, deliberately (#140 open question). `resetSection` is
 * section-granular and the section is `shaping` — envelope, motion defaults and
 * `accelByTool` together. A Reset here would silently take the operator's
 * envelope with it, which is a card misstating its own scope. Blanking a row's
 * field clears that address, which is the granularity this card actually owns.
 */
export function AccelerometersBody(props: { ctx: CardCtx }) {
	const app = useApp();
	// The ACCEL service, not the Lab's — see the note above.
	const accel = props.ctx.service("accel");

	// Two signals per tool, the same shape the envelope editor uses: `edit`
	// holds the operator's own text and is absent while the row MIRRORS the
	// store, `committed` is the text as it was at the last write. Without the
	// second, "typed but not applied" and "applied and refused" are the same
	// picture in the input.
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

	/**
	 * The rate and resolution fields, per tool.
	 *
	 * Held as text and never seeded from the board's report. What the sensor is
	 * DOING and what the operator is ASKING FOR are different things, and a
	 * field that mirrored the report would make "5376" look like a setting that
	 * had been accepted when the board had quietly given 1344 — which is
	 * precisely what RRF does when the resolution does not allow the rate.
	 */
	const [rateEdit, setRateEdit] = createSignal<Record<number, string>>({});
	const [bitsEdit, setBitsEdit] = createSignal<Record<number, string>>({});
	const [rateArmed, setRateArmed] = createSignal<number | null>(null);

	/** What the board last said, in its own words. */
	const accelReport = (tool: number) => accel.accelReportFor(tool);

	const applyRate = (tool: number): void => {
		const rate = Number(rateEdit()[tool]);
		const bits = Number(bitsEdit()[tool] ?? "10");
		if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(bits) || bits <= 0) return;
		if (rateArmed() !== tool) {
			setRateArmed(tool);
			return;
		}
		setRateArmed(null);
		void accel.setAccelRate(tool, rate, bits);
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
			{/* ONE ROW PER TOOL (Gabe, 2026-08-28: "accelerometers card should have
			    the rows combined, no need for 8 rows, each set of 4 tools twice").
			    #140 shipped this card as two SECTIONS — Address, then Sampling —
			    each with a row per tool, so a four-tool machine drew eight rows and
			    said "T0…T3" twice. The tool is the thing the operator is looking
			    for, and it was the one thing repeated.

			    Nothing is dropped by the merge: the address field, its verdict, the
			    rate, the resolution, the arming Set/Confirm, the Read, and the
			    board's reply are all still here, in that order, on one line.

			    The two section captions are gone with the sections. There is one
			    group now, and the card's own title is what names it; a caption over
			    a single list is a heading for nothing. What the captions used to
			    say per COLUMN is carried by each control itself — the placeholders
			    ("board.device", "Hz", "bits") and the aria-labels, which is what an
			    assistive reader had to rely on inside a row anyway.

			    No standing paragraph, for the reason the shaping card gives: prose
			    rewraps as a card is resized, and everything it would say is said by
			    the per-row status slots, which have to exist anyway. */}
			<Show when={app.om.om.tools.length} fallback={<p class="job-empty">Waiting…</p>}>
				<For each={app.om.om.tools}>
					{tool => (
						<Show when={tool}>
							{t => (
								<div class="field">
									{/* Once, not twice — the whole point of the merge. */}
									<span class="field-label">T{t().number}</span>
									<input
										type="text"
										class="accel-addr"
										placeholder="board.device"
										aria-label={`T${String(t().number)} accelerometer address`}
										title={`T${String(t().number)} accelerometer address`}
										value={accelField(t().number)}
										onInput={e => setAccelEdit(prev => ({ ...prev, [t().number]: e.currentTarget.value }))}
										onChange={() => commitAccel(t().number)}
										onKeyDown={e => { if (e.key === "Enter") commitAccel(t().number); }}
									/>
									{/* Sampling, on the SAME row as the address because it is a
									    property of the same sensor — and because the two failure
									    modes look identical on a card that shows only one of
									    them: no accelerometer, and an accelerometer sampling too
									    slowly to see what you are asking it about. Merging the
									    rows makes that pairing structural rather than a matter
									    of scrolling between two sections. */}
									<input
										type="number"
										class="accel-rate"
										placeholder="Hz"
										min="1"
										step="1"
										aria-label={`T${String(t().number)} sample rate`}
										title={`T${String(t().number)} sample rate`}
										value={rateEdit()[t().number] ?? ""}
										onInput={e => { setRateArmed(null); setRateEdit(prev => ({ ...prev, [t().number]: e.currentTarget.value })); }}
									/>
									<input
										type="number"
										class="accel-bits"
										placeholder="bits"
										min="1"
										step="1"
										aria-label={`T${String(t().number)} resolution in bits`}
										title={`T${String(t().number)} resolution in bits`}
										value={bitsEdit()[t().number] ?? ""}
										onInput={e => { setRateArmed(null); setBitsEdit(prev => ({ ...prev, [t().number]: e.currentTarget.value })); }}
									/>
									<button
										class="fb-tool"
										classList={{ "shp-arming": rateArmed() === t().number }}
										disabled={!accelPresent(t().number)}
										onClick={() => applyRate(t().number)}
									>
										{rateArmed() === t().number ? "Confirm" : "Set"}
									</button>
									<button class="fb-tool" disabled={!accelPresent(t().number)} onClick={() => void accel.readAccel(t().number)}>
										Read
									</button>
									{/* The board's own words, kept as a SECOND reserved slot
									    rather than folded into the verdict beside it. RRF adjusts
									    the resolution to be no greater than R and then picks a
									    rate supported AT that resolution, so what is typed here
									    and what the sensor does are routinely different numbers,
									    and this is the sensor's answer — not an echo of the
									    fields and not a judgement on the address. One slot would
									    need a precedence rule to decide which of the two to show
									    when both have something to say ("not applied" standing
									    over a reply from the address before it), and inventing
									    that rule is this card deciding something. It decides
									    nothing.

									    BEFORE the verdict, and that order is load-bearing —
									    see the verdict's own note below. */}
									<span class="accel-status accel-reply" role="status" title={reportText(accelReport(t().number))}>
										{reportText(accelReport(t().number))}
									</span>
									{/* The gate's verdict on the address, and the LAST thing in
									    the row on purpose.

									    Gabe, 2026-08-28: "the new accelerometer card has a huge
									    artificial blank between input field columns 1 and 2".
									    This slot used to sit immediately after the address it
									    judges, and it is EMPTY whenever the mapping works — which
									    is the ordinary state — so its reserved 144px rendered as
									    a hole between two columns of inputs.

									    Three things have to hold at once and only this position
									    holds all three:

									      · nothing else may move when a message appears or clears
									        (four tool rows reflowing as the operator types is the
									        reflow this slot was reserved to prevent in the first
									        place);
									      · the reservation may not show as blank when silent;
									      · and it may not put its sentence into the card's
									        min-content (#142).

									    A reserved box that is LAST has no neighbour to its right,
									    so the space it holds when silent is indistinguishable
									    from the row's own trailing space — invisible — while
									    still moving nothing when it speaks. Anywhere else in the
									    row, "invisible when silent" and "moves nothing when
									    speaking" are the same property with opposite signs.

									    This is why the reply above it comes FIRST: reportText
									    never returns "" (it says "not asked" before anything has
									    been read), so it is never the silent one, and the slot
									    that CAN be silent is the one that gets the end of the
									    row. That is pinned by a test — accelerometer-card.test.ts
									    — because it is a layout claim resting on a string
									    function's totality. */}
									<span
										class={`accel-status${accelStatus(t().number) === "" ? "" : " speaking"}`}
										role="status"
										title={accelStatus(t().number)}
									>
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
					{snap => (
						<div class="field saved-version">
							{/* Date AND time: a list of times alone cannot tell yesterday's
							    backup from this morning's. Same format as the file
							    browser's modified column. */}
							<span class="field-label stamp">{formatTimestamp(snap.takenAt)}</span>
							<span class="hint">{snap.label}</span>
							<button class="link-btn" onClick={() => app.config.revert(snap.id)}>Restore</button>
						</div>
					)}
				</For>
			</Show>
			{/* Set by revert() (config/store.ts) when the restored snapshot has no
			    machine half on record for THIS machine — a different machine, no
			    machine identified, or an entry aged out of this machine's own
			    cap. Only preferences were restored in that case; this is how the
			    operator is told the restore was partial rather than it looking
			    identical to a full one. */}
			<Show when={app.config.meta.revertNotice}>
				{text => <p class="hint unsaved">{text()}</p>}
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
		captureScreenGeometry(app.config, machineStoreFor(app.machineId()));
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
			{/* Precedence, worst news first: a failure, then unsaved work, then
			    what this session actually saved, then the resting state.
			    "Saved as X" sits BELOW dirty on purpose — a stale confirmation
			    over unsaved work is a positive claim that is false, which is
			    worse than no confirmation at all.

			    This is #118 requirement 1, and it is the half that ordering
			    cannot do: the card's list is fixed-height and never scrolled,
			    so a ninth backup appearing in it told the operator nothing
			    ("i saved to machine and nothing showed up", with eight already
			    on the card and every save having worked). The name comes from
			    the store as STORED — trimmed, capped, defaulted — so it names
			    a row that is really in the list. */}
			<Show
				when={saveError()}
				fallback={
					<Show when={app.config.dirty} fallback={
						<Show when={app.config.lastSaved} fallback={<span class="hint">All changes saved.</span>}>
							{saved => <span class="hint">Saved as &ldquo;{saved().label}&rdquo;.</span>}
						</Show>
					}>
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
