import { For, Show, Switch, Match, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { FileEditor } from "../editor/FileEditor.tsx";
import type { FileListEntry } from "../connector/types.ts";

const MACROS_ROOT = "0:/macros";

/**
 * Macros — this domain owns the 0:/macros listing (no central Files section).
 * A click OPENS a macro in the editor; it never runs it. Running is a separate,
 * explicit ▶ Run button (M98), matching DWC's deliberate run-with-confirm and
 * the project's "files never run on click" rule.
 */
export default function Macros() {
	const app = useApp();
	const connected = (): boolean => app.om.connection.status === "connected";

	const [dir, setDir] = createSignal(MACROS_ROOT);
	const [selected, setSelected] = createSignal<string | null>(null);
	const [armed, setArmed] = createSignal<string | null>(null); // path awaiting run-confirm

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

	const open = (entry: FileListEntry): void => {
		setArmed(null);
		if (entry.type === "d") {
			setSelected(null);
			setDir(pathOf(entry));
		} else {
			setSelected(pathOf(entry));
		}
	};

	// Two-step run: first click arms, second click fires — no modal, but no
	// single-click machine action either.
	const run = (entry: FileListEntry): void => {
		const path = pathOf(entry);
		if (armed() !== path) {
			setArmed(path);
			return;
		}
		setArmed(null);
		void app.connector.sendCode(`M98 P"${path}"`).catch(() => undefined);
	};

	const goUp = (): void => {
		setSelected(null);
		setArmed(null);
		setDir(dir().slice(0, dir().lastIndexOf("/")) || MACROS_ROOT);
	};

	return (
		<div class="grid macros">
			<section class="card" aria-label="Macros">
				<div class="card-head">
					<h2 class="card-title">Macros</h2>
					<span class="des">{dir()}</span>
				</div>
				<Show when={connected()} fallback={<p class="job-empty">Not connected.</p>}>
					<Show when={dir() !== MACROS_ROOT}>
						<button class="link-btn" onClick={goUp}>← up a level</button>
					</Show>
					<ul class="file-list">
						<For each={sorted()} fallback={<li class="job-empty">No macros here.</li>}>
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
											<button
												class="run-btn"
												classList={{ armed: armed() === pathOf(entry) }}
												title={`Run ${entry.name} (M98)`}
												onClick={() => run(entry)}
											>
												{armed() === pathOf(entry) ? "Confirm" : "▶ Run"}
											</button>
										</Match>
									</Switch>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</section>

			<section class="card editor-card" aria-label="Editor">
				<Show
					when={selected()}
					fallback={
						<>
							<div class="card-head"><h2 class="card-title">Editor</h2></div>
							<p class="job-empty">
								Select a macro to view or edit it. Opening never runs it — use the
								explicit ▶ Run button (click twice to confirm).
							</p>
						</>
					}
				>
					{path => <FileEditor path={path()} lang="gcode" onClose={() => setSelected(null)} />}
				</Show>
			</section>
		</div>
	);
}
