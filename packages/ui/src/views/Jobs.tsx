import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Thumbnail } from "../thumbnails/Thumbnail.tsx";
import type { FileListEntry } from "../connector/types.ts";
import { Card } from "../shell/Card.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { JOBS_PANEL_DEFAULTS } from "./jobs.panelDefaults.ts";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";

const GCODES_ROOT = "0:/gcodes";

/** RRF statuses where a job is on the machine and controllable. */
const ACTIVE_STATUSES = new Set(["processing", "paused", "pausing", "resuming", "cancelling", "simulating"]);

/**
 * Jobs â€” this domain owns the gcodes listing (no central Files section). A
 * click OPENS a file (metadata + thumbnail), it never runs it; starting a
 * print is an explicit control-surface action. When a job is on the machine,
 * an Active-job card gives progress and pause/resume/cancel.
 */
export default function Jobs() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.jobs", JOBS_PANEL_DEFAULTS, id => {
		if (id === "active-job") return isActive();
		if (id === "job-details") return selected() !== null;
		return true;
	});

	const connected = () => app.om.connection.status === "connected";

	const [dir, setDir] = createSignal(GCODES_ROOT);
	const [selected, setSelected] = createSignal<string | null>(null);

	const [entries, { refetch: refetchEntries }] = createResource(
		() => (connected() ? dir() : false),
		d => app.connector.list(d),
	);

	// dirs first, then files newest-first â€” the way you actually hunt for a job.
	const sorted = createMemo(() => {
		const list = entries() ?? [];
		return [...list].sort((a, b) => {
			if (a.type !== b.type) return a.type === "d" ? -1 : 1;
			if (a.type === "f") return (b.date ?? "").localeCompare(a.date ?? "");
			return a.name.localeCompare(b.name);
		});
	});

	const [info] = createResource(selected, path => app.connector.getFileInfo(path));

	const [thumb] = createResource(
		// chained off fileinfo: only fetch once we know the offset + format
		() => {
			const i = info();
			return i && i.thumbnails.length > 0 ? { path: i.fileName, t: i.thumbnails[0]! } : false;
		},
		async ({ path, t }) => ({ bytes: await app.connector.getThumbnail(path, t.offset), format: t.format }),
	);

	const openEntry = (entry: FileListEntry) => {
		if (entry.type === "d") {
			setSelected(null);
			setDir(`${dir()}/${entry.name}`);
		} else {
			setSelected(`${dir()}/${entry.name}`);
		}
	};

	const crumbs = createMemo(() => {
		const rel = dir().slice(GCODES_ROOT.length).split("/").filter(Boolean);
		return rel.map((name, i) => ({ name, path: `${GCODES_ROOT}/${rel.slice(0, i + 1).join("/")}` }));
	});

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

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>â†º Reset layout</button>
			</div>
			<PanelCanvas class="jobs">
				<ActiveJobCard canvas={canvas} />

				<Card id="job-files" canvas={canvas} ariaLabel="Job files" class="jobs-browse" title="Jobs" tip={dir()}>

					<nav class="crumbs" aria-label="Folder">
						<button class="crumb" classList={{ active: dir() === GCODES_ROOT }} onClick={() => { setSelected(null); setDir(GCODES_ROOT); }}>gcodes</button>
						<For each={crumbs()}>
							{c => (
								<>
									<span class="crumb-sep">/</span>
									<button class="crumb" onClick={() => { setSelected(null); setDir(c.path); }}>{c.name}</button>
								</>
							)}
						</For>
					</nav>

					<Switch>
						<Match when={entries.loading}><p class="job-empty">Loadingâ€¦</p></Match>
						<Match when={entries.error}>
							<p class="job-empty">Couldnâ€™t list {dir()}. <button class="link-btn" onClick={() => void refetchEntries()}>Retry</button></p>
						</Match>
						<Match when={sorted().length === 0}><p class="job-empty">Empty folder.</p></Match>
						<Match when={true}>
							<ul class="file-list">
								<For each={sorted()}>
									{entry => (
										<li>
											<button
												class="file-row"
												classList={{ dir: entry.type === "d", selected: selected() === `${dir()}/${entry.name}` }}
												onClick={() => openEntry(entry)}
											>
												<span class="file-icon" aria-hidden="true">{entry.type === "d" ? "â–¸" : "â–¤"}</span>
												<span class="file-name">{entry.name}</span>
												<Show when={entry.type === "f"}>
													<span class="file-meta">{fmtSize(entry.size)}</span>
													<Show when={entry.date}><span class="file-meta file-date">{fmtDate(entry.date!)}</span></Show>
												</Show>
											</button>
										</li>
									)}
								</For>
							</ul>
						</Match>
					</Switch>
				</Card>

				<Show when={selected()}>
					<Card id="job-details" canvas={canvas} ariaLabel="Job details" class="jobs-detail" title={baseName(selected()!)} tip="rr_fileinfo">
						<Switch>
							<Match when={info.loading}><p class="job-empty">Reading metadataâ€¦</p></Match>
							<Match when={info.error}><p class="job-empty">No metadata for this file.</p></Match>
							<Match when={info()}>
								<div class="detail-body">
									<div class="thumb-frame">
										<Switch>
											<Match when={thumb()}>{t => <Thumbnail bytes={t().bytes} format={t().format} alt={`Preview of ${baseName(selected()!)}`} />}</Match>
											<Match when={thumb.loading}><span class="thumb-placeholder">â€¦</span></Match>
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
	return perExtruder.length > 1 ? `${meters} m Â· ${perExtruder.length} tools` : `${meters} m`;
}

function fmtSize(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

function fmtDate(iso: string): string {
	return iso.slice(0, 10);
}
