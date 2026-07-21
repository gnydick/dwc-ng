import { Show, createEffect, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { createHeightMapStore } from "../heightmap/store.ts";
import { HeightMapGrid } from "../heightmap/HeightMapGrid.tsx";
import { cellPosition } from "../heightmap/parse.ts";
import { buildProbeCommand } from "../heightmap/probeCommand.ts";
import { parseProbeReply } from "../heightmap/probeReply.ts";
import { BED_PANEL_DEFAULTS } from "./bed.panelDefaults.ts";

/**
 * Bed — the height map, and re-probing single points of it.
 *
 * Nothing reaches the SD card until Save, and Save is upload + G29 S1 together
 * (see heightmap/store.ts): the file and the map the machine is compensating
 * with must not be able to diverge.
 *
 * Re-probing sends ONE operator-configured command and reports what came back.
 * The reported trigger height IS the map value — RRF has already applied the
 * probe's G31 Z offset. The raw reply is still shown beside it, and accepting
 * is still a separate act: a probe can land on swarf or fail to trigger
 * cleanly, and that should be visible before it enters the map.
 */
export default function Bed() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.bed", BED_PANEL_DEFAULTS,
		id => (id === "camera" ? app.config.config.camera.pinned : true));
	const store = createHeightMapStore(app.connector);

	const [selected, setSelected] = createSignal<{ row: number; col: number } | null>(null);
	const [probing, setProbing] = createSignal(false);
	const [reply, setReply] = createSignal("");
	const [probed, setProbed] = createSignal<number | null>(null);
	const [message, setMessage] = createSignal("");
	/** Manual nudge step, mm. Matches the babystep control's granularity. */
	const [step, setStep] = createSignal(0.01);

	// Load when the connection is READY, not on mount. Mounting races rr_connect:
	// the download went out before the session existed, came back 401, and the
	// connector reports that as "Invalid password" — which looks like a bad
	// credential rather than a request sent too early. Re-loads on reconnect.
	let loadedWhileConnected = false;
	createEffect(() => {
		const connected = app.om.connection.status === "connected";
		if (!connected) {
			loadedWhileConnected = false;
			return;
		}
		if (loadedWhileConnected) return;
		loadedWhileConnected = true;
		void store.load();
	});

	const cell = () => {
		const sel = selected();
		const map = store.map();
		if (sel === null || map === null) return null;
		return { ...sel, ...cellPosition(map.meta, sel.row, sel.col) };
	};

	const clearProbe = (): void => {
		setProbed(null);
		setReply("");
	};

	const select = (row: number, col: number): void => {
		setSelected({ row, col });
		clearProbe();
		setMessage("");
	};

	const reprobe = async (): Promise<void> => {
		const target = cell();
		if (target === null) return;
		setProbing(true);
		clearProbe();
		setMessage("");
		const code = buildProbeCommand(app.config.config.bed.probePointCommand, target.x, target.y);
		try {
			const text = await app.connector.sendCode(code);
			setReply(text);
			const result = parseProbeReply(text);
			// No trigger height in the reply is a failure to read, not a probe of
			// zero — there is nothing to offer for acceptance.
			if (result === null) setMessage("No trigger height in the reply — nothing to accept.");
			else setProbed(result.triggerHeight);
		} catch (err) {
			setMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setProbing(false);
		}
	};

	/**
	 * Adjust a point by hand, without probing. Sometimes you know a point is
	 * wrong and by how much — a bed clip, a known low spot — and re-probing it
	 * would only re-measure the same obstruction.
	 *
	 * This needs no accept step: unlike a probe, whose value comes from the
	 * machine and may be nonsense, a nudge is already the operator's own
	 * deliberate number. It still lands in the pending overlay, so nothing
	 * reaches the card until Save.
	 */
	const nudge = (delta: number): void => {
		const target = cell();
		if (target === null) return;
		const next = store.valueAt(target.row, target.col) + delta;
		// Keep the file's own precision: the map is written to three decimals, so
		// carrying more here would only be lost on save and confuse the display.
		store.edit(target.row, target.col, Number(next.toFixed(3)));
		clearProbe();
	};

	const accept = (): void => {
		const target = cell();
		const value = probed();
		if (target === null || value === null) return;
		store.edit(target.row, target.col, value);
		clearProbe();
	};

	const save = async (): Promise<void> => {
		const result = await store.save();
		setMessage(result.ok ? "Saved and reloaded (G29 S1)." : result.error);
	};

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="bed">
				<Card id="heightmap" canvas={canvas} ariaLabel="Height map" title="Height map" tip="0:/sys/heightmap.csv">
					<div class="hm-bar">
						<button class="fb-tool" onClick={() => void store.load()}>Reload</button>
						<button class="fb-tool ok" disabled={!store.dirty()} onClick={() => void save()}>
							Save{store.dirty() ? ` (${store.pending().size})` : ""}
						</button>
						<button class="fb-tool" disabled={!store.dirty()} onClick={() => store.discard()}>Discard</button>
						{/* Always present so a message cannot reflow the grid below it. */}
						<span class="hm-msg">{message()}</span>
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
								selected={selected()}
								onSelect={select}
							/>
						)}
					</Show>
				</Card>

				<Card id="probe-point" canvas={canvas} ariaLabel="Probe point" title="Probe point" tip="config: bed.probePointCommand">
					<Show when={cell()} fallback={<p class="job-empty">Select a point on the map.</p>}>
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
				</Card>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
