/**
 * The Shaping screen's eight card bodies.
 *
 * They are all views over ONE service (compose/services.ts `shaping`): the
 * per-tool results store, which tool the screen is looking at, and which
 * capture/candidate row is selected. Nothing here holds state of its own that
 * another card also wants, so two cards cannot disagree about which tool is
 * being tuned — the failure a per-card signal would guarantee on a screen
 * whose whole point is following one measurement from capture to apply.
 *
 * Everything the cards SHOW is derived, never stored twice: a fingerprint is
 * whatever the store parsed, a candidate's numbers are re-scored by the engine
 * against that fingerprint (shaping/results.ts), and every M593 string comes
 * out of `cmd.inputShaping`. No G-code is assembled here.
 *
 * Machine access: none in this file yet. The run controls (task D3) and the
 * macro write (task G2) arrive with their own `createArmed` two-step; a
 * procedure's commands are unreachable from a card by construction
 * (shaping/procedure.ts keeps them in `#`-private fields), so the only route
 * to the machine a card will ever have is a `cmd.*` builder it names itself.
 *
 * Positional stability is the governing constraint: this screen updates while
 * a measurement runs, so every table declares fixed column tracks, every
 * numeric cell is tabular, and a value that can be absent renders an em dash
 * rather than collapsing its row.
 */
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js";
import { cmd } from "../control/commands.ts";
import { copyText } from "../shell/copyText.ts";
import type { CardCtx } from "../compose/ctx.ts";
import type { MacroRead } from "../compose/services.ts";
import { SHAPING_STEPS, stepReadiness, type StepInputs, type StepSpec } from "../shaping/steps.ts";
import { toolMacroPath } from "../shaping/toolMacro.ts";
import type { ShapingConfig } from "../config/types.ts";
import type { Shaping } from "../om/types.ts";
import type { Artefact } from "../shaping/engine/artefact.ts";
import { FIT_DEFAULTS, isMode, type Axis, type Fingerprint, type Mode, type NoFit } from "../shaping/engine/fit.ts";
import { type Candidate, customCandidate } from "../shaping/engine/rank.ts";
import { convolve, type Impulses, type ShaperSpec, zv } from "../shaping/engine/shapers.ts";
import { seconds } from "../shaping/engine/units.ts";
import type { ToolResults } from "../shaping/results.ts";
import type { VerifiedCandidate } from "../shaping/store.ts";
import { DecayChart } from "../charts/DecayChart.tsx";
import { decaySeries, type DecayView } from "../charts/decayData.ts";
import { ACCEL_DIR, accelPath, boardRef, type CaptureRef, captureNameParts } from "../shaping/captures.ts";
import { useEngine } from "../shaping/useEngine.ts";
import type { FitResult } from "../shaping/worker.ts";

/** The one em dash this screen uses for "no value", so every reserved slot
 *  fills with the same glyph and none of them is a different width. */
const NONE = "—";

const hz1 = (v: number): string => `${v.toFixed(1)} Hz`;
const zeta3 = (v: number): string => `ζ ${v.toFixed(3)}`;
const g3 = (v: number): string => `${v.toFixed(3)} g`;
const ms0 = (s: number): string => `${Math.round(s * 1000)} ms`;
const pct0 = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** A residual that an axis never produced (it did not ring) has no percentage. */
const pctOrNone = (fraction: number | undefined): string => (fraction === undefined ? NONE : pct0(fraction));

/**
 * The reasons `fitDecay` declines, in the operator's words. Total over the
 * whole `Mode | NoFit` union so the caller never has to narrow twice — a Mode
 * simply has no reason to give, and the branch that shows this one is the one
 * that already established there is no Mode.
 */
function fitReasonText(fit: Mode | NoFit): string {
	if (isMode(fit)) return NONE;
	switch (fit.reason) {
		case "short-window":
			return "window too short";
		case "below-floor":
			return "no ringing";
		case "short-decay":
			// The verdict box says how nearly it made it; this cell has room
			// only for the rule it missed, and quotes the fitter's own count.
			return `under ${FIT_DEFAULTS.minCycles} cycles`;
		case "damping-out-of-range":
			return "damping out of range";
	}
}

/** How far a tool has got. Derived from the results, so it cannot disagree
 *  with what the other cards show for the same tool. */
function progressOf(r: ToolResults): string {
	if (r.applied !== null) return "applied";
	if (r.verified.length > 0) return "verified";
	if (r.candidates.length > 0) return "ranked";
	if (r.fingerprint !== null) return "measured";
	return "not measured";
}

/** The M593 line a spec becomes — the same builder the machine would be sent. */
const shaperLine = (spec: ShaperSpec): string => cmd.inputShaping(spec);

/** A spec in table-column form: what it is, and its two parameters. */
const specName = (spec: ShaperSpec): string => (spec.type === "custom" ? "custom" : spec.type.toUpperCase());
const specF = (spec: ShaperSpec): string => (spec.type === "custom" ? NONE : `${spec.F.toFixed(1)}`);
const specS = (spec: ShaperSpec): string => (spec.type === "custom" ? NONE : `${spec.S.toFixed(3)}`);

/** One axis of a fingerprint as a single cell: frequency over damping and
 *  peak. Two lines either way — an axis that did not fit reserves the second
 *  line rather than shortening its row below its neighbours'. */
function ModeCell(props: { mode: Mode | null }) {
	return (
		<Show
			when={props.mode}
			fallback={<><span class="shp-mode-f shp-nil">{NONE}</span><span class="shp-sub">not measured</span></>}
		>
			{mode => (
				<>
					<span class="shp-mode-f">{hz1(mode().f)}</span>
					<span class="shp-sub">{zeta3(mode().zeta)} · {g3(mode().peakG)}</span>
				</>
			)}
		</Show>
	);
}

/** The artefacts of a verified candidate, as the con they are. */
function Artefacts(props: { artefacts: readonly Artefact[] }) {
	return (
		<Show
			when={props.artefacts.length > 0}
			fallback={<li class="shp-note shp-pro">no new peaks — the machine gained nothing it did not have</li>}
		>
			<For each={props.artefacts}>
				{a => (
					<li class="shp-note shp-con">
						excites {a.hz.toFixed(0)} Hz on {a.axis} ({g3(a.peakG)}) that the unshaped machine does not
					</li>
				)}
			</For>
		</Show>
	);
}

/* ------------------------------------------------------------------ 1. status */

/** What a tool's tpost macro said, as one always-present line. Every arm is a
 *  sentence: the row's height must not depend on which one it is in. */
function MacroLine(props: { tool: number; read: MacroRead }) {
	return (
		<Switch fallback={<span class="shp-nil">reading {toolMacroPath(props.tool)}…</span>}>
			<Match when={props.read.kind === "line" ? props.read : null}>
				{found => <span class="shp-mono">{found().line}</span>}
			</Match>
			<Match when={props.read.kind === "no-line"}>
				<span class="shp-nil">no M593 line in {toolMacroPath(props.tool)}</span>
			</Match>
			<Match when={props.read.kind === "absent"}>
				<span class="shp-nil">no {toolMacroPath(props.tool)} on the card</span>
			</Match>
			<Match when={props.read.kind === "unreadable"}>
				<span class="shp-warn-inline">could not read {toolMacroPath(props.tool)}</span>
			</Match>
		</Switch>
	);
}

/**
 * Per-tool state of the whole session, what the machine is running right now,
 * and what each step of the workflow is waiting for.
 *
 * Three things are worth saying about the construction.
 *
 * The tool picked here is the tool every other card on the screen is about,
 * which is why the row's identity is a BUTTON rather than a click handler on
 * the `<tr>`: it has to be reachable from a keyboard.
 *
 * `tpost<N>.g` is read only when a row is opened. A four-tool machine would
 * otherwise cost four downloads on mount, against a board whose HTTP server
 * tolerates very few, to fill a line most sessions never look at.
 *
 * The step list REPORTS; it does not decide. Each row's enabled state and its
 * sentence come from one `stepReadiness` call over the planner's own refusal
 * (shaping/steps.ts), and the button calls whichever card offered to carry the
 * step out. There is no verdict invented here and no second implementation of
 * a run — the firmware and the planner are the authorities, and the doing cards
 * own the doing.
 */
export function ShapingStatusBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const tools = createMemo(() => props.ctx.om.om.tools.filter(t => t !== null));
	const shaping = (): Shaping => props.ctx.om.om.move.shaping;
	const selected = (): ToolResults => svc.results();
	// The card file the store could not read outranks a failed action: it is the
	// one that makes everything else on screen wrong.
	const message = (): string => svc.store.error() || svc.problem();

	const inputsFor = (spec: StepSpec): StepInputs => ({
		refusal: svc.gate(),
		offered: svc.offers(spec.step),
		hasFingerprint: selected().fingerprint !== null,
		hasCandidates: selected().candidates.length > 0,
		hasRecommendation: recommendation(selected()) !== null,
		busy: spec.step === "rank" && svc.ranking(),
	});

	return (
		<>
			<p class="shp-active">
				<span class="shp-cap">Running</span>
				<Show
					when={shaping().type !== "none" && shaping().type !== ""}
					fallback={<span class="shp-nil">no shaper configured</span>}
				>
					<span class="shp-mono">
						{shaping().type.toUpperCase()} · F{shaping().frequency.toFixed(1)} · S{shaping().damping.toFixed(3)}
					</span>
				</Show>
			</p>
			{/* ONE message line, always laid out. It was a <Show>, which meant the
			    whole table jumped down the moment anything went wrong — on the
			    card whose job is to be watched while the machine works. Hidden by
			    visibility, so it occupies its row either way. */}
			<p class="shp-msg" classList={{ "shp-msg-on": message() !== "" }}>{message()}</p>
			<table class="shp-table shp-tools">
				<colgroup>
					<col class="shp-c-open" />
					<col class="shp-c-tool" />
					<col class="shp-c-mode" />
					<col class="shp-c-mode" />
					<col class="shp-c-state" />
				</colgroup>
				<thead>
					<tr><th /><th>Tool</th><th>X</th><th>Y</th><th>State</th></tr>
				</thead>
				<tbody>
					<For each={tools()} fallback={<tr><td colspan="5" class="shp-nil">no tools on this machine</td></tr>}>
						{tool => (
							<>
								<tr classList={{ "shp-on": svc.tool() === tool.number }}>
									<td>
										{/* The macro line is a SEPARATE disclosure from selecting the
										    tool: opening it costs a download, and picking a tool must
										    not. */}
										<button
											class="shp-open"
											aria-expanded={svc.macroFor(tool.number).kind !== "closed"}
											aria-label={`Show ${toolMacroPath(tool.number)}`}
											onClick={() => svc.toggleMacro(tool.number)}
										>
											{svc.macroFor(tool.number).kind === "closed" ? "▸" : "▾"}
										</button>
									</td>
									<td>
										<button
											class="shp-pick"
											aria-pressed={svc.tool() === tool.number}
											onClick={() => svc.setTool(tool.number)}
										>
											T{tool.number}
										</button>
									</td>
									<td><ModeCell mode={svc.resultsFor(tool.number).fingerprint?.X ?? null} /></td>
									<td><ModeCell mode={svc.resultsFor(tool.number).fingerprint?.Y ?? null} /></td>
									<td class="shp-state">{progressOf(svc.resultsFor(tool.number))}</td>
								</tr>
								<Show when={svc.macroFor(tool.number).kind !== "closed"}>
									<tr class="shp-macro-row">
										<td />
										<td colspan="4"><MacroLine tool={tool.number} read={svc.macroFor(tool.number)} /></td>
									</tr>
								</Show>
							</>
						)}
					</For>
				</tbody>
			</table>
			<p class="shp-active shp-steps-cap">
				<span class="shp-cap">Steps</span>
				<span class="shp-mono">T{svc.tool()}</span>
			</p>
			<ul class="shp-steps">
				<For each={SHAPING_STEPS}>
					{spec => {
						const ready = createMemo(() => stepReadiness(spec, inputsFor(spec)));
						return (
							<li class="shp-step">
								<button
									class="fb-tool"
									disabled={!ready().enabled}
									onClick={() => svc.runStep(spec.step)}
								>
									{spec.label}
								</button>
								<span class="shp-step-note" classList={{ "shp-step-ready": ready().enabled }}>
									{ready().note}
								</span>
							</li>
						);
					}}
				</For>
			</ul>
		</>
	);
}

/* ----------------------------------------------------------------- 2. capture */

/**
 * What a capture run would do, stated before anything arms it: the box it is
 * allowed to move in, the sensor it will read, and the move it will make.
 *
 * The envelope has no default by design (config/types.ts
 * `envelope-is-config-not-default`) — an unset one is shown as the refusal it
 * is, not filled in from the axis limits.
 */
export function ShapingCaptureBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const cfg = (): ShapingConfig => props.ctx.config.config.shaping;
	const accel = (): string | null => cfg().accelByTool[svc.tool()] ?? null;

	return (
		<>
			<dl class="shp-facts">
				<div class="shp-fact">
					<dt>Envelope</dt>
					<dd>
						<Show when={cfg().envelope} fallback={<span class="shp-warn-inline">not set — Settings › Shaping</span>}>
							{env => (
								<span class="shp-mono">
									X {env().x[0]}–{env().x[1]} · Y {env().y[0]}–{env().y[1]} mm
								</span>
							)}
						</Show>
					</dd>
				</div>
				<div class="shp-fact">
					<dt>Sensor</dt>
					<dd>
						<Show when={accel()} fallback={<span class="shp-warn-inline">T{svc.tool()} has no accelerometer mapped</span>}>
							{addr => <span class="shp-mono">board.device {addr()}</span>}
						</Show>
					</dd>
				</div>
				<div class="shp-fact">
					<dt>Move</dt>
					<dd><span class="shp-mono">{cfg().defaults.distMm} mm at {cfg().defaults.speedMmS} mm/s</span></dd>
				</div>
				<div class="shp-fact">
					<dt>Run</dt>
					<dd>
						<span class="shp-mono">
							{cfg().defaults.repeats} reps × 2 directions × 2 axes · {cfg().defaults.samples} samples
						</span>
					</dd>
				</div>
			</dl>
			<p class="hint">
				Each pass accelerates to speed, holds it, and stops hard; the accelerometer
				records the ring-down that follows. Position and homed state are read from
				the machine immediately before every move.
			</p>
		</>
	);
}

/* ------------------------------------------------------------------- 3. decay */

/** One pickable row: a capture the results file records, or one imported this
 *  session. Both halves are the same shape, so the table has one body. */
type DecayRow = {
	readonly key: string;
	readonly ref: CaptureRef;
	readonly file: string;
	readonly tag: string;
	readonly imported: boolean;
	readonly fit: Mode | NoFit | null;
	readonly problem: string;
};

/** What the card is currently able to draw. A discriminated union rather than
 *  a value plus two booleans: "loading and also failed" must not be sayable. */
type Analysis =
	| { readonly kind: "idle" }
	| { readonly kind: "loading" }
	| { readonly kind: "ok"; readonly result: FitResult }
	| { readonly kind: "failed"; readonly why: string };

/** The chart's key, as fixed rows. Colours live in app.css beside the ones the
 *  chart reads through themeColors, so there is one place per line. */
const DECAY_KEY = [
	{ cls: "shp-key-raw", label: "raw g" },
	{ cls: "shp-key-env", label: "envelope" },
	{ cls: "shp-key-fit", label: "fit" },
	{ cls: "shp-key-stop", label: "stop" },
] as const;

const AXES: readonly Axis[] = ["X", "Y"];

/** What a row with no Mode has to say for itself, in one short cell. An import
 *  the engine has not reached yet says so; one it refused says why. */
function rowReason(row: DecayRow): string {
	if (row.problem !== "") return row.problem;
	if (row.fit === null) return "fitting…";
	return fitReasonText(row.fit);
}

/**
 * One capture at a time: the raw trace, the stop the fitter found in it, the
 * band-passed envelope and the exponential the fit implies — with the numbers
 * beside the curve they were taken from.
 *
 * The import is not a side door, it is the front one. Until the envelope
 * editor exists (#31) this UI cannot run a measurement, so a CSV the operator
 * picks off their own computer is the only way their own machine's ring-down
 * reaches this screen. It needs no envelope, no homing and no motion: a file
 * goes to the same worker every other capture goes to (`parseCapture` →
 * `detectStop` → `fitDecay`) and what appears on screen is what THIS UI
 * computed. Nothing here is copied from the prototype's output, and a file the
 * parser refuses keeps its row and says why, in the engine's own words.
 *
 * Positional stability governs the layout. The plot is built once and fed by
 * `setData`, the facts column reserves every row it can show and fills the
 * absent ones with an em dash, and the verdict sits in a box of fixed height —
 * so switching capture, switching axis, or picking one that does not fit moves
 * nothing. The alternative was a card that jumps every time the operator
 * clicks the next row of a twelve-row list, which is the one gesture this card
 * exists for.
 */
export function ShapingDecayBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");

	const rows = createMemo((): readonly DecayRow[] => [
		...svc.results().captures.map((c): DecayRow => ({
			key: boardRef(c.file).key,
			ref: boardRef(c.file),
			file: c.file,
			tag: `${c.axis}${c.dir}${c.rep}`,
			imported: false,
			fit: c.fit,
			problem: "",
		})),
		...svc.imports().map((c): DecayRow => ({
			key: c.ref.key,
			ref: c.ref,
			file: c.ref.file,
			tag: `${c.axis}${c.dir}${c.rep}`,
			imported: true,
			fit: c.fit,
			problem: c.problem,
		})),
	]);

	const picked = createMemo((): DecayRow | null => rows().find(r => r.key === svc.capturePick()) ?? null);

	/**
	 * Which axis of the picked capture to draw. Set when a row is picked, from
	 * the file name where the name says (`ring1_Yp2.csv` is Y), and switchable
	 * either way afterwards — an operator looking at a capture is entitled to
	 * ask what the OTHER axis did during the same move.
	 *
	 * A plain signal written at pick time rather than an override layered over
	 * a default: the two-value form has a state where the override belongs to
	 * the previously selected capture.
	 */
	const [axis, setAxis] = createSignal<Axis>("X");

	const pick = (row: DecayRow): void => {
		svc.setCapturePick(row.key);
		setAxis(captureNameParts(row.file).axis);
	};

	const [analysis, setAnalysis] = createSignal<Analysis>({ kind: "idle" });

	/**
	 * Load the picked capture and fit it, once per (capture, axis).
	 *
	 * `generation` is what makes a fast click down a list safe: a reply that
	 * arrives after the operator has moved on is discarded rather than painted,
	 * so the chart can never show capture 3's curve under capture 7's heading.
	 * A download and a worker round-trip both take long enough for that
	 * ordering to matter, and neither returns in a guaranteed order.
	 */
	let generation = 0;
	createEffect(() => {
		const row = picked();
		const want = axis();
		const mine = ++generation;
		if (row === null) {
			setAnalysis({ kind: "idle" });
			return;
		}
		setAnalysis({ kind: "loading" });
		void (async () => {
			try {
				const text = await svc.loadCapture(row.ref);
				const result = await useEngine().fit(text, want);
				if (mine === generation) setAnalysis({ kind: "ok", result });
			} catch (err) {
				// The engine's own words for a ParseError (worker.ts `describe`):
				// "has 47 accelerometer overflows — repeat it" is actionable and
				// "could not read the capture" is not.
				if (mine === generation) setAnalysis({ kind: "failed", why: err instanceof Error ? err.message : String(err) });
			}
		})();
	});

	const view = createMemo((): DecayView | null => {
		const a = analysis();
		return a.kind === "ok" ? decaySeries(a.result) : null;
	});

	/** The fit the FACTS column reads: the one the chart was drawn from, never
	 *  the row's stored copy, so the two cannot disagree about the same axis. */
	const shownMode = createMemo((): Mode | null => {
		const a = analysis();
		return a.kind === "ok" && isMode(a.result.fit) ? a.result.fit : null;
	});

	/** The analysed capture itself, for the facts that are about the FILE
	 *  rather than the fit (its sample rate and length). */
	const analysed = createMemo((): FitResult | null => {
		const a = analysis();
		return a.kind === "ok" ? a.result : null;
	});

	/** One sentence, always. Which of the four states the card is in decides
	 *  what it says; that it says exactly one is what keeps the box still. */
	const verdict = createMemo((): string => {
		const a = analysis();
		switch (a.kind) {
			case "idle":
				return "Pick a capture below, or import a CSV from this computer, to see its ring-down.";
			case "loading":
				return "Reading the capture…";
			case "failed":
				return a.why;
			case "ok":
				return view()?.note ?? "";
		}
	});

	const onFiles = (event: Event & { currentTarget: HTMLInputElement }): void => {
		const input = event.currentTarget;
		const files = Array.from(input.files ?? []);
		// Cleared so re-picking the same file fires a change event again — the
		// obvious second gesture after re-running a capture under the same name.
		input.value = "";
		void (async () => {
			let first: string | null = null;
			for (const file of files) {
				const key = svc.addImport(file.name, await file.text());
				first ??= key;
			}
			// Land on the first of a batch rather than the last: a dozen files
			// dropped at once read top-down, and the list is in that order.
			if (first !== null) {
				svc.setCapturePick(first);
				setAxis(captureNameParts(files[0]?.name ?? "").axis);
			}
		})();
	};

	return (
		<>
			<div class="shp-decay-figure">
				<div class="shp-decay-stage">
					<DecayChart view={view} />
					{/* Out of flow, so the message that appears when there is nothing
					    to draw costs no height and its arrival moves nothing. */}
					<Show when={view() === null}>
						<p class="shp-decay-empty">
							<Switch fallback="No capture selected">
								<Match when={analysis().kind === "loading"}>Reading…</Match>
								<Match when={analysis().kind === "failed"}>Nothing to draw</Match>
							</Switch>
						</p>
					</Show>
				</div>
				<div class="shp-decay-side">
					<dl class="shp-facts shp-decay-facts">
						<div class="shp-fact">
							<dt>Frequency</dt>
							<dd><Show when={shownMode()} fallback={<span class="shp-nil">{NONE}</span>}>{m => hz1(m().f)}</Show></dd>
						</div>
						<div class="shp-fact">
							<dt>Damping</dt>
							<dd><Show when={shownMode()} fallback={<span class="shp-nil">{NONE}</span>}>{m => zeta3(m().zeta)}</Show></dd>
						</div>
						<div class="shp-fact">
							<dt>Peak</dt>
							<dd><Show when={shownMode()} fallback={<span class="shp-nil">{NONE}</span>}>{m => g3(m().peakG)}</Show></dd>
						</div>
						<div class="shp-fact">
							<dt>Cycles</dt>
							<dd>
								<Show when={view()?.cycles ?? null} fallback={<span class="shp-nil">{NONE}</span>}>
									{c => <>{c().sustained.toFixed(2)} / {c().needed}</>}
								</Show>
							</dd>
						</div>
						<div class="shp-fact">
							<dt>Capture</dt>
							<dd>
								<Show when={analysed()} fallback={<span class="shp-nil">{NONE}</span>}>
									{r => <>{Math.round(r().rate)} Hz · {r().x.length}</>}
								</Show>
							</dd>
						</div>
					</dl>
					<ul class="shp-key">
						<For each={DECAY_KEY}>
							{item => <li class="shp-key-item" classList={{ [item.cls]: true }}>{item.label}</li>}
						</For>
					</ul>
				</div>
			</div>
			{/* Fixed height, so a two-line verdict and a one-line verdict leave the
			    table in the same place. The full text is on the title for the case
			    where a narrow card cannot show all of it. */}
			<p class="shp-decay-note" title={verdict()}>{verdict()}</p>
			<div class="shp-decay-controls">
				<label class="fb-tool shp-import">
					Import CSV…
					<input type="file" accept=".csv,text/csv" multiple onChange={onFiles} />
				</label>
				<div class="shp-axis-pick" role="group" aria-label="Axis to fit">
					<For each={AXES}>
						{a => (
							<button
								class="shp-pick"
								aria-pressed={axis() === a}
								disabled={picked() === null}
								onClick={() => setAxis(a)}
							>
								{a}
							</button>
						)}
					</For>
				</div>
			</div>
			<div class="shp-scroll">
			<table class="shp-table shp-captures">
				<colgroup>
					<col class="shp-c-file" />
					<col class="shp-c-ax" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
				</colgroup>
				<thead>
					<tr><th>Capture</th><th>Axis</th><th class="shp-num">f</th><th class="shp-num">ζ</th><th class="shp-num">peak</th></tr>
				</thead>
				<tbody>
					<For
						each={rows()}
						fallback={
							<tr>
								<td colspan="5" class="shp-nil">
									No captures for T{svc.tool()}. Import a CSV, or run a measurement to leave one in {ACCEL_DIR}.
								</td>
							</tr>
						}
					>
						{row => (
							<tr classList={{ "shp-on": svc.capturePick() === row.key }}>
								<td>
									<button
										class="shp-pick shp-pick-wide"
										classList={{ "shp-imported": row.imported }}
										aria-pressed={svc.capturePick() === row.key}
										onClick={() => pick(row)}
										title={row.imported ? `${row.file} — imported from this computer` : accelPath(row.file)}
									>
										{row.file}
									</button>
								</td>
								<td class="shp-mono">{row.tag}</td>
								<Show
									when={row.fit !== null && isMode(row.fit) ? row.fit : null}
									fallback={<td class="shp-num shp-nil" colspan="3">{rowReason(row)}</td>}
								>
									{mode => (
										<>
											<td class="shp-num">{mode().f.toFixed(1)}</td>
											<td class="shp-num">{mode().zeta.toFixed(3)}</td>
											<td class="shp-num">{mode().peakG.toFixed(3)}</td>
										</>
									)}
								</Show>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			</div>
		</>
	);
}

/* ------------------------------------------------------------------- 4. sweep */

/** The speed sweep's extent. The heatmap itself is task E2; what a sweep IS
 *  for is worth saying on the card that will hold it. */
export function ShapingSweepBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	return (
		<Show
			when={svc.results().sweep}
			fallback={
				<p class="hint">
					No sweep for T{svc.tool()}. A sweep repeats the same move at a range of
					speeds: a peak that stays at one frequency as the speed rises is forced
					vibration — motor ripple meeting a frame mode — and input shaping cannot
					touch it. A peak that moves with the speed is ringing, which it can.
				</p>
			}
		>
			{sweep => (
				<dl class="shp-facts">
					<div class="shp-fact">
						<dt>Speeds</dt>
						<dd class="shp-mono">
							{sweep().speeds.length} from {Math.min(...sweep().speeds)} to {Math.max(...sweep().speeds)} mm/s
						</dd>
					</div>
					<div class="shp-fact">
						<dt>Band</dt>
						<dd class="shp-mono">0 to {sweep().maxHz.toFixed(0)} Hz in {sweep().freqs.length} bins</dd>
					</div>
					<div class="shp-fact">
						<dt>Full-step line</dt>
						<dd class="shp-mono">
							{Math.min(...sweep().fullStepHz).toFixed(0)} to {Math.max(...sweep().fullStepHz).toFixed(0)} Hz
						</dd>
					</div>
				</dl>
			)}
		</Show>
	);
}

/* -------------------------------------------------------------- 5. candidates */

/**
 * The ranked shapers. Residual is what the impulse model predicts is LEFT of
 * the ring; ±10 % is the same figure with the mode mistuned by a tenth, which
 * is the number that decides whether a shaper survives a tool change.
 */
export function ShapingCandidatesBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const candidates = (): readonly Candidate[] => svc.results().candidates;

	return (
		<Show
			when={candidates().length > 0}
			fallback={
				<p class="hint">
					Nothing ranked for T{svc.tool()}. Ranking scores every RRF shaper over a
					frequency grid against the measured fingerprint and orders them by the
					worst axis with the mode 10 % off — a knife-edge null is not a
					recommendation.
				</p>
			}
		>
			<div class="shp-scroll">
			<table class="shp-table shp-candidates">
				<colgroup>
					<col class="shp-c-shaper" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
				</colgroup>
				<thead>
					<tr>
						<th>Shaper</th>
						<th class="shp-num">F</th>
						<th class="shp-num">S</th>
						<th class="shp-num">X</th>
						<th class="shp-num">Y</th>
						<th class="shp-num">±10%</th>
						<th class="shp-num">ms</th>
					</tr>
				</thead>
				<tbody>
					<For each={candidates()}>
						{(candidate, index) => (
							<tr classList={{ "shp-on": svc.candidateIndex() === index() }}>
								<td>
									<button
										class="shp-pick shp-pick-wide"
										aria-pressed={svc.candidateIndex() === index()}
										onClick={() => svc.setCandidateIndex(index())}
									>
										{specName(candidate.spec)}
									</button>
								</td>
								<td class="shp-num">{specF(candidate.spec)}</td>
								<td class="shp-num">{specS(candidate.spec)}</td>
								<td class="shp-num">{pctOrNone(candidate.residual.X)}</td>
								<td class="shp-num">{pctOrNone(candidate.residual.Y)}</td>
								<td class="shp-num">{pct0(candidate.worstRobust)}</td>
								<td class="shp-num">{Math.round(candidate.durationS * 1000)}</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
			</div>
		</Show>
	);
}

/* ------------------------------------------------------------------ 6. custom */

/** H and T as M593 takes them, derived from an impulse train. */
function customSpecOf(imp: Impulses): Extract<ShaperSpec, { type: "custom" }> {
	return {
		type: "custom",
		H: Array.from(imp.A.subarray(0, imp.A.length - 1)),
		T: Array.from(imp.T.subarray(1)).map(seconds),
	};
}

/**
 * The two-mode custom shaper: ZV on X convolved with ZV on Y, which is the one
 * train that nulls both measured modes exactly. Read-only here — the editable
 * H/T form is task F2 — but the numbers and the M593 line are the real ones,
 * scored by the same engine that ranks the named shapers.
 */
export function ShapingCustomBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");

	/** null when either axis is unmeasured, or when the convolution does not
	 *  make a legal train — a card must not be able to throw its way off screen. */
	const composed = createMemo((): { candidate: Candidate; spec: Extract<ShaperSpec, { type: "custom" }> } | null => {
		const fp: Fingerprint | null = svc.results().fingerprint;
		if (fp === null || fp.X === null || fp.Y === null) return null;
		try {
			const spec = customSpecOf(convolve(zv(fp.X.f, fp.X.zeta), zv(fp.Y.f, fp.Y.zeta)));
			return { candidate: customCandidate(spec, fp), spec };
		} catch {
			return null;
		}
	});

	return (
		<Show
			when={composed()}
			fallback={
				<p class="hint">
					A two-mode custom shaper needs a fitted mode on BOTH axes. Measure T{svc.tool()}
					{" "}first; the composition is ZV on X convolved with ZV on Y, which nulls
					each mode at the cost of a longer train.
				</p>
			}
		>
			{made => (
				<>
					<table class="shp-table shp-impulses">
						<colgroup>
							<col class="shp-c-ix" />
							<col class="shp-c-num" />
							<col class="shp-c-num" />
						</colgroup>
						<thead>
							<tr><th>#</th><th class="shp-num">H</th><th class="shp-num">T ms</th></tr>
						</thead>
						<tbody>
							<For each={made().spec.H}>
								{(amplitude, index) => (
									<tr>
										<td class="shp-mono">{index() + 1}</td>
										<td class="shp-num">{amplitude.toFixed(4)}</td>
										<td class="shp-num">{(made().spec.T[index()]! * 1000).toFixed(2)}</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
					<dl class="shp-facts">
						<div class="shp-fact">
							<dt>Residual</dt>
							<dd class="shp-mono">
								X {pctOrNone(made().candidate.residual.X)} · Y {pctOrNone(made().candidate.residual.Y)}
								{" "}· ±10% {pct0(made().candidate.worstRobust)}
							</dd>
						</div>
						<div class="shp-fact">
							<dt>Duration</dt>
							<dd class="shp-mono">{ms0(made().candidate.durationS)}</dd>
						</div>
					</dl>
					<p class="shp-line">{shaperLine(made().spec)}</p>
				</>
			)}
		</Show>
	);
}

/* ------------------------------------------------------------------ 7. verify */

/**
 * What the machine actually did with each shaper on. `measured` is the
 * post-shaping peak as a fraction of the baseline peak per axis — 0 % means
 * the ring is gone — and it is derived from two fingerprints by
 * `verifyAnalysis`, never asserted (shaping/store.ts `verified-is-a-type`).
 */
export function ShapingVerifyBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const verified = (): readonly VerifiedCandidate[] => svc.results().verified;

	return (
		<Show
			when={verified().length > 0}
			fallback={
				<p class="hint">
					Nothing verified for T{svc.tool()}. A verify run re-measures the ring with
					the shaper switched on: the impulse model cannot see a shaper that excites
					a mode of its own, and one of them does.
				</p>
			}
		>
			<ul class="shp-verified">
				<For each={verified()}>
					{v => (
						<li class="shp-verify">
							<p class="shp-verify-head">
								<span class="shp-mono">{specName(v.spec)} F{specF(v.spec)} S{specS(v.spec)}</span>
								<span class="shp-measured">
									X {pctOrNone(v.measured.X)} · Y {pctOrNone(v.measured.Y)} of baseline
								</span>
							</p>
							<ul class="shp-notes">
								<Artefacts artefacts={v.artefacts} />
							</ul>
						</li>
					)}
				</For>
			</ul>
		</Show>
	);
}

/* ------------------------------------------------------------------- 8. apply */

/** The largest share of the baseline ring left on any axis — the honest
 *  single number for "how well did this actually work". */
const worstMeasured = (v: VerifiedCandidate): number => Math.max(0, ...Object.values(v.measured));

/**
 * The line to put on the machine.
 *
 * A verified candidate that introduced no mode of its own beats anything
 * merely predicted, however good the prediction — that ordering IS the lesson
 * of the 2026-08-22 session, where the model's second-favourite shaper of any
 * type measured 167 % of the unshaped ring. Among those, the one that left
 * least behind, measured; and only with nothing verified at all does the
 * ranking's own top row stand in, labelled as the guess it is.
 */
function recommendation(r: ToolResults): { spec: ShaperSpec; basis: "verified" | "predicted" } | null {
	const clean = r.verified.filter(v => v.artefacts.length === 0);
	if (clean.length > 0) {
		const best = clean.reduce((a, b) => (worstMeasured(b) < worstMeasured(a) ? b : a));
		return { spec: best.spec, basis: "verified" };
	}
	const top = r.candidates[0];
	return top === undefined ? null : { spec: top.spec, basis: "predicted" };
}

export function ShapingApplyBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const [copied, setCopied] = createSignal(false);
	const pick = createMemo(() => recommendation(svc.results()));

	const copy = async (line: string): Promise<void> => {
		setCopied(await copyText(line));
	};

	return (
		<>
			<dl class="shp-facts">
				<div class="shp-fact">
					<dt>Tool</dt>
					<dd class="shp-mono">T{svc.tool()} · 0:/sys/tpost{svc.tool()}.g</dd>
				</div>
				<div class="shp-fact">
					<dt>Basis</dt>
					<dd>
						<Show when={pick()} fallback={<span class="shp-nil">{NONE}</span>}>
							{made => (
								<Show
									when={made().basis === "verified"}
									fallback={<span class="shp-warn-inline">predicted only — not yet measured on the machine</span>}
								>
									<span class="shp-ok-inline">measured on the machine, no new peaks</span>
								</Show>
							)}
						</Show>
					</dd>
				</div>
			</dl>
			<Show
				when={pick()}
				fallback={<p class="hint">Nothing to apply for T{svc.tool()} until a shaper has been ranked or verified.</p>}
			>
				{made => (
					<>
						<p class="shp-line">{shaperLine(made().spec)}</p>
						<div class="shp-actions">
							<button class="fb-tool" onClick={() => void copy(shaperLine(made().spec))}>Copy</button>
							<span class="shp-copied" aria-live="polite">{copied() ? "copied" : ""}</span>
						</div>
					</>
				)}
			</Show>
		</>
	);
}
