import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import { OmInspector } from "../om/OmInspector.tsx";
import { languageFor, type EditorLang } from "../editor/lang.ts";
import type { FileListEntry } from "../connector/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { Card } from "../shell/Card.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { CardHead } from "../shell/CardHead.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { SYSTEM_PANEL_DEFAULTS } from "./system.panelDefaults.ts";

const SYS_ROOT = "0:/sys";

/**
 * System — owns the 0:/sys listing and the object-model inspector (no central
 * Files section; each domain owns its files). Clicking a file opens it in the
 * editor. There is deliberately no Run here: sys files are invoked by the
 * firmware (config.g at boot, homeall.g by G28), not fired by hand.
 */
export default function System() {
	const app = useApp();
	const canvas = createPanelCanvas("dwc-ng.canvas.system", SYSTEM_PANEL_DEFAULTS,
		// The camera panel is Show-gated on camera.pinned; when hidden it must
		// not block a visible panel from being moved or resized into its cells.
		id => (id === "camera" ? app.config.config.camera.pinned : true));
	const connected = (): boolean => app.om.connection.status === "connected";

	const [dir, setDir] = createSignal(SYS_ROOT);
	const [selected, setSelected] = createSignal<string | null>(null);

	const [entries] = createResource(
		() => (connected() ? dir() : false),
		d => app.connector.list(d),
	);

	const sorted = createMemo(() => {
		const list = entries() ?? [];
		return [...list].sort((a, b) => {
			if (a.type !== b.type) return a.type === "d" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	});

	const pathOf = (entry: FileListEntry): string => `${dir()}/${entry.name}`;

	/** Sys files are G-code unless the extension says otherwise (e.g. .json). */
	const langOf = (path: string): EditorLang => {
		const detected = languageFor(path);
		return detected === "text" ? "gcode" : detected;
	};

	const open = (entry: FileListEntry): void => {
		if (entry.type === "d") {
			setSelected(null);
			setDir(pathOf(entry));
		} else {
			setSelected(pathOf(entry));
		}
	};

	const goUp = (): void => {
		setSelected(null);
		setDir(dir().slice(0, dir().lastIndexOf("/")) || SYS_ROOT);
	};

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="system">
				<Card id="system-files" canvas={canvas} ariaLabel="System files" title="System files" tip={dir()}>
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
						<Show when={dir() !== SYS_ROOT}>
							<button class="link-btn" onClick={goUp}>← up a level</button>
						</Show>
						<ul class="file-list">
							<For each={sorted()} fallback={<li class="job-empty">Empty.</li>}>
								{entry => (
									<li class="file-row" classList={{ active: selected() === pathOf(entry) }}>
										<Switch>
											<Match when={entry.type === "d"}>
												<button class="file-name is-dir" onClick={() => open(entry)}>
													<span class="file-ico">▸</span>{entry.name}
												</button>
											</Match>
											<Match when={entry.type === "f"}>
												<button class="file-name" onClick={() => open(entry)}>{entry.name}</button>
											</Match>
										</Switch>
									</li>
								)}
							</For>
						</ul>
					</Show>
				</Card>

				<Panel id="editor" canvas={canvas} ariaLabel="Editor" class="editor-card">
					<Show
						when={selected()}
						fallback={
							<>
								<CardHead title="Editor" />
								<p class="job-empty">
									Select a system file to view or edit it. These run when the firmware
									calls them — config.g at boot, homeall.g on G28.
								</p>
							</>
						}
					>
						{path => <FileEditor path={path()} lang={langOf(path())} onClose={() => setSelected(null)} />}
					</Show>
				</Panel>

				<Card id="object-model" canvas={canvas} ariaLabel="Object model" class="om-card" title="Object model" tip="live · rr_model">
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
						<OmInspector data={app.om.om as unknown as Record<string, unknown>} />
					</Show>
				</Card>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
	);
}
