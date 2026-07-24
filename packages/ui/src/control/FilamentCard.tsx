import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "./commands.ts";
import { GcodeButton } from "./GcodeButton.tsx";
import type { Tool } from "../om/types.ts";

const FILAMENTS_DIR = "0:/filaments";

/**
 * Filament load/unload per tool (M701/M702, then M703 to apply the filament's
 * own config).
 *
 * Filaments live as directories under 0:/filaments, but this is deliberately
 * NOT a file listing: what you pick here is a material, and the directory is
 * just where RRF keeps its macros. (Project rule: filaments are machine
 * management, not a file type.)
 *
 * "Run macros" mirrors the tool-change P parameter — off sends P0, skipping the
 * filament's own load/unload macros, which is what you want when a macro would
 * drive an axis you don't want moving.
 */
export function FilamentCard(props: { tools: (Tool | null)[] }) {
	const app = useApp();
	const [runMacros, setRunMacros] = createSignal(true);
	/** Chosen filament per tool number — what Load will send. */
	const [choice, setChoice] = createSignal<Record<number, string>>({});

	const connected = (): boolean => app.om.connection.status === "connected";

	const [filaments] = createResource(
		() => (connected() ? FILAMENTS_DIR : false),
		async dir => {
			const entries = await app.connector.list(dir as string);
			// Each filament is a DIRECTORY holding load.g/unload.g/config.g.
			return entries.filter(e => e.type === "d").map(e => e.name).sort((a, b) => a.localeCompare(b));
		},
	);

	/** Tools that actually feed an extruder — the rest cannot hold filament. */
	const feeders = createMemo(() =>
		props.tools.filter((t): t is Tool => t !== null && t.filamentExtruder >= 0),
	);

	/** Filament currently loaded on a tool's extruder, or "" when none. */
	const loaded = (tool: Tool): string =>
		app.om.om.move.extruders[tool.filamentExtruder]?.filament ?? "";

	const selected = (tool: Tool): string => choice()[tool.number] ?? filaments()?.[0] ?? "";

	/** Only prepend a T-code when this tool isn't already the selected one. */
	const selectFirst = (tool: Tool): number | undefined =>
		app.om.om.state.currentTool === tool.number ? undefined : tool.number;

	return (
		<Show
			when={feeders().length > 0}
			fallback={<p class="job-empty">No tools on this machine feed filament.</p>}
		>
			<label class="filament-macros">
				<input type="checkbox" checked={runMacros()} onChange={e => setRunMacros(e.currentTarget.checked)} />
				<span>Run macros</span>
				<span class="filament-macros-hint">
					{runMacros() ? "load.g / unload.g run" : "P0 — macros skipped"}
				</span>
			</label>

			<Show
				when={(filaments() ?? []).length > 0}
				fallback={
					<p class="job-empty">
						{filaments.loading ? "Reading filaments…" : `No filaments in ${FILAMENTS_DIR}.`}
					</p>
				}
			>
				<div class="filament-list">
					<For each={feeders()}>
						{tool => (
							<div class="filament-row">
								<GcodeButton
									label="Load"
									variant="go"
									stamp={false}
									disabled={selected(tool) === ""}
									command={cmd.loadFilament(selected(tool), {
										selectTool: selectFirst(tool),
										runMacros: runMacros(),
									})}
								/>
								<GcodeButton
									label="Unload"
									variant="danger"
									stamp={false}
									disabled={loaded(tool) === ""}
									command={cmd.unloadFilament({
										selectTool: selectFirst(tool),
										runMacros: runMacros(),
									})}
								/>
								<span class="ctl-name">{tool.name || `Tool ${tool.number}`}</span>
								<select
									class="filament-pick"
									aria-label={`Filament for ${tool.name || `Tool ${tool.number}`}`}
									value={selected(tool)}
									onInput={e => setChoice({ ...choice(), [tool.number]: e.currentTarget.value })}
								>
									<For each={filaments() ?? []}>{name => <option value={name}>{name}</option>}</For>
								</select>
								{/* Reserved width: this flips between a name and an em dash on
								    every load, and must not shove the row around when it does. */}
								<span class="filament-loaded" classList={{ none: loaded(tool) === "" }}>
									{loaded(tool) || "—"}
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</Show>
	);
}
