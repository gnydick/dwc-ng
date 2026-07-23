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
import { Show, createEffect, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { HeightMapGrid } from "../heightmap/HeightMapGrid.tsx";
import { buildProbeCommand } from "../heightmap/probeCommand.ts";
import { parseProbeReply, heightmapValue } from "../heightmap/probeReply.ts";
import type { CardCtx } from "../compose/ctx.ts";

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

export function ProbePointBody(props: { ctx: CardCtx }) {
	const app = useApp();
	const svc = props.ctx.service("heightmap");
	const { store } = svc;

	// Probe transaction state is THIS card's own; only the outcome message and
	// the map edits are shared (via the service / the store).
	const [probing, setProbing] = createSignal(false);
	const [reply, setReply] = createSignal("");
	const [probed, setProbed] = createSignal<number | null>(null);
	/** Manual nudge step, mm. Matches the babystep control's granularity. */
	const [step, setStep] = createSignal(0.01);

	const clearProbe = (): void => {
		setProbed(null);
		setReply("");
	};

	// A probe result belongs to the cell it measured: selecting a different
	// cell clears it (the bespoke view did this inside its select()).
	createEffect(() => {
		svc.selected();
		clearProbe();
	});

	const reprobe = async (): Promise<void> => {
		const target = svc.cell();
		if (target === null) return;
		setProbing(true);
		clearProbe();
		svc.setMessage("");
		const code = buildProbeCommand(app.config.config.bed.probePointCommand, target.x, target.y);
		try {
			const text = await app.connector.sendCode(code);
			setReply(text);
			const result = parseProbeReply(text);
			const probe = app.om.om.sensors.probes[0];
			if (result === null) {
				// A reply with no stop height is a failure to read, not a probe of zero -
				// there is nothing to offer for acceptance.
				svc.setMessage("No stop height in the reply - nothing to accept.");
			} else if (probe == null) {
				svc.setMessage("No probe in the model - cannot make the reading relative to the trigger height.");
			} else {
				// The map value is the stop height RELATIVE to the probe's trigger height,
				// not the raw stop: RRF reports machine Z near the trigger height (e.g. ~-13),
				// so storing it raw would be a ~13mm error. Subtracting makes a high spot
				// read positive for any sign of triggerHeight.
				setProbed(heightmapValue(result.stopHeight, probe.triggerHeight));
			}
		} catch (err) {
			svc.setMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setProbing(false);
		}
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
