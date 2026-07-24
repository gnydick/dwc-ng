/**
 * Bed card bodies — the height map and single-point re-probing. The tightest
 * coupling in the app (the sweep's verdict): both cards share the store, the
 * selected cell, and one message line — all owned by the heightmap SERVICE
 * (compose/services.ts), so the two bodies cannot hold divergent state and
 * the connection-gated load lifecycle exists exactly when a bed card is on
 * screen.
 *
 * Nothing reaches the SD card until Save, and Save is upload + G29 S1
 * together (heightmap/store.ts): the file and the map the machine compensates
 * with must not be able to diverge. Re-probing sends ONE operator-configured
 * command and reports what came back; accepting is a separate act.
 */
import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { HeightMapGrid } from "../heightmap/HeightMapGrid.tsx";
import { buildProbeCommand } from "../heightmap/probeCommand.ts";
import { parseProbeReply, heightmapValue } from "../heightmap/probeReply.ts";
import { HEIGHTMAP_FILE } from "../heightmap/store.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import { cmd } from "../control/commands.ts";
import { parseFileName } from "../files/path.ts";
import { parseTramReply } from "../bed/tramReply.ts";
import type { Compensation } from "../om/types.ts";
import type { CardCtx } from "../compose/ctx.ts";

/** Height maps live beside the firmware's own default, in /sys. */
const SYS_DIR = "0:/sys";

/**
 * How long to keep watching the model for a probe reading after the request
 * itself has given up. Generous: the macro lifts, traverses the bed and taps up
 * to five times, and abandoning a probe that is still running would leave the
 * operator with no result for a move the machine did make.
 */
const PROBE_WAIT_MS = 90_000;

export function HeightmapBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("heightmap");
	const { store } = svc;

	const save = async (): Promise<void> => {
		const result = await store.save();
		svc.setMessage(result.ok ? "Saved and reloaded (G29 S1)." : result.error);
	};

	return (
		<>
			<div class="hm-bar">
				<button class="fb-tool" onClick={() => void store.load()}>Reload</button>
				<button class="fb-tool ok" disabled={!store.dirty()} onClick={() => void save()}>
					Save{store.dirty() ? ` (${store.pending().size})` : ""}
				</button>
				<button class="fb-tool" disabled={!store.dirty()} onClick={() => store.discard()}>Discard</button>
				{/* Always present so a message cannot reflow the grid below it. */}
				<span class="hm-msg">{svc.message()}</span>
			</div>
			<Show
				when={store.map()}
				fallback={
					<p class="job-empty">
						{store.loading() ? "Reading height map…" : (store.error() || "No height map on the machine.")}
					</p>
				}
			>
				{map => (
					<HeightMapGrid
						map={map()}
						valueAt={(r, c) => store.valueAt(r, c)}
						isEdited={(r, c) => store.pending().has(`${r},${c}`)}
						selected={svc.selected()}
						onSelect={(row, col) => {
							svc.setSelected({ row, col });
							svc.setMessage("");
						}}
					/>
				)}
			</Show>
		</>
	);
}

/**
 * Mesh bed compensation: which height map the machine is using, and the four
 * things you can do to it.
 *
 * The picker drives BOTH halves at once — it loads the file into the grid on
 * this screen AND is what Load sends to the board — so the map you are looking
 * at is always the map you are acting on. Probing, loading, clearing and
 * save-as stay 1:1 with their G-codes (G29 / G29 S1 P / G29 S2 / G29 S3 P);
 * nothing here decides whether a mesh is appropriate, only which file.
 */
export function MeshBody(props: { ctx: CardCtx }) {
	const app = useApp();
	const svc = props.ctx.service("heightmap");
	const { store } = svc;

	const connected = (): boolean => app.om.connection.status === "connected";

	// Every .csv in /sys is a candidate map. Listed rather than typed: the whole
	// point of the item is choosing among the ones that exist.
	const [files, { refetch }] = createResource(
		() => (connected() ? SYS_DIR : false),
		async dir => {
			const entries = await app.connector.list(dir as string);
			return entries
				.filter(e => e.type === "f" && e.name.toLowerCase().endsWith(".csv"))
				.map(e => `${SYS_DIR}/${e.name}`)
				.sort((a, b) => a.localeCompare(b));
		},
	);

	/** The name Save-as will write. Blank until typed. */
	const [saveAs, setSaveAs] = createSignal("");

	// A .csv suffix is not optional: G29 reads height maps by name and a file
	// saved without one is a map you cannot pick back up here.
	const saveTarget = (): string | null => {
		const raw = saveAs().trim();
		if (raw === "") return null;
		const name = parseFileName(raw.toLowerCase().endsWith(".csv") ? raw : `${raw}.csv`);
		return name === null ? null : `${SYS_DIR}/${name}`;
	};

	/** Files the board knows about, plus whatever is loaded, so the select can
	 *  never sit on a blank while showing a real map. */
	const options = (): string[] => {
		const list = [...(files() ?? [])];
		if (!list.includes(store.path())) list.push(store.path());
		if (!list.includes(HEIGHTMAP_FILE)) list.unshift(HEIGHTMAP_FILE);
		return list;
	};

	const pick = (path: string): void => {
		svc.setMessage("");
		svc.setSelected(null);
		void store.load(path);
	};

	/**
	 * What the machine is compensating with RIGHT NOW — which is not the same
	 * as what is selected above, or what is on the card. Worth its own line
	 * because G32 runs M561 first, so every tram silently leaves the machine
	 * with no mesh active, and nothing else on screen would say so.
	 */
	const comp = (): Compensation => app.om.om.move.compensation;
	const meshActive = (): boolean => comp().type !== "none";

	return (
		<div class="mesh-card">
			<p class="mesh-status" classList={{ on: meshActive() }}>
				<Show
					when={meshActive()}
					fallback={<>No mesh compensation active</>}
				>
					Compensating: {comp().file ?? "unnamed map"}
					<Show when={comp().meshDeviation}>
						{d => <> · deviation {d().deviation.toFixed(3)} mm</>}
					</Show>
				</Show>
			</p>
			<label class="mesh-pick">
				<span class="mesh-label">Height map</span>
				<select
					class="filament-pick"
					aria-label="Height map file"
					value={store.path()}
					onChange={e => pick(e.currentTarget.value)}
				>
					<For each={options()}>{path => <option value={path}>{path.replace(`${SYS_DIR}/`, "")}</option>}</For>
				</select>
				<button class="fb-tool" disabled={!connected()} onClick={() => void refetch()}>Rescan</button>
			</label>

			{/* Loading into the GRID is a download; telling the machine to compensate
			    from it is a G-code. They are separate acts and separately labelled —
			    picking a file to look at must not silently re-level the machine. */}
			<div class="mesh-actions">
				<GcodeButton
					label="Probe bed"
					variant="go"
					stamp={false}
					command={cmd.probeMesh()}
					onSent={() => svc.setMessage("Probing — the grid reloads when it finishes.")}
				/>
				<GcodeButton
					label="Use this map"
					stamp={false}
					command={cmd.loadHeightmap(store.path() === HEIGHTMAP_FILE ? undefined : store.path())}
				/>
				<GcodeButton
					label="Save as"
					stamp={false}
					disabled={saveTarget() === null}
					command={cmd.saveHeightmapAs(saveTarget() ?? "heightmap.csv")}
					onSent={() => { setSaveAs(""); void refetch(); }}
				/>
				<GcodeButton label="Clear mesh" variant="danger" stamp={false} command={cmd.clearMesh()} />
			</div>

			<label class="feed-field mesh-saveas">
				Save as
				<input
					type="text"
					placeholder="name.csv"
					value={saveAs()}
					aria-label="Save the current height map as"
					onInput={e => setSaveAs(e.currentTarget.value)}
				/>
			</label>
		</div>
	);
}

/**
 * Bed tramming — G32 runs bed.g, which on this machine levels by driving the Z
 * leadscrews (UVW) independently.
 *
 * No M561 control here on purpose. M561 clears a bed PLANE fit, and this
 * machine has none to clear: bed.g probes three points and finishes with S0
 * while M671 and three Z motors are configured, so RRF moves the screws instead
 * of skewing coordinates (hence "Leadscrew adjustments made", and
 * compensation.type staying "none" with all skew tangents at zero). bed.g also
 * already runs M561 as its own first line, which is the one place it earns its
 * keep — clearing a stale correction before measuring. A button for it would be
 * a control that does nothing on this machine.
 *
 * The result is read from the REPLY LOG, not from the button's promise.
 * Measured on the machine: sendCode resolves while bed.g is still probing, and
 * the summary line lands ~25s later — so a card that waited on the send would
 * show nothing, every time. The log is where the reply actually arrives.
 *
 * Home Z sits here because tramming MOVES the bed: the Z datum after a tram is
 * not the one you started with, and re-homing is the last step of the job
 * rather than a separate errand.
 */
export function BedTramBody() {
	const app = useApp();

	/** The newest reply that parses as a leadscrew tram, or null. */
	const lastTram = createMemo(() => {
		const lines = app.om.console;
		for (let i = lines.length - 1; i >= 0; i--) {
			const parsed = parseTramReply(lines[i]!.text);
			if (parsed !== null) return { at: lines[i]!.receivedAt, result: parsed };
		}
		return null;
	});

	const mm = (v: number): string => v.toFixed(3);

	return (
		<div class="mesh-card">
			<div class="mesh-actions">
				<GcodeButton label="Tram bed" variant="go" stamp={false} command={cmd.bedTram()} />
				<GcodeButton label="Home Z" stamp={false} command={cmd.homeAxis("Z")} />
			</div>
			<Show
				when={lastTram()}
				fallback={<p class="job-empty">No tram result yet this session.</p>}
			>
				{tram => (
					<dl class="meta-grid tram-result">
						{/* Per-screw corrections, in the order M671 declares the pivots. */}
						<dt>Adjusted</dt>
						<dd>{tram().result.adjustments.map(mm).join("  ")}</dd>
						{/* Deviation is the FLATNESS figure — how much the probed points
						    disagreed. Mean is just how far the whole bed sat from Z=0, which
						    re-homing resolves anyway, so deviation is the one to read. */}
						<dt>Deviation</dt>
						<dd>
							{mm(tram().result.before.deviation)} → {mm(tram().result.after.deviation)} mm
						</dd>
						<dt>Points</dt>
						<dd>{tram().result.pointsUsed}</dd>
					</dl>
				)}
			</Show>
		</div>
	);
}

export function ProbePointBody(props: { ctx: CardCtx }) {
	const app = useApp();
	const svc = props.ctx.service("heightmap");
	const { store } = svc;

	// Probe transaction state is THIS card's own; only the outcome message and
	// the map edits are shared (via the service / the store).
	const [probing, setProbing] = createSignal(false);
	const [reply, setReply] = createSignal("");
	const [probed, setProbed] = createSignal<number | null>(null);
	/** The RAW machine Z the probe stopped at, kept so the card can show the
	 *  subtraction rather than only its result. */
	const [rawStop, setRawStop] = createSignal<number | null>(null);
	/** Manual nudge step, mm. Matches the babystep control's granularity. */
	const [step, setStep] = createSignal(0.01);

	const clearProbe = (): void => {
		setProbed(null);
		setRawStop(null);
		setReply("");
	};

	// A probe result belongs to the cell it measured: selecting a different
	// cell clears it (the bespoke view did this inside its select()).
	createEffect(() => {
		svc.selected();
		clearProbe();
	});

	/**
	 * Watch the model for a reading that is genuinely NEW.
	 *
	 * Compared against the value from before the send, never against null: a
	 * macro that aborts on one of its guards leaves lastStopHeight untouched, so
	 * "changed" is the only honest evidence that a probe actually happened.
	 * Failing closed here costs a re-probe; failing open would write a stale
	 * number into the map.
	 */
	const waitForNewStopHeight = async (before: number | null): Promise<number | null> => {
		const deadline = Date.now() + PROBE_WAIT_MS;
		while (Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 400));
			const now = app.om.om.sensors.probes[0]?.lastStopHeight ?? null;
			if (now !== null && now !== before) return now;
		}
		return null;
	};

	const reprobe = async (): Promise<void> => {
		const target = svc.cell();
		if (target === null) return;
		setProbing(true);
		clearProbe();
		svc.setMessage("");
		const code = buildProbeCommand(app.config.config.bed.probePointCommand, target.x, target.y);
		// What the model said BEFORE the probe. A macro that aborts on one of its
		// own guards (bed below temperature, a tool undocked) leaves
		// lastStopHeight at its PREVIOUS value, so reading it blindly would
		// accept a stale number as a fresh measurement. Requiring it to change is
		// what makes "a probe happened" observable rather than assumed.
		const before = app.om.om.sensors.probes[0]?.lastStopHeight ?? null;
		let stopHeight: number | null = null;
		let sendError = "";
		try {
			const text = await app.connector.sendCode(code);
			setReply(text);
			const parsed = parseProbeReply(text);
			if (parsed !== null) stopHeight = parsed.stopHeight;
		} catch (err) {
			sendError = err instanceof Error ? err.message : String(err);
		}
		// The request can time out while the probe is still running and succeed
		// anyway: measured on the machine, a real re-probe (lift, travel, probe,
		// retract) outlives the connector's request timeout, the POST rejects,
		// and the reading lands moments later. Losing a good probe to that is
		// worse than waiting, so fall back to the object model — which carries
		// the reading directly as sensors.probes[].lastStopHeight, no reply text
		// to parse and nothing to lose if the reply never arrives.
		if (stopHeight === null) {
			svc.setMessage(sendError === "" ? "Waiting for the reading…" : `${sendError} — waiting for the reading…`);
			stopHeight = await waitForNewStopHeight(before);
			if (stopHeight !== null) setReply(`Stopped at height ${stopHeight} mm (from the object model)`);
		}
		const probe = app.om.om.sensors.probes[0];
		if (stopHeight === null) {
			// No reply AND no change in the model: nothing was measured. Reporting
			// a value here would be inventing one.
			svc.setMessage(sendError === "" ? "No reading - nothing to accept." : sendError);
		} else if (probe == null) {
			svc.setMessage("No probe in the model - cannot make the reading relative to the trigger height.");
		} else {
			// The map value is the stop height RELATIVE to the probe's trigger height,
			// not the raw stop: RRF reports machine Z near the trigger height (e.g. ~-13),
			// so storing it raw would be a ~13mm error. Subtracting makes a high spot
			// read positive for any sign of triggerHeight.
			svc.setMessage("");
			setRawStop(stopHeight);
			setProbed(heightmapValue(stopHeight, probe.triggerHeight));
		}
		setProbing(false);
	};

	/**
	 * Adjust a point by hand, without probing. Needs no accept step: unlike a
	 * probe, whose value comes from the machine and may be nonsense, a nudge is
	 * already the operator's own deliberate number. It still lands in the
	 * pending overlay, so nothing reaches the card until Save.
	 */
	const nudge = (delta: number): void => {
		const target = svc.cell();
		if (target === null) return;
		const next = store.valueAt(target.row, target.col) + delta;
		// Keep the file's own precision: the map is written to three decimals.
		store.edit(target.row, target.col, Number(next.toFixed(3)));
		clearProbe();
	};

	const accept = (): void => {
		const target = svc.cell();
		const value = probed();
		if (target === null || value === null) return;
		store.edit(target.row, target.col, value);
		clearProbe();
	};

	return (
		<Show when={svc.cell()} fallback={<p class="job-empty">Select a point on the map.</p>}>
			{target => (
				<div class="hm-detail">
					<dl class="meta-grid">
						<dt>Cell</dt><dd>row {target().row}, col {target().col}</dd>
						<dt>Position</dt><dd>X {target().x.toFixed(2)} · Y {target().y.toFixed(2)}</dd>
						<dt>Current</dt><dd>{store.valueAt(target().row, target().col).toFixed(3)} mm</dd>
					</dl>
					<button class="fb-tool" disabled={probing()} onClick={() => void reprobe()}>
						{probing() ? "Probing…" : "Re-probe"}
					</button>

					{/* Adjust by hand, no machine involved. */}
					<div class="hm-nudge">
						<button class="fb-act" onClick={() => nudge(-step())}>− {step()}</button>
						<button class="fb-act" onClick={() => nudge(step())}>+ {step()}</button>
						<label class="feed-field">
							mm
							<input
								type="number"
								step="0.005"
								min="0"
								value={step()}
								aria-label="Nudge step in mm"
								onInput={e => setStep(Math.abs(Number(e.currentTarget.value)) || 0.01)}
							/>
						</label>
					</div>
					<Show when={probed() !== null}>
						<div class="hm-result">
							<p class="hm-line">
								{store.valueAt(target().row, target().col).toFixed(3)} → <b>{probed()!.toFixed(3)}</b> mm
							</p>
							{/* Show the ARITHMETIC, not just its result. The reply below is a
							    raw machine Z sitting near the trigger height (~-13 here), so
							    without the subtraction spelled out it looks unrelated to the
							    value being stored — and a ~13mm error looks entirely
							    plausible. Spelling it out makes the number auditable against
							    the machine's own words directly underneath. */}
							<Show when={rawStop() !== null}>
								<p class="hm-derive">
									{rawStop()!.toFixed(3)} raw − {(app.om.om.sensors.probes[0]?.triggerHeight ?? 0).toFixed(3)} trigger
									{" = "}{probed()!.toFixed(3)} mm
								</p>
							</Show>
							{/* The machine's own words, kept beside the number taken from
							    them: a probe that landed on swarf or failed to trigger
							    cleanly should be visible before it enters the map. */}
							<pre class="hm-reply">{reply()}</pre>
							<div class="hm-actions">
								<button class="fb-tool ok" onClick={accept}>Accept</button>
								<button class="fb-tool" onClick={clearProbe}>Discard</button>
							</div>
						</div>
					</Show>
				</div>
			)}
		</Show>
	);
}
