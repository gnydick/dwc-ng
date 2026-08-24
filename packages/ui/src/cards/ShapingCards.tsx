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
import { createArmed } from "../control/armed.ts";
import { allDoneAction, armedRunText, batchSummaryText, type CaptureSource, captureSourceLabel, motionStateText, refusalText, runKindText, stepActionText, stepStatusText, sweepStateText, type StepScope } from "../shaping/copy.ts";
import type { CardCtx } from "../compose/ctx.ts";
import type { MacroRead } from "../compose/services.ts";
import { nextStep, SHAPING_STEPS, type ShapingStep, type StepInputs, type StepSpec } from "../shaping/steps.ts";
import { walkThrough } from "../shaping/evidence/walk.ts";
import type { ApplyHow, ApplyIntent } from "../shaping/applyRun.ts";
import { applyStateText, armedApplyText } from "../shaping/copy.ts";
import { inquiryText } from "../shaping/copy.ts";
import type { Evidence } from "../shaping/evidence/evidence.ts";
import type { Caveat } from "../shaping/evidence/caveat.ts";
import { caveatText } from "../shaping/copy.ts";
import { toolMacroPath } from "../shaping/toolMacro.ts";
import type { Envelope, ShapingConfig, ShapingDefaults } from "../config/types.ts";
import type { Shaping } from "../om/types.ts";
import type { Artefact } from "../shaping/engine/artefact.ts";
import { isMode, MIN_CYCLES, type Axis, type Fingerprint, type Mode, type NoFit } from "../shaping/engine/fit.ts";
import { type Candidate, customCandidate } from "../shaping/engine/rank.ts";
import { convolve, type Impulses, SHAPER_TYPES, type ShaperSpec, zv } from "../shaping/engine/shapers.ts";
import { seconds } from "../shaping/engine/units.ts";
import { longestCapture, plannedSegments, type CaptureWindow, type Plan, type PlannedSegment } from "../shaping/procedure.ts";
import { captureNameRange, defaultPrefix, envelopeText, plannedCaptureCount, RUN_KINDS, runOrigin, runPlans, safePrefix, type RunKind, type RunRequest } from "../shaping/runPlan.ts";
import { commitMotionField, MOTION_FIELDS } from "../shaping/motionFields.ts";
import { motionBad, motionBusy, motionProgress } from "../shaping/motionRun.ts";
import { fitCapturesOf, runMotion } from "../shaping/runner.ts";
import { planarPosition, travelAcceleration } from "../shaping/preconditions.ts";
import { mapPoint, mapSummary, mapView, type MapView } from "../charts/mapData.ts";
import { RESULTS_PATH, type ToolResults } from "../shaping/results.ts";
import type { VerifiedCandidate } from "../shaping/store.ts";
import { DecayChart } from "../charts/DecayChart.tsx";
import { SweepHeatmap } from "../charts/SweepHeatmap.tsx";
import { fingerprintMarkers, type SweepMarker } from "../charts/sweepData.ts";
import type { SweepMatrix } from "../shaping/engine/sweep.ts";
import type { FullStep } from "../shaping/fullStep.ts";
import { decaySeries, type DecayView } from "../charts/decayData.ts";
import { ACCEL_DIR, accelPath, boardRef, type CaptureFamily, type CaptureRef, captureNameParts, chosenCaptures, familyView, matchesQuery, MAX_BATCH, resolvePick, type SweepFamily } from "../shaping/captures.ts";
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
			return `under ${MIN_CYCLES} cycles`;
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

/** A shaper in the fewest words that still identify it, for the primary
 *  action's label: the full M593 line neither fits a button nor gets read
 *  there, and the Apply card shows it in full a few centimetres away. */
const shaperShort = (spec: ShaperSpec): string =>
	spec.type === "custom" ? "custom shaper" : `${specName(spec)} ${specF(spec)} Hz`;

/**
 * What limits this card's own reading, in one reserved slot.
 *
 * ONE component for all three cards rather than three copies of the same JSX:
 * duplicating it is the tripwire that says the design is wrong, and the failure
 * mode of three copies is three cards that come to describe the same
 * measurement differently.
 *
 * The slot is present in every state and holds the em dash when there is
 * nothing to say, so a finding arriving never moves the rows under it. Only the
 * FIRST caveat is shown: the full list is the status card's job, and a card
 * that grew by a line per finding would be a card whose height depends on how
 * bad the news is.
 */
function CardCaveat(props: { evidence: Evidence<unknown> }) {
	const first = createMemo((): Caveat | null => {
		const e = props.evidence;
		return e.state === "held" && e.caveats.length > 0 ? e.caveats[0]! : null;
	});
	return (
		<p class="shp-caveat">
			<Show when={first()} fallback={NONE}>
				{c => <span title={caveatText(c())}>{caveatText(c())}</span>}
			</Show>
		</p>
	);
}

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
 * The next-step region and the step list REPORT; they do not decide. One
 * `nextStep` call per render produces every row's enabled state, its sentence,
 * its chip and which step is next — the prominent button holds the very object
 * its row does (shaping/steps.ts,
 * `next-step-comes-from-the-readiness-it-shows`), so the two cannot disagree.
 * Both buttons call whichever card offered to carry the step out. There is no
 * verdict invented here and no second implementation of a run — the firmware
 * and the planner are the authorities, and the doing cards own the doing.
 *
 * Five states, not two, and the pair that matters is `no card` versus `not
 * yet`: a Capture card the operator removed and a Capture card whose run
 * control has not been written are different problems, and one grey button for
 * both is what made a missing feature read as a broken one.
 */
export function ShapingStatusBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const tools = createMemo(() => props.ctx.om.om.tools.filter(t => t !== null));
	const shaping = (): Shaping => props.ctx.om.om.move.shaping;
	const selected = (): ToolResults => svc.results();
	// The card file the store could not read outranks a failed action: it is the
	// one that makes everything else on screen wrong.
	const message = (): string => svc.store.error() || svc.problem();

	const cfg = (): ShapingConfig => props.ctx.config.config.shaping;

	const inputsFor = (spec: StepSpec): StepInputs => ({
		refusal: svc.gate(),
		// Two different facts, and telling them apart is what this card gained:
		// `present` is the operator's composition, `offered` is whether that
		// card has a run control yet.
		present: svc.onScreen(spec.ownerCard),
		offered: svc.offers(spec.step),
		// Anything that MOVES is busy while the machine is moving, whichever
		// card asked it to. One machine, one carriage: a Verify offered while a
		// measure run is mid-pass is not a step that could be taken.
		busy: (spec.step === "rank" && svc.ranking()) || (spec.moves && motionBusy(svc.motion())),
		// The five products, each in whatever state its own machine says. This
		// used to be six booleans, and a boolean made "a fingerprint exists" and
		// "a fingerprint valid for ranking" the same value.
		products: svc.products(),
	});

	// ONE readiness pass per render, for the whole card. The prominent button
	// and the five rows read the same objects out of this — `workflow().next`
	// is reference-identical to its row — so a primary action cannot point at a
	// step the list beside it shows as blocked (shaping/steps.ts,
	// `next-step-comes-from-the-readiness-it-shows`).
	const workflow = createMemo(() => nextStep(inputsFor));

	/** One walk per render, for the same reason there is one readiness pass:
	 *  the list and the highlighted question come out of the same call, so the
	 *  question shown as live cannot be one the list does not contain. */
	const walk = createMemo(() => walkThrough(selected(), svc.products()));

	/**
	 * The walk as a FIXED number of rows.
	 *
	 * The walk itself grows and shrinks — five open questions on a fresh tool,
	 * eight lines once a stage has been done and has findings of its own. This
	 * card is watched while the machine works, so what it renders cannot change
	 * height as answers arrive. Six rows, always:
	 *
	 *   1   the most recent settled fact, or a dash before there is one;
	 *   2-3 the live question with its remedy, which is why it gets two;
	 *   4-6 the questions after it, one line each.
	 *
	 * Presentation only. `walkThrough` stays the whole picture and stays
	 * node-testable; choosing what fits on a card is this component's job.
	 */
	const walkRows = createMemo((): ReadonlyArray<{ kind: string; text: string; full: string; live: boolean }> => {
		const w = walk();
		const settled = w.lines.filter(l => l.kind === "known");
		const last = settled[settled.length - 1];
		const opens = w.lines.filter(l => l.kind === "open");
		const live = w.next;
		const after = opens.filter(l => l !== live).slice(0, 3);
		const rows = [
			{ kind: "known", text: last === undefined ? NONE : last.text, full: last === undefined ? "" : last.text, live: false },
			...(live === null
				? [{ kind: "done", text: "everything this screen can measure has been measured", full: "", live: false }]
				: [{ kind: "open", text: inquiryText(live.inquiry), full: inquiryText(live.inquiry), live: true }]),
			...after.map(l => ({ kind: "open", text: l.inquiry.question, full: inquiryText(l.inquiry), live: false })),
		];
		// Pad to the declared row count so the block's height is the same in
		// every state, including "nothing left to ask".
		while (rows.length < 5) rows.push({ kind: "pad", text: "", full: "", live: false });
		return rows;
	});

	/**
	 * How big the next action is, in the numbers the plan would carry.
	 *
	 * Honest or silent. Measure and Sweep count the captures their run will
	 * ACTUALLY take, by building the very plans the Capture card would arm
	 * (`shaping/runPlan.ts`) and counting them — not by a second arithmetic over
	 * the same settings. Rank counts the shaper table it scores; Verify and Apply
	 * name the shaper they are about.
	 *
	 * With no envelope there are no plans, so both say nothing rather than a
	 * number this screen made up — which is also the state in which the step is
	 * refused, so the button carries the reason instead.
	 */
	const runScope = (req: RunRequest): StepScope => {
		const env = cfg().envelope;
		if (env === null) return { kind: "unknown" };
		const n = plannedCaptureCount(runPlans(req, cfg().defaults, env, defaultPrefix(req.kind, svc.tool())));
		return n > 0 ? { kind: "captures", n } : { kind: "unknown" };
	};

	const scopeFor = (step: ShapingStep): StepScope => {
		switch (step) {
			case "measure":
				return runScope({ kind: "measure" });
			case "sweep":
				return runScope({ kind: "sweep" });
			case "rank":
				return { kind: "shapers", n: SHAPER_TYPES.length };
			case "verify": {
				const pick = selected().candidates[svc.candidateIndex()];
				return pick === undefined ? { kind: "unknown" } : { kind: "shaper", name: shaperShort(pick.spec) };
			}
			case "apply": {
				const made = recommendation(selected());
				return made === null ? { kind: "unknown" } : { kind: "shaper", name: shaperShort(made.spec) };
			}
			default: {
				const unhandled: never = step;
				throw new Error(`unknown shaping step: ${String(unhandled)}`);
			}
		}
	};

	/** The one thing to do, as three values that always come from one place:
	 *  every arm sets all three, so an enabled button with a refusal beside it
	 *  is not expressible here either. */
	const primary = createMemo((): { label: string; note: string; enabled: boolean; step: ShapingStep | null } => {
		const pick = workflow().next;
		if (pick === null) return { ...allDoneAction(svc.tool()), enabled: false, step: null };
		return {
			label: stepActionText(pick.spec, svc.tool(), scopeFor(pick.spec.step)),
			note: pick.readiness.note,
			enabled: pick.readiness.enabled,
			step: pick.spec.step,
		};
	});

	return (
		<>
			{/* The entry point. A fixed slot: a caption, one prominent action and
			    one sentence, present in every state including "nothing left to
			    do", so advancing a step never moves the list under it. */}
			<div class="shp-next">
				<div class="shp-next-row">
					<span class="shp-cap">Next</span>
					<button
						class="fb-tool shp-next-go"
						disabled={!primary().enabled}
						onClick={() => {
							const step = primary().step;
							if (step !== null) svc.runStep(step);
						}}
					>
						{primary().label}
					</button>
				</div>
				{/* The wrapper is not decoration: the sentence has to be a FLEX
				    ITEM with a declared zero width to stay out of this card's
				    min-content WIDTH. Measured — as a plain block it put the
				    column floor at 171 cells against a 156-cell card, i.e. a card
				    you could drag narrower than its own contents. Same
				    construction as .shp-step-note; see app.css for the mechanism. */}
				<div class="shp-next-note">
					<p class="shp-next-why" classList={{ "shp-next-ready": primary().enabled }}>{primary().note}</p>
				</div>
			</div>
			{/* The walk: where this session has got to, and the next question.
			    Replaces the single worst-caveat line, which was a fold over
			    CAVEATS and therefore silent on a machine that had measured
			    nothing — exactly the moment somebody most needs leading.

			    Built from the STAGES first (evidence/walk.ts), so a freshly
			    wiped tool still walks: five open questions with the first one
			    live. Known lines carry their numbers so they can be checked
			    against the card; open lines carry the question and the act that
			    would settle it. */}
			<div class="shp-walk">
				<span class="shp-cap">Means</span>
				<div class="shp-walk-note">
					<ol class="shp-walk-list">
						<For each={walkRows()}>
							{row => (
								<li class="shp-walk-line" data-kind={row.kind} classList={{ "shp-walk-now": row.live }}>
									<span title={row.full}>{row.text}</span>
								</li>
							)}
						</For>
					</ol>
				</div>
			</div>
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
			{/* Iterated over the REGISTRY, not over the workflow's array: the
			    registry is a module constant, so <For> builds these five rows
			    once and every later poll updates text inside them. Keying on the
			    workflow would hand For a new array of new objects on every poll
			    and rebuild all five rows — the one thing this card must not do
			    while a run is being watched. */}
			<ol class="shp-steps">
				<For each={SHAPING_STEPS}>
					{(spec, i) => {
						const state = createMemo(() => workflow().byStep[spec.step]);
						return (
							<li class="shp-step" classList={{ "shp-step-on": state().status === "next" }}>
								<span class="shp-step-n">{i() + 1}</span>
								<button
									class="fb-tool"
									disabled={!state().readiness.enabled}
									onClick={() => svc.runStep(spec.step)}
								>
									{spec.label}
								</button>
								<span class="shp-chip" data-state={state().status}>{stepStatusText(state().status)}</span>
								<span class="shp-step-note" classList={{ "shp-step-ready": state().readiness.enabled }}>
									{state().readiness.note}
								</span>
							</li>
						);
					}}
				</For>
			</ol>
		</>
	);
}

/* ----------------------------------------------------------------- 2. capture */

/**
 * What the two armed controls on this card are about.
 *
 * ONE armed slot for both, and that is the safety property rather than an
 * economy: arming Save disarms Run and vice versa, because `createArmed` holds
 * a single value. A card with two independent arms can sit with both live, and
 * then the next Enter or Space is one of two different things depending on
 * where focus happens to be.
 */
type CaptureArm =
	| { readonly kind: "run"; readonly run: RunKind }
	| { readonly kind: "save"; readonly tool: number };

/**
 * The card that moves the machine.
 *
 * Everything else on this screen reads, fits or draws. This one sends a series
 * of full-speed passes across the bed with nobody's hand on the jog wheel, so
 * the layout is built around one question: can the operator see exactly what
 * will happen before it does?
 *
 *  - the MOTION EDITOR is the same four settings Settings › Input shaping edits,
 *    through the same table and the same gate (shaping/motionFields.ts);
 *  - the MAP draws the polyline `plannedSegments` derives from the very passes
 *    `Procedure` builds its commands from, so it cannot show a different run
 *    from the one an armed confirm would send;
 *  - the RUN control is a `createArmed` two-step whose confirm sentence states
 *    the capture count, the move and the file names, all read off the plan;
 *  - the PROGRESS STRIP reports the run's own events, including the two
 *    failures the capture wait tells apart — a board that finished a capture
 *    and could not write the file, and a board that never captured at all.
 *
 * No G-code is assembled here and none can be. A `Procedure` keeps its commands
 * in `#`-private fields, so this file cannot obtain one to send; the only route
 * to the machine is `Procedure.run`, and its `finally` puts the shaper back
 * whichever way the run ends — finished, failed, or cancelled by the operator.
 *
 * Positional stability governs the layout. Every block declares its height: the
 * two editor rows, the map's stage, the run bar, the progress track and the
 * status box. Nothing appears or disappears while a run is watched — the bar
 * fills in place, the sentence changes inside a box that scrolls rather than
 * grows, and the map redraws only when a SETTING changes, never on a poll. The
 * carriage dot is projected separately from the legs for exactly that reason
 * (charts/mapData.ts `mapPoint`).
 */
export function ShapingCaptureBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const cfg = (): ShapingConfig => props.ctx.config.config.shaping;
	const defaults = (): ShapingDefaults => cfg().defaults;
	const envelope = (): Envelope | null => cfg().envelope;

	const [kind, setKindNow] = createSignal<RunKind>("measure");
	const [armed, setArmed] = createArmed<CaptureArm>();
	const [name, setName] = createSignal<string | null>(null);
	const [fieldNote, setFieldNote] = createSignal("");

	/** The run's name: the operator's, once they have typed one, otherwise the
	 *  tool's default — so switching tool re-labels the run rather than writing
	 *  T1's captures over T0's. */
	const prefix = (): string => name() ?? defaultPrefix(kind(), svc.tool());
	const safeName = (): string => safePrefix(prefix(), defaultPrefix(kind(), svc.tool()));

	/** Changing which run is being set up disarms: the confirm sentence names
	 *  the run, and a confirm left standing across a change would fire a
	 *  different run from the one it described. */
	const setKind = (next: RunKind): void => {
		setArmed(null);
		setKindNow(next);
	};

	/**
	 * The plans one confirm would execute, and the polyline they trace.
	 *
	 * Built from the envelope in CONFIG, which is the same box `Preconditions`
	 * will carry when the confirm re-reads the machine — and `planProcedure`
	 * refuses `stale` if it changed in between, so the drawing and the run
	 * cannot silently be about different boxes.
	 *
	 * The origin is the first plan's own start, NOT the carriage's position.
	 * Deliberate: the polyline then depends only on the settings, so it is
	 * rebuilt when the operator edits one and never on a poll. Where the
	 * carriage actually is is drawn as its own marker, which is the honest
	 * separation — here is the plan, here is you.
	 */
	/**
	 * The run this card would start, as the thing that can actually be planned.
	 *
	 * `kind()` is what the operator picked; a request is that plus whatever the
	 * run needs. Only `verify` needs anything — the shaper to install — and it
	 * takes the Candidates card's selection, which is the same one the Verify
	 * step is about. With nothing ranked there is no verify to request, so this
	 * falls back to the measure the card was already showing rather than
	 * inventing a spec.
	 */
	const request = createMemo((): RunRequest => {
		if (kind() !== "verify") return { kind: kind() === "sweep" ? "sweep" : "measure" };
		const pick = svc.results().candidates[svc.candidateIndex()];
		return pick === undefined ? { kind: "measure" } : { kind: "verify", spec: pick.spec };
	});

	const plans = createMemo((): readonly Plan[] => {
		const env = envelope();
		return env === null ? [] : runPlans(request(), defaults(), env, safeName());
	});

	const segments = createMemo((): readonly PlannedSegment[] => {
		const list = plans();
		const origin = runOrigin(list);
		return origin === null ? [] : plannedSegments(list, origin);
	});

	const view = createMemo((): MapView | null => {
		const env = envelope();
		return env === null ? null : mapView(env, segments());
	});

	/** Where the carriage is, projected through the SAME flip the legs are.
	 *  Null when either axis is not reporting a homed position — an unknown
	 *  position is not a position, and a dot at the origin would be a claim. */
	const carriage = createMemo((): { x: number; y: number } | null => {
		const env = envelope();
		if (env === null) return null;
		const x = planarPosition(props.ctx.om.om, "X");
		const y = planarPosition(props.ctx.om.om, "Y");
		return x === null || y === null ? null : mapPoint(env, { x, y });
	});

	const captureCount = createMemo((): number => plannedCaptureCount(plans()));

	/**
	 * How long the LONGEST pass of this run will record, in seconds.
	 *
	 * The operator used to type a sample count here; the tool derives it now, so
	 * this is what replaces that input — same slot, same row, so the editor does
	 * not change shape. Seconds and not samples, because turning seconds into
	 * M956's S needs the board's M955-reported rate and this card has not asked
	 * for one: the run does, once, before it plans (shaping/runner.ts). Showing a
	 * count derived from an assumed rate would be exactly the silent assumption
	 * the derivation exists to remove.
	 *
	 * The longest rather than each, because a sweep's passes differ by the whole
	 * speed ratio — at 25 mm/s a pass records 8x what it does at 200 — and the
	 * number worth stating before arming is the worst case. Null when the machine
	 * has not reported a travel acceleration, which is also the `no-acceleration`
	 * refusal the confirm would give.
	 */
	const recording = createMemo((): CaptureWindow | null => {
		const list = plans();
		const origin = runOrigin(list);
		return origin === null ? null : longestCapture(list, origin, travelAcceleration(props.ctx.om.om));
	});

	/** The first and last file the run will write — the convention AND the
	 *  extent. Read off the SEGMENTS, which carry the name the M956 will use,
	 *  so this card states file names it did not spell itself. */
	const files = createMemo((): { first: string; last: string } | null =>
		captureNameRange(segments().flatMap(s => (s.kind === "capture" ? [s.file] : []))));

	/**
	 * Why the run control is off, or null when it is live.
	 *
	 * `svc.gate()` is the screen's ONE reading (compose/services.ts) — a fresh
	 * `Preconditions.read` per poll, shared by every control here — so what this
	 * button says and what the status card's step list says about the same
	 * machine come from one place. The two extra conditions are this card's own
	 * and neither is a machine verdict: a run already in flight, and a plan with
	 * nothing in it.
	 */
	const block = createMemo((): string => {
		if (motionBusy(svc.motion())) return "a run is already in flight";
		const refusal = svc.gate();
		if (refusal !== null) return refusalText(refusal);
		if (captureCount() === 0) return refusalText({ kind: "not-measurable" });
		return "";
	});

	const saveable = createMemo((): boolean => {
		const run = svc.runState();
		return run.kind === "fitted" && run.attribution.kind === "machine" && !motionBusy(svc.motion());
	});

	/**
	 * Start the run, or arm it.
	 *
	 * The confirm claims the screen's one motion slot (`beginMotion`) and gets
	 * back the only writer of it plus the signal that cancels it. A second run
	 * cannot start while this one holds the slot — not because a button is
	 * disabled, but because there is no reporter to be had.
	 */
	const go = (): void => {
		const want = kind();
		const now = armed();
		if (now === null || now.kind !== "run" || now.run !== want) {
			setArmed({ kind: "run", run: want });
			return;
		}
		setArmed(null);
		const accel = svc.accelFor(svc.tool());
		if (accel === null) return;
		const slot = svc.beginMotion();
		if (slot === null) return;
		// Read ONCE, here. The completion path below decides what the captures
		// ARE from this value, and a memo re-read after a minute of machine
		// time could have moved on to a different candidate — which would file
		// a verify of one shaper as a verify of another.
		const req = request();
		const baseline = svc.results().fingerprint;
		void (async () => {
			const result = await runMotion(req, {
				conn: props.ctx.connector,
				om: () => props.ctx.om.om,
				cfg,
				accel,
				prefix: safeName(),
				report: slot.report,
				signal: slot.signal,
			});
			// A sweep's captures are one move at many speeds and must NOT be
			// aggregated into a fingerprint — the medians would mix speeds. What a
			// sweep produces is a family on the card, so the listing is re-read
			// and the Sweep card's picker finds it.
			if (result.kind === "sweep") {
				if (result.captures.length > 0) svc.refreshBoard();
				return;
			}
			if (result.captures.length === 0) return;
			const records = await fitCapturesOf(
				result.captures,
				(csv, axis) => useEngine().fit(csv, axis),
				(done, total) => slot.report({ kind: "fitting", run: result.kind, done, total }),
				svc.rememberCapture,
			);
			// Back to the terminal state the run ended in, so the sentence under
			// the bar is the run's outcome and not a stale "fitting 12 of 12".
			slot.report({
				kind: "ended",
				run: result.kind,
				outcome: result.outcome,
				captured: result.captures.length,
				expected: result.captures.length,
				touched: result.touched,
				restored: result.restored,
			});
			// What these captures ARE, decided from the request that produced
			// them rather than from anything read afterwards. A verify run
			// measured the machine WITH a shaper on, so its fingerprint must
			// never reach `setMeasurement` — `BatchPurpose` is what makes that
			// unrepresentable rather than merely avoided here.
			svc.setFitted(
				records,
				req.kind === "verify" && baseline !== null
					? { kind: "verify", spec: req.spec, baseline }
					: { kind: "baseline" },
			);
			svc.refreshBoard();
		})();
	};

	/**
	 * Write what the run measured against the tool it was run for.
	 *
	 * No tool picker, unlike the Decay card's save bar, and that is the safer
	 * shape here rather than a shortcut: the run addressed `accelByTool[tool()]`
	 * — this tool's own sensor — so the head these captures belong to is not a
	 * choice anybody has to make. The Decay card offers the picker because a
	 * batch there can be any twelve files off the card.
	 */
	const save = (): void => {
		const tool = svc.tool();
		const now = armed();
		if (now === null || now.kind !== "save" || now.tool !== tool) {
			setArmed({ kind: "save", tool });
			return;
		}
		setArmed(null);
		// Two writers, and which one is not a choice made here: the batch says
		// what it is. A verify batch has no route to `saveMeasurement` and a
		// baseline has none to `saveVerified` (compose/services.ts,
		// `a-shaped-fingerprint-cannot-become-a-baseline`).
		const run = svc.runState();
		if (run.kind === "fitted" && run.purpose.kind === "verify") void svc.saveVerified(tool);
		else void svc.saveMeasurement(tool);
	};

	// The status card's step list does not run anything itself: it calls the
	// owning card's handler, which here ARMS this control. Two clicks either
	// way, and the second one is on the card showing the map — the status card
	// can never be the surface that starts a move.
	svc.offer("measure", () => {
		setKind("measure");
		setArmed({ kind: "run", run: "measure" });
	});
	svc.offer("sweep", () => {
		setKind("sweep");
		setArmed({ kind: "run", run: "sweep" });
	});
	// Verify is not a run the operator configures — it is "re-measure with THAT
	// shaper on", and which shaper comes from the Candidates selection. Same
	// two-press arming as the others, and the second press is still on this
	// card, which is the one showing the map the carriage will follow.
	svc.offer("verify", () => {
		setKind("verify");
		setArmed({ kind: "run", run: "verify" });
	});

	/**
	 * The one sentence under the bar.
	 *
	 * Precedence, and each step of it is a different question: what is about to
	 * happen if you press again (armed), what is happening (a run), why you
	 * cannot start one (the gate), and what this card is for (idle). Every arm
	 * comes out of the one copy table, so nothing here writes a sentence of its
	 * own.
	 */
	const note = createMemo((): string => {
		const arm = armed();
		if (arm !== null && arm.kind === "save") {
			return `Confirm: write T${arm.tool}'s fingerprint to ${RESULTS_PATH(arm.tool)}. Escape cancels.`;
		}
		if (arm !== null) {
			const range = files();
			return armedRunText(
				arm.run,
				captureCount(),
				defaults().distMm,
				defaults().speedMmS,
				range?.first ?? "—",
				range?.last ?? "—",
			);
		}
		const state = svc.motion();
		if (state.kind === "idle" && block() !== "") return `Cannot run — ${block()}.`;
		return motionStateText(state);
	});

	const bad = (): boolean => motionBad(svc.motion()) || (svc.motion().kind === "idle" && block() !== "");

	return (
		<>
			<dl class="shp-facts">
				<div class="shp-fact">
					<dt>Envelope</dt>
					<dd>
						<Show when={envelope()} fallback={<span class="shp-warn-inline">not set — Settings › Input shaping</span>}>
							{env => <span class="shp-mono">{envelopeText(env())}</span>}
						</Show>
					</dd>
				</div>
				<div class="shp-fact">
					<dt>Sensor</dt>
					<dd>
						<Show
							when={cfg().accelByTool[svc.tool()]}
							fallback={<span class="shp-warn-inline">T{svc.tool()} has no accelerometer mapped</span>}
						>
							{addr => <span class="shp-mono">board.device {addr()}</span>}
						</Show>
					</dd>
				</div>
			</dl>

			{/* The four numbers a run is made of, through the SAME table and the
			    same gate Settings edits them with (shaping/motionFields.ts). Edited
			    here because this is where the map of the run is: changing the
			    distance and watching the cross grow is the gesture, and sending
			    the operator to another screen for it would break it. */}
			<div class="shp-run-fields">
				<span class="shp-cap">Move</span>
				<For each={MOTION_FIELDS}>
					{field => (
						<label class="shp-run-field">
							<input
								type="number"
								class="shp-run-num"
								step={field.step}
								aria-label={field.label}
								value={field.read(defaults())}
								onChange={e => {
									setArmed(null);
									const result = commitMotionField(
										field,
										Number(e.currentTarget.value),
										patch => { props.ctx.config.setShaping({ defaults: patch }); },
										() => props.ctx.config.config.shaping.defaults,
									);
									e.currentTarget.value = String(result.kept);
									setFieldNote(result.note);
								}}
							/>
							<span class="shp-run-unit">{field.short}</span>
						</label>
					)}
				</For>
				{/* Reads, never edits, and takes the slot the Samples input used to
				    — so the row keeps its geometry: one fixed-width tabular number
				    and the word for what it is, at every value including "—". A
				    <div> and not a <label>, because there is no control here to
				    label, and not an <output>, whose implicit live region would
				    announce this on every keystroke in the fields beside it. */}
				<div class="shp-run-field" title="How long the longest pass of this run records">
					<span class="shp-run-num shp-run-fact">
						{/* The fragment is load-bearing. `<Show>` runs its callback once
						    per truthiness change, so a callback that RETURNED a string
						    would compute it once and never again — the figure froze at
						    whatever the first plan said, which is worse than no figure.
						    Inside JSX the expression is compiled into a reactive one and
						    tracks `w()`. Caught in Edge, 2026-08-23: switching Measure to
						    Sweep left 1.05 s on screen for a run whose slowest pass
						    records 3.13 s. */}
						<Show when={recording()} fallback="—">{w => <>{w().captureS.toFixed(2)}</>}</Show>
					</span>
					<span class="shp-run-unit">s/pass</span>
				</div>
			</div>

			<div class="shp-run-fields">
				<span class="shp-cap">Run</span>
				<div class="shp-tool-pick" role="group" aria-label="Which run">
					<For each={RUN_KINDS}>
						{k => (
							<button
								class="shp-pick shp-run-chip"
								aria-pressed={kind() === k}
								onClick={() => setKind(k)}
							>
								{runKindText(k)}
							</button>
						)}
					</For>
				</div>
				<input
					type="text"
					class="fb-input shp-run-name"
					aria-label="Name for this run"
					placeholder={defaultPrefix(kind(), svc.tool())}
					value={prefix()}
					onInput={e => { setArmed(null); setName(e.currentTarget.value); }}
				/>
				<span class="shp-run-count">{captureCount()} captures</span>
			</div>

			{/* The stage declares the drawing's box, so the map never sizes the
			    card and the card never has to be resized when a plan changes. */}
			<div class="shp-map-stage">
				<Show
					when={view()}
					fallback={<p class="shp-map-empty">Draw the motion envelope in Settings › Input shaping — nothing may move until you do.</p>}
				>
					{v => (
						<svg class="shp-map" viewBox={v().viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Planned moves inside the envelope">
							<rect
								class="shp-map-box"
								x={v().box.x}
								y={v().box.y}
								width={v().box.w}
								height={v().box.h}
								stroke-width={v().stroke}
							/>
							<For each={v().legs}>
								{leg => (
									<line
										class={leg.measured ? "shp-map-leg" : "shp-map-travel"}
										x1={leg.x1}
										y1={leg.y1}
										x2={leg.x2}
										y2={leg.y2}
										stroke-width={leg.measured ? v().stroke * 2 : v().stroke}
										stroke-dasharray={leg.measured ? undefined : `${v().marker / 2} ${v().marker / 2}`}
									>
										<title>{leg.label}</title>
									</line>
								)}
							</For>
							{/* The carriage, in its own element and its own memo: it moves
							    on every poll and the legs do not, so redrawing the polyline
							    to move a dot is exactly what this card must not do. */}
							<Show when={carriage()}>
								{here => (
									<circle class="shp-map-here" cx={here().x} cy={here().y} r={v().marker / 2} stroke-width={v().stroke}>
										<title>carriage</title>
									</circle>
								)}
							</Show>
						</svg>
					)}
				</Show>
			</div>
			<p class="shp-map-cap">
				<span>{mapSummary(segments())}</span>
				<span class="shp-mono">{files() === null ? NONE : `${files()!.first} … ${files()!.last}`}</span>
			</p>

			<div class="shp-run-bar">
				<button
					class="fb-tool shp-run-go"
					classList={{ "shp-arming": armed()?.kind === "run" }}
					disabled={block() !== ""}
					onClick={go}
					title={block()}
				>
					{armed()?.kind === "run" ? "Confirm" : `${runKindText(kind())} T${svc.tool()} — ${captureCount()}`}
				</button>
				{/* Always present, only sometimes live: a Cancel that appeared with
				    the run would move the bar under it at the moment the machine
				    started moving. */}
				<button
					class="fb-tool shp-run-stop"
					disabled={!motionBusy(svc.motion())}
					onClick={() => svc.cancelMotion()}
				>
					Cancel
				</button>
				<button
					class="fb-tool shp-run-save"
					classList={{ "shp-arming": armed()?.kind === "save" }}
					disabled={!saveable()}
					onClick={save}
				>
					{armed()?.kind === "save" ? "Confirm" : `Save to T${svc.tool()}`}
				</button>
			</div>

			{/* The bar's track is always drawn and always the same height; only the
			    fill's width changes. A percentage, not a length in u — it is a
			    fraction of its own track, so it follows the scale for free. */}
			<div class="shp-run-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(motionProgress(svc.motion()).fraction * 100)}>
				<div class="shp-run-fill" style={{ width: `${motionProgress(svc.motion()).fraction * 100}%` }} />
			</div>
			{/* Fixed height and it SCROLLS rather than growing. A failure sentence
			    from the run can be long — it names the file that never appeared and
			    the directory it was not in — and truncating it would throw away the
			    half that says which of the two things went wrong. */}
			<p class="shp-run-note" role="status" classList={{ "shp-warn-inline": bad() }}>
				{note()}
				<Show when={fieldNote() !== ""}>{n => <span class="shp-warn-inline"> {n()}</span>}</Show>
			</p>
		</>
	);
}

/* ------------------------------------------------------------------- 3. decay */

/** One pickable row, whichever of the three places it came from. The table has
 *  one body, so the three sources cannot lay out differently. */
type DecayRow = {
	readonly key: string;
	readonly ref: CaptureRef;
	readonly file: string;
	readonly tag: string;
	readonly origin: DecaySource;
	readonly when: string;
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

/**
 * Which set of captures the list is showing.
 *
 * Three, and they are genuinely three different collections rather than one
 * list with tags: what this tool's results file records, what the board's SD
 * card holds, and what the operator dragged in this session. All three can be
 * ticked and fitted — where a capture's bytes come from is the loader's
 * business, and it answers for all three. What only the first two can do is be
 * SAVED against a tool; see `BatchAttribution`.
 */
type DecaySource = CaptureSource;

const SOURCES: readonly DecaySource[] = ["tool", "board", "imported"];

/** The chart's key, as fixed rows. Colours live in app.css beside the ones the
 *  chart reads through themeColors, so there is one place per line. */
const DECAY_KEY = [
	{ cls: "shp-key-raw", label: "raw g" },
	{ cls: "shp-key-ring", label: "ring" },
	{ cls: "shp-key-env", label: "fitted ζ" },
	{ cls: "shp-key-stop", label: "stop" },
] as const;

const AXES: readonly Axis[] = ["X", "Y"];

/**
 * At most this many NAMED families are offered as one-click filters. The
 * residual bucket sits beside them in a place of its own, so the row holds
 * four buttons and always the same four.
 *
 * Three, and the number is a MEASUREMENT rather than a taste: every control on
 * the filter row is a declared width, so the row's contribution to the card's
 * minimum width is arithmetic — 22u of input, 19u per named chip, 16u for the
 * residual, 16u of Rescan and 2u per gap, which is 121u, just inside the 123u
 * the captures table already asks for. The table therefore stays the widest
 * thing on the card and the chip row costs nothing.
 *
 * The residual took the place of the old `N of M` readout rather than being
 * added beside it, and that is what kept the arithmetic where it was — a
 * fourth NAMED chip would put the row at 140u and make it, absurdly, the
 * card's minimum width. Neither number went missing: M is on the source chip
 * (`Board (276)`) and N is on the Select button under the table, which reads
 * `Select 276` because that is exactly what it would select.
 */
const PREFIX_CHIPS = 3;

/** `2026-08-23T09:14:02` as the day and time a person reads. Total over a
 *  transport that gives no date, which is the case for every row that did not
 *  come off the board. */
function shortWhen(date: string | undefined): string {
	if (date === undefined || date === "") return NONE;
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(date);
	return m === null ? date.slice(0, 16) : `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/** What a row with no Mode has to say for itself, in one short cell. A capture
 *  nobody has fitted yet says so rather than pretending — except an import,
 *  which is fitted the moment it arrives, so a blank one is still in flight. */
function rowReason(row: DecayRow): string {
	if (row.problem !== "") return row.problem;
	if (row.fit === null) return row.origin === "imported" ? "fitting…" : "not fitted";
	return fitReasonText(row.fit);
}

/**
 * One capture at a time: the raw trace, the stop the fitter found in it, the
 * band-limited ring the fit was taken over and the fitted envelope laid over
 * it — with the numbers beside the curve they were taken from.
 *
 * Three places a capture can come from, and the difference between them is not
 * cosmetic.
 *
 *  - The TOOL's results file, which names captures a previous session fitted.
 *  - The BOARD's own `0:/sys/accelerometer`, written by `M956`. Gabe's machine
 *    holds 276 of these going back to May; until a results file exists nothing
 *    names any of them, so the directory listing is the only way in. These are
 *    that machine's captures, in the canonical place, which is why they and
 *    only they can be attributed to a tool.
 *  - IMPORTED CSVs off the operator's own computer. Those are drawn and never
 *    attributed: a file from another machine or another day recorded as this
 *    tool's data would make its next fingerprint a mixture of two machines.
 *
 * Everything reaches the engine by one route whatever its origin — the cached
 * loader (shaping/captures.ts) then the worker's `parseCapture` → `detectStop`
 * → `fitDecay`. Nothing on this card is copied from anywhere; every number is
 * one this UI computed from those bytes.
 *
 * Positional stability governs the layout. The plot is built once and fed by
 * `setData`, the facts column reserves every row it can show, the verdict and
 * the batch report sit in boxes of fixed height, and the filter and batch rows
 * are present whichever source is showing rather than appearing with it — so
 * switching source, switching capture, switching axis, or picking one that
 * does not fit moves nothing. The alternative was a card that jumps every time
 * the operator clicks the next row of a 276-row list, which is the one gesture
 * this card exists for.
 */
export function ShapingDecayBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const [source, setSourceNow] = createSignal<DecaySource>("tool");
	const [query, setQuery] = createSignal("");
	/** The lit chip's key, separate from the text filter because the two ask
	 *  different questions: the query narrows the listing, the chip picks one
	 *  bucket of what is left. What is LIT comes back from `familyView`, not
	 *  from here — a key naming no bucket reads as nothing lit. */
	const [family, setFamily] = createSignal<string | null>(null);
	const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set<string>());
	const [target, setTarget] = createSignal<number | null>(null);
	const [armed, setArmed] = createArmed<number>();

	/** Switching TO the board is the act that asks for the listing — never a
	 *  render, and never on mount. 276 entries is several `rr_filelist` pages
	 *  against a server that tolerates very few requests. */
	const setSource = (next: DecaySource): void => {
		setSourceNow(next);
		if (next === "board") svc.wantBoard();
	};

	/**
	 * Every fit this SESSION has taken, by file name — not just the current
	 * batch's.
	 *
	 * It reads the service's cache rather than `runState`, and that is the whole
	 * fix for "the data is lost when you change the filter" (Gabe, 2026-08-23).
	 * `clearRun` fires on every selection change, correctly — a summary reading
	 * "fitted 12 of 12" beside a changed set of ticks is a stale claim — but the
	 * NUMBERS are not a claim about the selection. A fit is a pure function of a
	 * file's bytes, so a row shows its frequency if this session has ever fitted
	 * that file, whichever chip is lit.
	 */
	const batchFits = (): ReadonlyMap<string, Mode | NoFit> => svc.fits();

	const allRows = createMemo((): readonly DecayRow[] => {
		switch (source()) {
			case "tool":
				return svc.results().captures.map((c): DecayRow => {
					const ref = boardRef(c.file);
					return {
						key: ref.key,
						ref,
						file: c.file,
						tag: `${c.axis}${c.dir}${c.rep}`,
						origin: "tool",
						when: NONE,
						// THIS session's fit wins over the stored one. #33 replaced the
						// estimator on 2026-08-23, so what a results file records may
						// have been computed by a fitter that no longer exists; re-fit a
						// tool row and the row shows the number the app would write, not
						// the one it is about to replace.
						fit: batchFits().get(ref.key) ?? c.fit,
						problem: "",
					};
				});
			case "board":
				return svc.board().map((entry): DecayRow => {
					const parts = captureNameParts(entry.name);
					const ref = boardRef(entry.name);
					return {
						key: ref.key,
						ref,
						file: entry.name,
						tag: parts.matched ? `${parts.axis}${parts.dir}${parts.rep}` : NONE,
						origin: "board",
						when: shortWhen(entry.date),
						fit: batchFits().get(ref.key) ?? null,
						problem: "",
					};
				});
			case "imported":
				return svc.imports().map((c): DecayRow => ({
					key: c.ref.key,
					ref: c.ref,
					file: c.ref.file,
					tag: `${c.axis}${c.dir}${c.rep}`,
					origin: "imported",
					when: NONE,
					fit: batchFits().get(c.ref.key) ?? c.fit,
					problem: c.problem,
				}));
		}
	});

	/** What the text filter admits. The chips partition THIS rather than the
	 *  whole listing, so a chip's number is true while a query is typed too. */
	const queried = createMemo((): readonly DecayRow[] => allRows().filter(r => matchesQuery(r.file, query())));

	/**
	 * The chip row and the rows under it, from ONE call.
	 *
	 * `familyView` returns buckets that HOLD their rows, and `shown` is one of
	 * those very arrays — so the number on a chip is the length of the list
	 * clicking it produces, and the buckets sum to `queried()`. That is the
	 * whole fix for "each crumb button filter presents too small numbers so
	 * they don't sum to 259" (Gabe, 2026-08-23): the label and the action used
	 * to be two expressions, and the `ring1_` chip said 60 while producing 12.
	 */
	const browse = createMemo(() => familyView(queried(), PREFIX_CHIPS, family()));

	/**
	 * The chip row, always the same four buttons.
	 *
	 * Padded with empty slots because the number of families depends on the
	 * source — the board has three, the tool's twelve captures have one — and a
	 * row that gains and loses buttons moves the search box beside it every time
	 * the operator changes source. Measured: the input went 192px to 352px and
	 * two chips slid 160px sideways.
	 *
	 * The residual is NOT one of these slots; it has its own fixed place at the
	 * end of the row, so it never moves when a source has fewer families.
	 */
	const chipSlots = createMemo((): ReadonlyArray<CaptureFamily<DecayRow> | null> => {
		const found = browse().families;
		return Array.from({ length: PREFIX_CHIPS }, (_, i) => found[i] ?? null);
	});

	const rows = (): readonly DecayRow[] => browse().shown;

	const counts = createMemo(() => ({
		tool: svc.results().captures.length,
		board: svc.board().length,
		imported: svc.imports().length,
	}));

	/**
	 * The capture the chart is drawing — resolved against the UNFILTERED list.
	 *
	 * The filter and the family chips exist to FIND a row; they do not decide
	 * what is on screen. Resolving against `rows()` meant that clicking a chip
	 * that excluded the picked capture blanked the chart and every number beside
	 * it, even though the selection itself was intact (Gabe, 2026-08-23). A
	 * capture the operator deliberately picked stays drawn until they pick
	 * another one.
	 *
	 * Still scoped to the current SOURCE, and deliberately: the three sources
	 * are three different collections rather than one list with tags, and the
	 * key already carries which — a `board:` key cannot resolve inside the
	 * imported list, so a source switch is a genuine change of what there is to
	 * pick from rather than a filter over it.
	 */
	const resolved = createMemo(() => resolvePick(allRows(), rows(), svc.capturePick()));
	const picked = (): DecayRow | null => resolved().picked;
	/** True when the drawn capture is not among the rows the filter is showing.
	 *  One line says so, rather than leaving a chart with no highlighted row and
	 *  no reason for it. */
	const pickedHidden = (): boolean => resolved().hidden;

	/**
	 * Which axis of the picked capture to draw. Set when a row is picked, from
	 * the file name where the name says (`ring1_Yp2.csv` is Y), and switchable
	 * either way afterwards — an operator looking at a capture is entitled to
	 * ask what the OTHER axis did during the same move.
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
			case "ok": {
				const note = view()?.note ?? "";
				// The one case where the chart and the list disagree about what is
				// interesting. Appended rather than replacing the fit's own verdict:
				// the numbers are still the point, this is why no row is lit.
				return pickedHidden() ? `${note} (${picked()?.file ?? ""} is hidden by the filter.)` : note;
			}
		}
	});

	/* --------------------------------------------------------- selection */

	/**
	 * The captures the tick boxes name.
	 *
	 * Origin is not consulted, here or on the checkbox. A row's origin decides
	 * where its BYTES come from, and the loader answers that for all three: a
	 * tool row and a board row name the same file in `0:/sys/accelerometer` and
	 * download identically, and an import is already in memory. Gating
	 * selection on it left twelve visible tool rows with no checkbox beside a
	 * button reading "Fit 0" (Gabe, 2026-08-23) — and no way in the app to
	 * re-fit a `tool<N>.json` written by the estimator #33 replaced.
	 *
	 * Whether the result may be SAVED against a tool is the other question, and
	 * it is answered where it belongs: `BatchAttribution`, from the refs.
	 *
	 * Keyed by `key`, not by file name: two imports can be called
	 * `ring1_Xp0.csv` and a tick on one must not fit the other.
	 */
	const chosen = createMemo((): readonly CaptureRef[] => chosenCaptures(rows(), selected()));

	const toggle = (key: string): void => {
		setSelected(prev => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
		svc.clearRun();
	};
	const selectShown = (): void => {
		setSelected(new Set(rows().map(r => r.key)));
		svc.clearRun();
	};
	const clearSelection = (): void => {
		setSelected(new Set<string>());
		svc.clearRun();
	};

	const tools = createMemo(() => props.ctx.om.om.tools.filter(t => t !== null));
	/**
	 * A fit that may be WRITTEN — not merely one that exists.
	 *
	 * The Save button reads this, so the one state that has to be told apart is
	 * "fitted, and these were this machine's own captures". An imported batch
	 * fits and draws like any other and simply has nothing to attribute, which
	 * the batch line says in words beside the greyed button.
	 */
	const attributable = createMemo(() => {
		const run = svc.runState();
		return run.kind === "fitted" && run.attribution.kind === "machine" ? run : null;
	});

	/**
	 * What the batch is doing, in one line that is always present.
	 *
	 * The "n of m contributed" is the load-bearing part. `aggregate` takes the
	 * median of the fits that SUCCEEDED, so a capture the fitter declined —
	 * `ring1_Xp1.csv` is one, and the reason is GitHub #33's to settle — is
	 * absent from the numbers and present in the file. A fingerprint built from
	 * 11 of 12 and one built from 12 of 12 look identical unless the card says
	 * which it is.
	 */
	const batchReport = createMemo((): string => {
		const run = svc.runState();
		switch (run.kind) {
			case "idle":
				return rows().length > MAX_BATCH
					? `${rows().length} captures shown. Filter to one measurement run — at most ${MAX_BATCH} — before selecting: a fingerprint is the median of one session, not of everything the card has ever held.`
					: "Tick the captures of one measurement run, fit them, and write the fingerprint to a tool.";
			case "running":
				return `Fitting ${run.done + 1} of ${run.total}: ${run.file}`;
			case "fitted":
				// The attribution's sentence is APPENDED to the numbers rather than
				// replacing them: an imported batch still fitted, and its medians are
				// the point of looking at it. What it cannot do is be written.
				return run.attribution.kind === "machine"
					? batchSummaryText(run.contributed, run.total, run.fingerprint)
					: `${batchSummaryText(run.contributed, run.total, run.fingerprint)} ${run.attribution.why}`;
			case "saving":
				return `Writing ${RESULTS_PATH(run.tool)}…`;
			case "saved":
				return `Saved to ${RESULTS_PATH(run.tool)}: T${run.tool}'s fingerprint, from ${run.contributed} of ${run.total} captures.`;
			case "failed":
				return run.why;
		}
	});

	/**
	 * The armed tool, WRAPPED — because T0 is a number and `<Show when={0}>` is
	 * a fallback.
	 *
	 * The button read "Confirm" while the line under it went on showing the
	 * batch report, for the default tool and no other: `armed()` of 0 is falsy,
	 * so the confirm sentence — the one that names the file about to be written
	 * — never appeared for T0. An object is truthy whatever number it carries.
	 */
	const arming = createMemo((): { tool: number } | null => {
		const tool = armed();
		return tool === null ? null : { tool };
	});

	const saveLabel = createMemo((): string => {
		const tool = target();
		if (arming() !== null) return "Confirm";
		return tool === null ? "Save…" : `Save to T${tool}`;
	});

	const save = (): void => {
		const tool = target();
		if (tool === null) return;
		if (armed() === tool) {
			setArmed(null);
			void svc.saveMeasurement(tool);
			return;
		}
		setArmed(tool);
	};

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
				setSource("imported");
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
				<div class="shp-src-pick" role="group" aria-label="Capture source">
					<For each={SOURCES}>
						{s => (
							<button
								class="shp-pick shp-src"
								aria-pressed={source() === s}
								aria-label={`${captureSourceLabel(s, svc.tool())}: ${counts()[s]} captures`}
								onClick={() => setSource(s)}
							>
								{/* Parenthesised, because on a Duet a bare "Board 259" reads as CAN
								    address 259 and "T0 12" as twelve of something. The number is a
								    count of captures. The tool source names its tool, so a row
								    under it is attributable to a head by looking. */}
								{captureSourceLabel(s, svc.tool())} <span class="shp-src-n">({counts()[s]})</span>
							</button>
						)}
					</For>
				</div>
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
			{/* Always present, whichever source is showing: 276 files need it, and a
			    row that appears with the board would move the table under it. */}
			<div class="shp-decay-filter">
				<input
					class="fb-input grow"
					type="search"
					placeholder="filter by name"
					aria-label="Filter captures by name"
					value={query()}
					onInput={e => setQuery(e.currentTarget.value)}
				/>
				<For each={chipSlots()}>
					{slot => (
						<Show
							when={slot}
							fallback={<button class="shp-pick shp-prefix" disabled aria-hidden="true" tabindex="-1" />}
						>
							{p => (
								<button
									class="shp-pick shp-prefix"
									aria-pressed={browse().lit === p().key}
									aria-label={`${p().label}: ${p().rows.length} captures`}
									onClick={() => setFamily(browse().lit === p().key ? null : p().key)}
									title={`${p().rows.length} captures whose name starts ${p().label}`}
								>
									<span class="shp-prefix-name">{p().label}</span>
									{/* The number IS the bucket's length — same array the click
									    renders — so it cannot describe a different set. */}
									<span class="shp-prefix-n">{p().rows.length}</span>
								</button>
							)}
						</Show>
					)}
				</For>
				{/* Everything the named families did not take, in the place the old
				    "N of M" readout held. Without it 118 of Gabe's 259 files were in
				    no bucket and nothing said so; with it the four numbers sum to the
				    listing, which is how an operator sees that nothing is hidden. */}
				<Show
					when={browse().rest}
					fallback={<button class="shp-pick shp-prefix shp-rest" disabled aria-hidden="true" tabindex="-1" />}
				>
					{r => (
						<button
							class="shp-pick shp-prefix shp-rest"
							aria-pressed={browse().lit === r().key}
							aria-label={`Everything else: ${r().rows.length} captures`}
							onClick={() => setFamily(browse().lit === r().key ? null : r().key)}
							title={`${r().rows.length} captures in no family the row names`}
						>
							<span class="shp-prefix-name">{r().label}</span>
							<span class="shp-prefix-n">{r().rows.length}</span>
						</button>
					)}
				</Show>
				<button
					class="fb-tool shp-rescan"
					disabled={source() !== "board"}
					onClick={() => svc.refreshBoard()}
				>
					Rescan
				</button>
			</div>
			<div class="shp-scroll">
			<table class="shp-table shp-captures">
				<colgroup>
					<col class="shp-c-sel" />
					<col class="shp-c-file" />
					<col class="shp-c-when" />
					<col class="shp-c-ax" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
					<col class="shp-c-num" />
				</colgroup>
				<thead>
					<tr>
						<th />
						<th>Capture</th>
						<th>When</th>
						<th>Axis</th>
						<th class="shp-num">f</th>
						<th class="shp-num">ζ</th>
						<th class="shp-num">peak</th>
					</tr>
				</thead>
				<tbody>
					<For
						each={rows()}
						fallback={
							<tr>
								<td colspan="7" class="shp-nil">
									<Switch fallback="Nothing here matches the filter.">
										<Match when={svc.boardState() === "reading" && source() === "board"}>Listing {ACCEL_DIR}…</Match>
										<Match when={svc.boardState() === "failed" && source() === "board"}>{svc.boardError()}</Match>
										<Match when={allRows().length === 0 && source() === "tool"}>
											T{svc.tool()} has no measurement. Fingerprint one from the board captures.
										</Match>
										<Match when={allRows().length === 0 && source() === "imported"}>
											Nothing imported this session.
										</Match>
										<Match when={allRows().length === 0 && source() === "board"}>
											{ACCEL_DIR} holds no CSVs.
										</Match>
									</Switch>
								</td>
							</tr>
						}
					>
						{row => (
							<tr classList={{ "shp-on": svc.capturePick() === row.key }}>
								<td>
									{/* Every row, whatever its origin. All three can supply
									    bytes; whether the fit may be SAVED is settled by
									    BatchAttribution, not by whether you may tick a box. */}
									<input
										type="checkbox"
										class="shp-check"
										aria-label={`Include ${row.file} in the fingerprint`}
										checked={selected().has(row.key)}
										onChange={() => toggle(row.key)}
									/>
								</td>
								<td>
									<button
										class="shp-pick shp-pick-wide"
										classList={{ "shp-imported": row.origin === "imported" }}
										aria-pressed={svc.capturePick() === row.key}
										onClick={() => pick(row)}
										title={row.origin === "imported" ? `${row.file} — imported from this computer` : accelPath(row.file)}
									>
										{row.file}
									</button>
								</td>
								<td class="shp-mono shp-when">{row.when}</td>
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
			{/*
			  The attribution bar. The tool is a deliberate choice with no default:
			  `svc.tool()` is where the SCREEN is looking, which is not the same as
			  what the operator meant to measure, and on a four-head machine those
			  two being confused is unrecoverable from the file afterwards. Save
			  arms first (control/armed.ts, so Escape backs out).
			*/}
			<div class="shp-batch">
				<button class="fb-tool shp-pick-n" disabled={rows().length === 0 || rows().length > MAX_BATCH} onClick={selectShown}>
					Select {rows().length}
				</button>
				<button class="fb-tool shp-pick-n" disabled={selected().size === 0} onClick={clearSelection}>Clear</button>
				<button
					class="fb-tool shp-pick-n"
					disabled={chosen().length === 0 || chosen().length > MAX_BATCH || svc.runState().kind === "running"}
					onClick={() => void svc.fitCaptures(chosen())}
				>
					Fit {chosen().length}
				</button>
				<label class="shp-target">
					<span class="shp-cap">Tool</span>
					<select
						class="filament-pick"
						aria-label="Tool to attribute this fingerprint to"
						value={target() === null ? "" : String(target())}
						onChange={e => {
							setArmed(null);
							setTarget(e.currentTarget.value === "" ? null : Number(e.currentTarget.value));
						}}
					>
						<option value="">— choose —</option>
						<For each={tools()}>{t => <option value={String(t.number)}>T{t.number}</option>}</For>
					</select>
				</label>
				<button
					class="fb-tool shp-save"
					classList={{ "shp-arming": armed() !== null }}
					disabled={attributable() === null || target() === null}
					onClick={save}
				>
					{saveLabel()}
				</button>
			</div>
			<p class="shp-batch-note" classList={{ "shp-warn-inline": svc.runState().kind === "failed" }}>
				<Show when={arming()} fallback={batchReport()}>
					{a => <>Confirm: write T{a().tool}&apos;s fingerprint to {RESULTS_PATH(a().tool)}. Escape cancels.</>}
				</Show>
			</p>
		</>
	);
}

/* ------------------------------------------------------------------- 4. sweep */

/**
 * Speed x frequency x amplitude for one tool, built from captures the board
 * already holds.
 *
 * WHAT THE PICTURE IS FOR, since every choice on this card follows from it.
 * Two kinds of vibration show up in a moving machine and only one of them is
 * shapeable:
 *
 *  - FORCED vibration follows the speed. The motors' torque ripple peaks once
 *    per full step, so a move at `v` mm/s excites `v x fullStepsPerMm` Hz — a
 *    ridge that climbs across the plot as the rows get faster. No shaper can
 *    move it; current, microstepping and the mechanics can.
 *  - RINGING sits at one frequency whatever the speed, because a structure does
 *    not know how fast the carriage is going. It draws a vertical stripe, and
 *    it is the only thing `M593` cancels.
 *
 * The dashed locus the chart lays over the cells is exactly "where a peak would
 * be if it were forced", so a ridge lying along it is motor ripple and a stripe
 * crossing it is a mode. That line is drawn from `fullStepsPerMm`, which is why
 * this card refuses to build anything until the object model has told it what
 * that is (shaping/fullStep.ts): a plausible default would draw a confident
 * lie.
 *
 * THIS CARD IS A VIEW. It runs no motion — the machine-moving sweep belongs to
 * the Capture card and arrives with its own armed confirm — so it neither
 * offers the `sweep` step nor plans one. What it does is find the sweeps
 * ALREADY on the SD card: 184 of the 259 CSVs in `0:/sys/accelerometer` are
 * named `<prefix>_<axis>_<speed>.csv`, which is a set of the same move at
 * several speeds and therefore already a sweep. The board listing, the download
 * cache and the worker are the SAME ones the Decay card browses through — one
 * `rr_filelist` per connection between the two cards, and a capture downloaded
 * for one is not downloaded again for the other.
 *
 * Positional stability: the chart's box is reserved by the stage's own floor
 * rather than by what is in it, the tool row and the run row are declared
 * heights whether or not the card has scanned, the readout is one fixed line
 * that fills with em dashes before a sweep exists, and the status line is a
 * fixed two. So scanning, building, saving and switching tool move nothing.
 */
export function ShapingSweepBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("shaping");
	const tools = createMemo(() => props.ctx.om.om.tools.filter(t => t !== null));
	const [pick, setPick] = createSignal<string>("");
	const [armed, setArmed] = createArmed<number>();

	const sweep = (): SweepMatrix | null => svc.results().sweep;

	/**
	 * The chosen family, resolved by ID against the current listing rather than
	 * held as an object: the listing is re-read by Rescan, and a captured object
	 * would go on naming files a later scan no longer has.
	 */
	const family = createMemo((): SweepFamily | null => svc.families().find(f => f.id === pick()) ?? null);

	/** The full-step rate for the axis the CHOSEN run drove — X until one is,
	 *  which is the right guess on this board: of its 84 speed families exactly
	 *  one (`baseline_y_Y`) is a Y run. */
	const step = createMemo((): FullStep => svc.fullStepFor(family()?.axis ?? "X"));

	/** Where the forced-vibration locus comes from, or the reason there is none.
	 *  One accessor over the union so the JSX reads a string and never narrows —
	 *  the two arms are a fact and a refusal, and both belong in the same slot
	 *  so neither changes the row's height. */
	const stepText = (): string => {
		const v = step();
		return v.known ? v.from : v.why;
	};

	/** Both fitted modes, marked on the frequency axis. Both rather than the
	 *  swept axis's alone: a `SweepMatrix` does not record which axis it is of,
	 *  so choosing one here would be a guess — and the labels say which is
	 *  which, so marking both costs nothing. */
	const markers = createMemo((): readonly SweepMarker[] => {
		const fp = svc.results().fingerprint;
		return fp === null ? [] : fingerprintMarkers([{ axis: "X", hz: fp.X?.f ?? null }, { axis: "Y", hz: fp.Y?.f ?? null }]);
	});

	const busy = (): boolean => {
		const k = svc.sweepState().kind;
		return k === "loading" || k === "computing" || k === "saving";
	};

	/** One line of facts, in fixed slots. Before a sweep exists every slot holds
	 *  the em dash, so the line is the same shape either way and the arrival of
	 *  a matrix moves nothing under it. */
	const readout = createMemo((): readonly [string, string, string] => {
		const m = sweep();
		if (m === null) return [NONE, NONE, NONE];
		const speeds = m.speeds.map(Number);
		const fs = m.fullStepHz.map(Number);
		return [
			`${speeds.length} speeds ${Math.min(...speeds)}-${Math.max(...speeds)} mm/s`,
			`0-${m.maxHz.toFixed(0)} Hz in ${m.freqs.length} bins`,
			`full-step ${Math.min(...fs).toFixed(0)}-${Math.max(...fs).toFixed(0)} Hz`,
		];
	});

	/** The armed tool, wrapped: T0 is 0 and `<Show when={0}>` renders the
	 *  fallback, so the confirm sentence would never appear for the default
	 *  tool. Same defect the Decay card's save bar had. */
	const arming = createMemo((): { tool: number } | null => {
		const tool = armed();
		return tool === null ? null : { tool };
	});

	const save = (): void => {
		const n = svc.tool();
		if (armed() === n) {
			setArmed(null);
			void svc.saveSweep();
			return;
		}
		setArmed(n);
	};

	return (
		<>
			{/* Which tool this sweep is about — the SHARED selection, so picking
			    here moves every other card on the screen with it. Eight cards
			    disagreeing about which head is being tuned is the failure the one
			    service exists to prevent (compose/services.ts). */}
			<div class="shp-sweep-bar">
				<span class="shp-cap">Tool</span>
				<div class="shp-tool-pick" role="group" aria-label="Tool being tuned">
					<For each={tools()} fallback={<span class="shp-nil">no tools</span>}>
						{t => (
							<button
								class="shp-pick shp-tool-chip"
								aria-pressed={svc.tool() === t.number}
								onClick={() => { setArmed(null); svc.setTool(t.number); }}
							>
								T{t.number}
							</button>
						)}
					</For>
				</div>
				<span class="shp-sweep-step" classList={{ "shp-warn-inline": !step().known }} title={stepText()}>
					{stepText()}
				</span>
			</div>
			{/* The run to draw, and the two acts. Nothing here moves the machine. */}
			<div class="shp-sweep-bar">
				<span class="shp-cap">Run</span>
				<select
					class="filament-pick shp-family"
					aria-label="Speed sweep to draw"
					value={pick()}
					onChange={e => setPick(e.currentTarget.value)}
				>
					<option value="">{svc.families().length === 0 ? "— scan the card —" : "— choose —"}</option>
					<For each={svc.families()}>
						{f => <option value={f.id}>{f.id} · {f.members.length}</option>}
					</For>
				</select>
				<button
					class="fb-tool shp-pick-n"
					disabled={family() === null || busy() || !step().known}
					onClick={() => {
						const f = family();
						if (f !== null) void svc.buildSweep(f);
					}}
				>
					Build {family()?.members.length ?? 0}
				</button>
				{/* The listing is asked for on a GESTURE and never on a render: 259
				    entries is several `rr_filelist` pages against a server that
				    tolerates very few requests, and the Decay card's browser shares
				    the answer. */}
				<button
					class="fb-tool shp-rescan"
					disabled={svc.boardState() === "reading"}
					onClick={() => svc.refreshBoard()}
				>
					{svc.boardState() === "unread" ? "Scan" : "Rescan"}
				</button>
				<button
					class="fb-tool shp-save"
					classList={{ "shp-arming": armed() !== null }}
					disabled={sweep() === null || busy()}
					onClick={save}
				>
					{armed() === null ? `Save to T${svc.tool()}` : "Confirm"}
				</button>
			</div>
			{/* The stage declares the plot's box, so the chart never sizes the card
			    and the card never has to be resized when a matrix arrives. */}
			<div class="shp-sweep-stage">
				<SweepHeatmap matrix={sweep} markers={markers} />
			</div>
			<p class="shp-sweep-read">
				<span>{readout()[0]}</span>
				<span>{readout()[1]}</span>
				<span>{readout()[2]}</span>
			</p>
			{/* What this sweep cannot say, beside the numbers it can. The
			    coverage finding belongs HERE and not only on the status card:
			    the operator reading a black band is looking at this chart. */}
			<CardCaveat evidence={svc.products().sweep} />
			<p class="shp-sweep-note" classList={{ "shp-warn-inline": svc.sweepState().kind === "failed" }}>
				<Show when={arming()} fallback={sweepStateText(svc.sweepState())}>
					{a => <>Confirm: write T{a().tool}&apos;s results, this sweep included, to {RESULTS_PATH(a().tool)}. Escape cancels.</>}
				</Show>
			</p>
		</>
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
	const [armed, setArmed] = createArmed<ApplyHow>();
	const pick = createMemo(() => recommendation(svc.results()));

	const copy = async (line: string): Promise<void> => {
		setCopied(await copyText(line));
	};

	/**
	 * Both acts through ONE route: first press arms, second press does it.
	 *
	 * The two are never armed at once — `createArmed` holds a single value, so
	 * arming Write disarms Send. An operator who armed one, changed their mind
	 * and pressed the other would otherwise be one keystroke from installing a
	 * shaper they had decided against.
	 */
	const act = (how: ApplyHow): void => {
		const made = pick();
		if (made === null) return;
		if (armed() !== how) {
			setArmed(how);
			return;
		}
		setArmed(null);
		void svc.applyShaper(svc.tool(), made.spec, how);
	};

	// The status card's step list does not install anything itself: it calls
	// this handler, which ARMS the persistent act. Two presses either way, and
	// the second is on the card showing the line about to be written.
	svc.offer("apply", () => {
		if (pick() !== null) setArmed("macro");
	});

	const intent = createMemo((): ApplyIntent | null => {
		const how = armed();
		const made = pick();
		return how === null || made === null ? null : { how, tool: svc.tool(), spec: made.spec };
	});

	const busy = (): boolean => svc.applyState().kind === "working";

	return (
		<>
			<dl class="shp-facts">
				<div class="shp-fact">
					<dt>Tool</dt>
					<dd class="shp-mono">T{svc.tool()} · {toolMacroPath(svc.tool())}</dd>
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
						{/* Three acts, in increasing consequence left to right:
						    copy it somewhere else, put it on the machine until
						    the next reset, or make it this tool's own. The order
						    is the sentence the operator reads. */}
						<div class="shp-actions">
							<button class="fb-tool" disabled={busy()} onClick={() => void copy(shaperLine(made().spec))}>Copy</button>
							<button
								class="fb-tool"
								classList={{ "shp-arming": armed() === "send" }}
								disabled={busy()}
								onClick={() => act("send")}
							>
								{armed() === "send" ? "Confirm" : "Send now"}
							</button>
							<button
								class="fb-tool"
								classList={{ "shp-arming": armed() === "macro" }}
								disabled={busy()}
								onClick={() => act("macro")}
							>
								{armed() === "macro" ? "Confirm" : `Write tpost${svc.tool()}.g`}
							</button>
							<span class="shp-copied" aria-live="polite">{copied() ? "copied" : ""}</span>
						</div>
					</>
				)}
			</Show>
			{/* One fixed slot for what is about to happen, what happened, or
			    why it did not. Present in every state so arming moves nothing. */}
			<p class="shp-apply-note" classList={{ "shp-warn-inline": svc.applyState().kind === "failed" }}>
				<Show when={intent()} fallback={applyStateText(svc.applyState()) || NONE}>
					{i => armedApplyText(i())}
				</Show>
			</p>
		</>
	);
}
