import { Show, Switch, Match, For, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { headlineRemaining, estimateSources } from "../om/estimates.ts";
import { isJobActive, jobFileOf } from "../om/job.ts";
import { baseName, fmtDuration } from "../files/format.ts";

/**
 * The print card — progress and pause/resume/cancel. It lives on the surfaces
 * where you WATCH or DRIVE the machine (Machine, Control, Activity), not on
 * Jobs: Jobs owns the file listing, and running a job is a control action, not
 * a property of a file.
 *
 * It renders in every state rather than vanishing when idle. That keeps one
 * card as the single answer to "what is the machine printing?", and means the
 * panel does not pop in and out of a layout the operator arranged.
 *
 * Content-only body; chrome comes from the compose registry (compose/defs.ts
 * "active-job" / "active-job-detailed") or the legacy wrapper below.
 */
export function ActiveJobBody(props: { detailed?: boolean }) {
	const app = useApp();
	const job = () => app.om.om.job;
	const jobFile = createMemo(() => jobFileOf(job()));
	const isActive = createMemo(() => isJobActive(app.om.om.state.status));
	const progress = createMemo(() => {
		const j = job();
		const f = jobFile();
		if (f === null || j.filePosition === null || f.size === 0) return null;
		return Math.min(100, (j.filePosition / f.size) * 100);
	});
	// One headline "Remaining" (most-accurate available source) plus the full
	// breakdown, so we mirror every estimate RRF gives without three competing
	// headline numbers. See om/estimates.ts.
	const headline = createMemo(() => headlineRemaining(job().timesLeft));
	const sources = createMemo(() => estimateSources(job().timesLeft));

	return (
		<Show
			when={isActive()}
			fallback={
				<Show when={app.om.om.job.lastFileName} fallback={<p class="job-empty">No job running.</p>}>
					{last => (
						<>
							<p class="job-empty">No job running. Last: {baseName(last())}</p>
							{/* Re-run the last file — a plain M32 on it, the same code Jobs
							    sends to start a print. Only offered when a last file exists. */}
							<div class="btn-row">
								<button
									class="btn btn-go"
									title={`Reprint ${baseName(last())}`}
									onClick={() => void app.connector.sendCode(cmd.print(last())).catch(() => undefined)}
								>
									Reprint
								</button>
							</div>
						</>
					)}
				</Show>
			}
		>
			<Show when={jobFile()} fallback={<p class="job-empty">{app.om.om.state.status}…</p>}>
				{file => (
					<>
						<div class="job-active-head">
							<span class="fname">{baseName(file().fileName)}</span>
							<span class={`chip chip-${app.om.om.state.status === "paused" ? "warn" : "busy"}`}>
								<span class="dot" />{app.om.om.state.status}
							</span>
						</div>
						<Show when={progress() !== null}>
							<div class="progress" role="progressbar" aria-valuenow={Math.round(progress()!)}>
								<div class="progress-fill" style={{ width: `${progress()!}%` }} />
								<span class="progress-label">{progress()!.toFixed(1)}%</span>
							</div>
						</Show>
						{/* Pause/Cancel ride on the facts row rather than below the card
						    body, so the two actions sit beside the numbers they act on.
						    Pinned right (margin-left:auto) so a fact gaining a character
						    — layer 9 → 10, "59s" → "1m 0s" — cannot move the buttons
						    under the pointer. */}
						<div class="job-facts-row">
							<div class="job-facts">
								<Show when={job().layer !== null}>
									<Fact label="Layer">{job().layer} / {file().numLayers}</Fact>
								</Show>
								<Show when={job().duration !== null}>
									<Fact label="Elapsed">{fmtDuration(job().duration!)}</Fact>
								</Show>
								<Show when={headline()}>
									{h => <Fact label="Remaining">{fmtDuration(h().seconds)}</Fact>}
								</Show>
							</div>
							<div class="btn-row job-actions">
								{/* job-toggle reserves the wider label's width so Cancel can't
								    slide under the pointer when the job changes state. */}
								<Switch>
									<Match when={app.om.om.state.status === "paused"}>
										<button class="btn job-toggle" title={cmd.resumePrint()} onClick={() => void app.connector.sendCode(cmd.resumePrint())}>Resume</button>
									</Match>
									<Match when={true}>
										<button class="btn job-toggle" title={cmd.pausePrint()} onClick={() => void app.connector.sendCode(cmd.pausePrint())}>Pause</button>
									</Match>
								</Switch>
								<button class="btn btn-danger" title={cmd.cancelPrint()} onClick={() => void app.connector.sendCode(cmd.cancelPrint())}>Cancel</button>
							</div>
						</div>
						{/* All RRF estimate sources, subordinate to the headline. Only
						    on the detailed surface — the compact control cards stay a
						    single actionable "Remaining" so their slot never gains a
						    row and reflows the operator's layout. Shown only when more
						    than one exists — a lone source would just repeat the
						    "Remaining" figure above. */}
						<Show when={props.detailed && sources().length > 1}>
							<div class="est-sources">
								<span class="est-cap">est.</span>
								<For each={sources()}>
									{s => (
										<span class="est-src">
											<span class="est-name">{s.source}</span>
											<span class="est-val">{fmtDuration(s.seconds)}</span>
										</span>
									)}
								</For>
							</div>
						</Show>
					</>
				)}
			</Show>
		</Show>
	);
}

function Fact(props: { label: string; children: unknown }) {
	return (
		<span class="fact"><span class="fact-label">{props.label}</span><span class="fact-val">{props.children as never}</span></span>
	);
}
