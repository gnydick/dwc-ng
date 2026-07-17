import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import { OmInspector } from "../om/OmInspector.tsx";
import { languageFor, type EditorLang } from "../editor/lang.ts";
import type { FileListEntry } from "../connector/types.ts";
import { Panel } from "../shell/Panel.tsx";
import { createPanelLayout, type PanelDefault } from "../shell/panelLayout.ts";

const PANEL_DEFAULTS: PanelDefault[] = [
	{ id: "system-files" },
	{ id: "editor" },
	{ id: "object-model", colSpan: 2 },
];

const SYS_ROOT = "0:/sys";

/**
 * System — owns the 0:/sys listing and the object-model inspector (no central
 * Files section; each domain owns its files). Clicking a file opens it in the
 * editor. There is deliberately no Run here: sys files are invoked by the
 * firmware (config.g at boot, homeall.g by G28), not fired by hand.
 */
export default function System() {
	const app = useApp();
	const layout = createPanelLayout("dwc-ng.layout.system", PANEL_DEFAULTS);
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
				<button class="layout-reset" onClick={() => layout.reset()}>↺ Reset layout</button>
			</div>
			<div class="grid system">
				<Panel id="system-files" layout={layout} ariaLabel="System files">
					<div class="card-head">
						<h2 class="card-title">System files</h2>
						<span class="des">{dir()}</span>
					</div>
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
				</Panel>

				<Panel id="editor" layout={layout} ariaLabel="Editor" class="editor-card">
					<Show
						when={selected()}
						fallback={
							<>
								<div class="card-head"><h2 class="card-title">Editor</h2></div>
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

				<Panel id="object-model" layout={layout} ariaLabel="Object model" class="om-card">
					<div class="card-head">
						<h2 class="card-title">Object model</h2>
						<span class="des">live · rr_model</span>
					</div>
					<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
						<OmInspector data={app.om.om as unknown as Record<string, unknown>} />
					</Show>
				</Panel>
			</div>
		</>
	);
}
