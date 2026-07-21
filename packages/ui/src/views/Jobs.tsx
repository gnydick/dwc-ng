import { Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { Thumbnail } from "../thumbnails/Thumbnail.tsx";
import { Card } from "../shell/Card.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { createFileBrowser } from "../files/browser.ts";
import { FileBrowserView } from "../files/FileBrowserView.tsx";
import { JOBS_PANEL_DEFAULTS } from "./jobs.panelDefaults.ts";

const GCODES_ROOT = "0:/gcodes";

/** RRF statuses where a job is on the machine and controllable. */
const ACTIVE_STATUSES = new Set(["processing", "paused", "pausing", "resuming", "cancelling", "simulating"]);

/**
 * Jobs — this domain owns the gcodes listing (no central Files section). A
 * click OPENS a file (metadata + thumbnail), it never runs it; starting a
 * print is an explicit control-surface action. When a job is on the machine,
 * an Active-job card gives progress and pause/resume/cancel.
 */
export default function Jobs() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.jobs", JOBS_PANEL_DEFAULTS, id => {
		if (id === "camera") return app.config.config.camera.pinned;
		if (id === "job-details") return selected() !== null;
		return true;
	});

	const connected = () => app.om.connection.status === "connected";

	// Files newest-first — the way you actually hunt for a job you just sliced.
	const browser = createFileBrowser(GCODES_ROOT, connected, app.connector, "recent");
	const [selected, setSelected] = createSignal<string | null>(null);

	const [info] = createResource(selected, path => app.connector.getFileInfo(path));

	const [thumb] = createResource(
		// chained off fileinfo: only fetch once we know the offset + format
		() => {
			const i = info();
			return i && i.thumbnails.length > 0 ? { path: i.fileName, t: i.thumbnails[0]! } : false;
		},
		async ({ path, t }) => ({ bytes: await app.connector.getThumbnail(path, t.offset), format: t.format }),
	);

	// ---- active job ----
	const job = () => app.om.om.job;
	// An idle machine can still carry a job.file object whose fields are null;
	// only treat it as a real job when it names a file.
	const jobFile = createMemo(() => {
		const f = job().file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f : null;
	});
	const isActive = createMemo(() => ACTIVE_STATUSES.has(app.om.om.state.status) || jobFile() !== null);

	const startPrint = () => {
		const path = selected();
		if (path !== null) void app.connector.sendCode(`M32 "${path}"`);
	};

	/**
	 * Simulate: RRF runs the file without heating or moving and reports the time
	 * it would take. Same two-step arm as any other machine action — it occupies
	 * the machine for the duration, so it is not a free click.
	 */
	const simulate = () => {
		const path = selected();
		if (path !== null) void app.connector.sendCode(cmd.simulate(path));
	};

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="jobs">
				<Card id="job-files" canvas={canvas} ariaLabel="Job files" class="jobs-browse" title="Jobs" tip={browser.dir()}>
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
						<FileBrowserView
							browser={browser}
							selected={selected()}
							onOpen={entry => setSelected(browser.pathOf(entry))}
							rootLabel="gcodes"
							emptyText="Empty folder."
							showMeta
						/>
					</Show>
				</Card>

				<Show when={selected()}>
					<Card id="job-details" canvas={canvas} ariaLabel="Job details" class="jobs-detail" title={baseName(selected()!)} tip="rr_fileinfo">
						<Switch>
							<Match when={info.loading}><p class="job-empty">Reading metadata…</p></Match>
							<Match when={info.error}><p class="job-empty">No metadata for this file.</p></Match>
							<Match when={info()}>
								<div class="detail-body">
									<div class="thumb-frame">
										<Switch>
											<Match when={thumb()}>{t => <Thumbnail bytes={t().bytes} format={t().format} alt={`Preview of ${baseName(selected()!)}`} />}</Match>
											<Match when={thumb.loading}><span class="thumb-placeholder">…</span></Match>
											<Match when={true}><span class="thumb-placeholder">no preview</span></Match>
										</Switch>
									</div>
									<dl class="meta-grid">
										<Show when={info()!.printTime}><Meta label="Print time">{fmtDuration(info()!.printTime!)}</Meta></Show>
										<Show when={info()!.filament.length}><Meta label="Filament">{fmtFilament(info()!.filament)}</Meta></Show>
										<Show when={info()!.numLayers}><Meta label="Layers">{info()!.numLayers}</Meta></Show>
										<Show when={info()!.height}><Meta label="Height">{info()!.height!.toFixed(2)} mm</Meta></Show>
										<Show when={info()!.layerHeight}><Meta label="Layer height">{info()!.layerHeight} mm</Meta></Show>
										<Meta label="Size">{fmtSize(info()!.size)}</Meta>
										<Show when={info()!.generatedBy}><Meta label="Sliced by">{info()!.generatedBy}</Meta></Show>
									</dl>
								</div>
								<div class="btn-row detail-actions">
									<button class="btn btn-go" disabled={isActive()} onClick={startPrint}>Start print</button>
									<button class="btn" disabled={isActive()} onClick={simulate} title="Run the file without heating or moving, to get RRF's own time estimate">Simulate</button>
									<Show when={isActive()}><span class="job-empty">A job is already running.</span></Show>
								</div>
							</Match>
						</Switch>
					</Card>
				</Show>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}

function Meta(props: { label: string; children: unknown }) {
	return (
		<>
			<dt>{props.label}</dt>
			<dd>{props.children as never}</dd>
		</>
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

function fmtFilament(perExtruder: number[]): string {
	const totalMm = perExtruder.reduce((a, b) => a + b, 0);
	const meters = (totalMm / 1000).toFixed(2);
	return perExtruder.length > 1 ? `${meters} m · ${perExtruder.length} tools` : `${meters} m`;
}

function fmtSize(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

