import { Show, Switch, Match, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

/** RRF statuses where a job is on the machine and controllable. */
const ACTIVE_STATUSES = new Set(["processing", "paused", "pausing", "resuming", "cancelling", "simulating"]);

/**
 * The print card — progress and pause/resume/cancel. It lives on the surfaces
 * where you WATCH or DRIVE the machine (Machine, Control, Activity), not on
 * Jobs: Jobs owns the file listing, and running a job is a control action, not
 * a property of a file.
 *
 * It renders in every state rather than vanishing when idle. That keeps one
 * card as the single answer to "what is the machine printing?", and means the
 * panel does not pop in and out of a layout the operator arranged.
 */
export function ActiveJobCard(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	const job = () => app.om.om.job;
	const jobFile = createMemo(() => {
		const f = job().file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f : null;
	});
	const isActive = createMemo(() => ACTIVE_STATUSES.has(app.om.om.state.status) || jobFile() !== null);
	const progress = createMemo(() => {
		const j = job();
		const f = jobFile();
		if (f === null || j.filePosition === null || f.size === 0) return null;
		return Math.min(100, (j.filePosition / f.size) * 100);
	});

	return (
		<Show
			when={isActive()}
			fallback={
				<Card id="active-job" canvas={props.canvas} ariaLabel="Active job" class="job-active" title="Printing" tip="job · state">
					<p class="job-empty">
						No job running.
						<Show when={app.om.om.job.lastFileName}> Last: {baseName(app.om.om.job.lastFileName)}</Show>
					</p>
				</Card>
			}
		>
			<Card id="active-job" canvas={props.canvas} ariaLabel="Active job" class="job-active" title="Printing" tip="job · state">
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
							<div class="job-facts">
								<Show when={job().layer !== null}>
									<Fact label="Layer">{job().layer} / {file().numLayers}</Fact>
								</Show>
								<Show when={job().duration !== null}>
									<Fact label="Elapsed">{fmtDuration(job().duration!)}</Fact>
								</Show>
								<Show when={job().timesLeft.file !== null}>
									<Fact label="Remaining">{fmtDuration(job().timesLeft.file!)}</Fact>
								</Show>
							</div>
							<div class="btn-row">
								{/* job-toggle reserves the wider label's width so Cancel can't
								    slide under the pointer when the job changes state. */}
								<Switch>
									<Match when={app.om.om.state.status === "paused"}>
										<button class="btn job-toggle" onClick={() => void app.connector.sendCode("M24")}>Resume</button>
									</Match>
									<Match when={true}>
										<button class="btn job-toggle" onClick={() => void app.connector.sendCode("M25")}>Pause</button>
									</Match>
								</Switch>
								<button class="btn btn-danger" onClick={() => void app.connector.sendCode("M0")}>Cancel</button>
							</div>
						</>
					)}
				</Show>
			</Card>
		</Show>
	);
}

function Fact(props: { label: string; children: unknown }) {
	return (
		<span class="fact"><span class="fact-label">{props.label}</span><span class="fact-val">{props.children as never}</span></span>
	);
}

function baseName(path: string | null | undefined): string {
	if (!path) return "";
	const i = path.lastIndexOf("/");
	return i >= 0 ? path.slice(i + 1) : path;
}

function fmtDuration(seconds: number): string {
	const s = Math.round(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s % 60}s`;
	return `${s}s`;
}
