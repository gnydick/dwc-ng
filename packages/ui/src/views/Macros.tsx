import { Show, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import type { FileListEntry } from "../connector/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { Card } from "../shell/Card.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { CardHead } from "../shell/CardHead.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { createFileBrowser } from "../files/browser.ts";
import { FileBrowserView } from "../files/FileBrowserView.tsx";
import { MACROS_PANEL_DEFAULTS } from "./macros.panelDefaults.ts";

const MACROS_ROOT = "0:/macros";

/**
 * Macros — this domain owns the 0:/macros listing (no central Files section).
 * A click OPENS a macro in the editor; it never runs it. Running is a separate,
 * explicit ▶ Run button (M98), matching DWC's deliberate run-with-confirm and
 * the project's "files never run on click" rule.
 *
 * Navigation and file operations come from the shared browser, so they are the
 * same here as in Jobs and System by construction.
 */
export default function Macros() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.macros", MACROS_PANEL_DEFAULTS,
		// The camera panel is Show-gated on camera.pinned; when hidden it must
		// not block a visible panel from being moved or resized into its cells.
		id => (id === "camera" ? app.config.config.camera.pinned : true));
	const connected = (): boolean => app.om.connection.status === "connected";

	const browser = createFileBrowser(MACROS_ROOT, connected, app.connector);
	const [selected, setSelected] = createSignal<string | null>(null);
	const [armed, setArmed] = createSignal<string | null>(null); // path awaiting run-confirm

	const autoConfirm = (): boolean => app.config.config.macros.autoConfirmRun;

	/**
	 * Two-step run by default: the first click arms, the second fires — no
	 * modal, but no single-click machine action either. AutoConfirm collapses
	 * that to one click; its checkbox sits next to the list so the mode is
	 * always visible where the Run buttons are, never an invisible belief.
	 */
	const run = (entry: FileListEntry): void => {
		const path = browser.pathOf(entry);
		if (!autoConfirm() && armed() !== path) {
			setArmed(path);
			return;
		}
		setArmed(null);
		void app.connector.sendCode(`M98 P"${path}"`).catch(() => undefined);
	};

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="macros">
				<Card id="macros" canvas={canvas} ariaLabel="Macros" title="Macros" tip={browser.dir()}>
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
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
							browser={browser}
							selected={selected()}
							onOpen={entry => setSelected(browser.pathOf(entry))}
							rootLabel="macros"
							emptyText="No macros here."
							rowActions={entry => (
								<button
									class="run-btn"
									classList={{ armed: armed() === browser.pathOf(entry) }}
									title={`Run ${entry.name} (M98)`}
									onClick={() => run(entry)}
								>
									{armed() === browser.pathOf(entry) ? "Confirm" : "▶ Run"}
								</button>
							)}
						/>
					</Show>
				</Card>

				<Panel id="editor" canvas={canvas} ariaLabel="Editor" class="editor-card">
					<Show
						when={selected()}
						fallback={
							<>
								<CardHead title="Editor" />
								<p class="job-empty">
									Select a macro to view or edit it. Opening never runs it — use the
									explicit ▶ Run button (click twice to confirm).
								</p>
							</>
						}
					>
						{path => <FileEditor path={path()} lang="gcode" onClose={() => setSelected(null)} />}
					</Show>
				</Panel>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
