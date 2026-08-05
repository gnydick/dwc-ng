/**
 * The file-domain card bodies — Jobs / Macros / System listings, their
 * editors, and System's OM inspector. Extracted from the bespoke views in the
 * A5 conversion; all cross-card state lives in the compose services
 * (jobsBrowser / macrosBrowser / sysBrowser), reached via ctx.service — the
 * browser card and its details/editor sibling share one selection by
 * construction.
 */
import { Show, Switch, Match, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { createArmed } from "../control/armed.ts";
import { Thumbnail } from "../thumbnails/Thumbnail.tsx";
import { FileBrowserView } from "../files/FileBrowserView.tsx";
import { FileEditorBody } from "../editor/FileEditor.tsx";
import { languageFor, type EditorLang } from "../editor/lang.ts";
import { OmInspector } from "../om/OmInspector.tsx";
import { baseName, fmtDuration, formatSize } from "../files/format.ts";
import { describeFileInfoError } from "../files/fileInfoError.ts";
import { isJobActive } from "../om/job.ts";
import type { CardCtx } from "../compose/ctx.ts";

// ---- Jobs ----

/**
 * The job listing, rendered by BOTH job cards.
 *
 * ONE jobsBrowser between them, deliberately. They had separate browsers for a
 * few hours so the inventory could not move the Jobs card underneath you —
 * which also meant opening a file in the inventory set a selection nothing
 * read, so Job details never loaded it (reported 2026-07-30). Independent
 * navigation is not worth a card whose clicks do nothing.
 */
function JobsListing(props: { ctx: CardCtx; manageActions: boolean }) {
	const app = useApp();
	const svc = props.ctx.service("jobsBrowser");
	// The row action splits with the card. Jobs ACTS on a job — the button
	// starts the print, the same M32 the Job details card sends, so the two
	// cannot mean different things by "print". The inventory MANAGES files, and
	// Download is a file operation, so it moved there with Rename and Delete
	// rather than being deleted.
	const startPrint = (path: string): void => {
		void app.connector.sendCode(cmd.print(path)).catch(() => undefined);
	};
	return (
		<Show when={props.ctx.connected()} fallback={<p class="job-empty">Not connected.</p>}>
			<FileBrowserView
				browser={svc.browser}
				selected={svc.selected()}
				onOpen={entry => svc.setSelected(svc.browser.pathOf(entry))}
				rootLabel="gcodes"
				emptyText="Empty folder."
				showMeta
				// The date rides with the management actions: the inventory sorts
				// files out and wants it, the Jobs list picks one to print and does
				// not — and it was a fixed 120px, the widest cell after the name.
				showDate={props.manageActions}
				manageActions={props.manageActions}
				rowActions={entry => {
					const path = svc.browser.pathOf(entry);
					return (
						<Show
							when={props.manageActions}
							fallback={
								<button class="fb-act" title={cmd.print(path)} onClick={() => startPrint(path)}>
									PRINT
								</button>
							}
						>
							<button
								class="fb-act"
								title={`Download ${entry.name}`}
								disabled={svc.downloading() !== null}
								onClick={() => void svc.download(path, entry.name)}
							>
								{svc.downloading() === path ? "…" : "Download"}
							</button>
						</Show>
					);
				}}
			/>
		</Show>
	);
}

/**
 * Jobs: pick one to print. Download stays — it takes a copy and changes
 * nothing — but Rename, Delete and the create/upload bar do not. This is the
 * card you click through to start a print, and a Delete beside a filename in
 * that list is the wrong button to have within reach.
 *
 * It also owns the selection Job details reads, so this is the card that says
 * which job is "the" job.
 */
export function JobFilesBody(props: { ctx: CardCtx }) {
	return <JobsListing ctx={props.ctx} manageActions={false} />;
}

/** The same listing with the management actions on. Shares the Jobs card's
 *  browser, so opening a file here is what Job details shows. */
export function JobsInventoryBody(props: { ctx: CardCtx }) {
	return <JobsListing ctx={props.ctx} manageActions={true} />;
}

export function JobDetailsBody(props: { ctx: CardCtx }) {
	const app = useApp();
	const svc = props.ctx.service("jobsBrowser");
	const active = createMemo(() => isJobActive(app.om.om.state.status));
	// Read here rather than inside the <Match>: Match's callback form needs a
	// keyed child, and the memo wants to live in the component's scope anyway so
	// the error is described once per failure instead of once per render.
	const failure = createMemo(() => describeFileInfoError(svc.info.error));

	const startPrint = (): void => {
		const path = svc.selected();
		if (path !== null) void app.connector.sendCode(cmd.print(path));
	};
	/** Simulate: RRF runs the file without heating or moving and reports the
	 *  time it would take. It occupies the machine for the duration. */
	const simulate = (): void => {
		const path = svc.selected();
		if (path !== null) void app.connector.sendCode(cmd.simulate(path));
	};

	return (
		<Switch>
			<Match when={svc.selected() === null}><p class="job-empty">No selection</p></Match>
			<Match when={svc.info.loading}><p class="job-empty">Reading…</p></Match>
			{/* A failed read is a FAILURE, and it says so — not "No metadata" in the
			    same muted style as "No selection". The run actions are absent here
			    and cannot be added: they live at exactly one site, inside the
			    loaded-metadata branch below (spec D1). */}
			<Match when={svc.info.error}>
				<div class="job-error">
					<p class="job-error-summary">⚠ {failure().summary}</p>
					<Show when={failure().detail}>
						{detail => <p class="job-error-detail">{detail()}</p>}
					</Show>
					<div class="btn-row">
						<button class="btn" onClick={() => void svc.refetchInfo()}>Retry</button>
					</div>
				</div>
			</Match>
			<Match when={svc.info()}>
				{info => (
					<>
						<div class="detail-body">
							<div class="thumb-frame">
								<Switch>
									<Match when={svc.thumb()}>{t => <Thumbnail bytes={t().bytes} format={t().format} alt={`Preview of ${baseName(svc.selected())}`} />}</Match>
									<Match when={svc.thumb.loading}><span class="thumb-placeholder">…</span></Match>
									<Match when={true}><span class="thumb-placeholder">no preview</span></Match>
								</Switch>
							</div>
							<dl class="meta-grid">
								<Show when={info().printTime}><Meta label="Print time">{fmtDuration(info().printTime!)}</Meta></Show>
								<Show when={info().filament.length}><Meta label="Filament">{fmtFilament(info().filament)}</Meta></Show>
								<Show when={info().numLayers}><Meta label="Layers">{info().numLayers}</Meta></Show>
								<Show when={info().height}><Meta label="Height">{info().height!.toFixed(2)} mm</Meta></Show>
								<Show when={info().layerHeight}><Meta label="Layer height">{info().layerHeight} mm</Meta></Show>
								<Meta label="Size">{formatSize(info().size)}</Meta>
								<Show when={info().generatedBy}><Meta label="Sliced by">{info().generatedBy}</Meta></Show>
							</dl>
						</div>
						<div class="btn-row detail-actions">
							<button class="btn btn-go" disabled={active()} onClick={startPrint}>Start print</button>
							<button class="btn" disabled={active()} onClick={simulate} title="Run the file without heating or moving, to get RRF's own time estimate">Simulate</button>
							<Show when={active()}><span class="job-empty">Job running</span></Show>
						</div>
					</>
				)}
			</Match>
		</Switch>
	);
}

// ---- Macros ----

/**
 * The macro listing, rendered by BOTH macro cards.
 *
 * They differ in ONE way — whether the rows carry Rename/Delete — so they are
 * one component with one prop rather than two that happen to agree today.
 * Copying it would have made the two-step Run confirm, the AutoConfirm setting
 * and the quoted M98 into things maintained twice.
 *
 * One macrosBrowser between them, for the reason the job pair shares one:
 * opening a macro in the inventory has to be the macro the editor opens.
 */
function MacrosListing(props: { ctx: CardCtx; manageActions: boolean }) {
	const app = useApp();
	const svc = props.ctx.service("macrosBrowser");
	// Two-step Run confirm — armed is card-local (the checkbox that clears it
	// lives in this same card), collapsed by the persisted autoConfirm setting.
	// createArmed, not createSignal: Escape disarms it. A row left saying
	// "Confirm" whose next click runs a macro had no way back at all.
	const [armed, setArmed] = createArmed<string>();
	const autoConfirm = (): boolean => app.config.config.macros.autoConfirmRun;

	const run = (path: string): void => {
		if (!autoConfirm() && armed() !== path) {
			setArmed(path);
			return;
		}
		setArmed(null);
		// cmd.runMacro quotes the path — a filename with an embedded quote
		// used to interpolate raw and malform the command (audit M3).
		void app.connector.sendCode(cmd.runMacro(path)).catch(() => undefined);
	};

	return (
		<Show when={props.ctx.connected()} fallback={<p class="job-empty">Not connected.</p>}>
			<label class="macro-autoconfirm">
				<input
					type="checkbox"
					checked={autoConfirm()}
					onChange={e => {
						// Leaving a row armed while switching modes would make the
						// next click mean something different than it looks.
						setArmed(null);
						app.config.setMacros({ autoConfirmRun: e.currentTarget.checked });
					}}
				/>
				<span>AutoConfirm</span>
				<span class="macro-autoconfirm-hint">
					{autoConfirm() ? "Run fires on the first click" : "Run asks twice"}
				</span>
			</label>
			<FileBrowserView
				browser={svc.browser}
				selected={svc.selected()}
				onOpen={entry => svc.setSelected(svc.browser.pathOf(entry))}
				rootLabel="macros"
				emptyText="No macros here."
				manageActions={props.manageActions}
				rowActions={entry => {
					const path = svc.browser.pathOf(entry);
					return (
						<button
							class="run-btn"
							classList={{ armed: armed() === path }}
							title={cmd.runMacro(path)}
							onClick={() => run(path)}
						>
							{armed() === path ? "Confirm" : "▶ Run"}
						</button>
					);
				}}
			/>
		</Show>
	);
}

/**
 * Macros: RUN them. No Rename, no Delete — a destructive button a few pixels
 * from ▶ Run, in a list you are clicking through, is an accident waiting for a
 * slow afternoon. File management lives in macros-inventory.
 */
export function MacrosBody(props: { ctx: CardCtx }) {
	return <MacrosListing ctx={props.ctx} manageActions={false} />;
}

/** Macros inventory: the same listing with the management actions on. Shares
 *  the Macros card's browser, so a file opened here is the one the editor gets. */
export function MacrosInventoryBody(props: { ctx: CardCtx }) {
	return <MacrosListing ctx={props.ctx} manageActions={true} />;
}

// ---- System ----

export function SystemFilesBody(props: { ctx: CardCtx }) {
	const svc = props.ctx.service("sysBrowser");
	return (
		<Show when={props.ctx.connected()} fallback={<p class="job-empty">Not connected.</p>}>
			<FileBrowserView
				browser={svc.browser}
				selected={svc.selected()}
				onOpen={entry => svc.setSelected(svc.browser.pathOf(entry))}
				rootLabel="sys"
				emptyText="Empty."
			/>
		</Show>
	);
}

export function OmInspectorBody(props: { ctx: CardCtx }) {
	const app = useApp();
	return (
		<Show when={props.ctx.connected()} fallback={<p class="job-empty">Not connected.</p>}>
			<OmInspector data={app.om.om as unknown as Record<string, unknown>} />
		</Show>
	);
}

// ---- Editors (Macros / System) ----

/** Sys files are G-code unless the extension says otherwise (e.g. .json). */
function sysLangOf(path: string): EditorLang {
	const detected = languageFor(path);
	return detected === "text" ? "gcode" : detected;
}

function EditorBody(props: { ctx: CardCtx; domain: "macrosBrowser" | "sysBrowser"; hint: string; lang: (path: string) => EditorLang }) {
	const svc = props.ctx.service(props.domain);
	return (
		<Show
			when={svc.selected()}
			fallback={<p class="job-empty">{props.hint}</p>}
		>
			{path => <FileEditorBody path={path()} lang={props.lang(path())} onClose={() => svc.setSelected(null)} />}
		</Show>
	);
}

export function MacrosEditorBody(props: { ctx: CardCtx }) {
	return (
		<EditorBody
			ctx={props.ctx}
			domain="macrosBrowser"
			hint="Select a macro to view or edit it. Run lives on the listing — opening a file never executes it."
			lang={() => "gcode"}
		/>
	);
}

export function SystemEditorBody(props: { ctx: CardCtx }) {
	return (
		<EditorBody
			ctx={props.ctx}
			domain="sysBrowser"
			hint="Select a system file to view or edit it. These run when the firmware calls them — config.g at boot, homeall.g on G28."
			lang={sysLangOf}
		/>
	);
}

// ---- local helpers ----

function Meta(props: { label: string; children: unknown }) {
	return (
		<>
			<dt>{props.label}</dt>
			<dd>{props.children as never}</dd>
		</>
	);
}

function fmtFilament(perExtruder: number[]): string {
	const totalMm = perExtruder.reduce((a, b) => a + b, 0);
	const meters = (totalMm / 1000).toFixed(2);
	return perExtruder.length > 1 ? `${meters} m · ${perExtruder.length} tools` : `${meters} m`;
}
