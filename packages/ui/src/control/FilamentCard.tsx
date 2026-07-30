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
	/** Manual feed, in the footer row. Card-local, like every other step size. */
	const [feedMm, setFeedMm] = createSignal(5);
	const [feedRate, setFeedRate] = createSignal(300);

	/** The tool a manual feed will move, or -1 for none. */
	const current = (): number => app.om.om.state.currentTool;

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

	// The two "All" buttons are convenience COMPOUNDS: the same per-tool command
	// this card already sends, once per tool, newline-joined the way rr_gcode
	// takes a bundle. No new G-code and no new logic — just the row you would
	// have clicked, for every row.
	//
	// Every entry carries its OWN T-code, unconditionally, unlike the per-row
	// buttons that skip it for the current tool. Inside a bundle "the current
	// tool" moves as the bundle runs: the first entry selects T0, so a later
	// entry that omitted its T because T1 was current when the button was drawn
	// would load T0's filament twice. Naming each tool cannot go wrong.
	const loadable = createMemo(() => feeders().filter(t => selected(t) !== ""));
	const unloadable = createMemo(() => feeders().filter(t => loaded(t) !== ""));
	const loadAll = (): string =>
		loadable()
			.map(t => cmd.loadFilament(selected(t), { selectTool: t.number, runMacros: runMacros() }))
			.join("\n");
	const unloadAll = (): string =>
		unloadable()
			.map(t => cmd.unloadFilament({ selectTool: t.number, runMacros: runMacros() }))
			.join("\n");

	return (
		<Show
			when={feeders().length > 0}
			fallback={<p class="job-empty">No tools on this machine feed filament.</p>}
		>
			{/* One grid for the whole card, head row included, so the two All
			    buttons sit in the SAME tracks as the Load and Unload beneath
			    them — above their own column by construction, not by two
			    layouts agreeing on a width. */}
			<div class="filament-list">
				<div class="filament-row filament-head">
					<GcodeButton
						label="All"
						variant="go"
						stamp={false}
						disabled={loadable().length === 0}
						command={loadAll()}
						ariaLabel="Load filament on every tool"
					/>
					<GcodeButton
						label="All"
						variant="danger"
						stamp={false}
						disabled={unloadable().length === 0}
						command={unloadAll()}
						ariaLabel="Unload filament from every tool"
					/>
					{/* Right-hand end of the head row: this governs every button in
					    the card, so it reads as the card's own switch rather than as
					    the first row's label. */}
					<label class="filament-macros">
						<input type="checkbox" checked={runMacros()} onChange={e => setRunMacros(e.currentTarget.checked)} />
						<span>Run macros</span>
						<span class="filament-macros-hint">
							{runMacros() ? "load.g / unload.g run" : "P0 — macros skipped"}
						</span>
					</label>
				</div>

				{/* The rows are NOT gated on the material list. An extruder exists
				    whether or not the machine knows any materials, and Unload acts
				    on what is already loaded — so an empty 0:/filaments used to
				    delete the whole tool listing along with the picker, taking
				    Unload with it. The empty list is a note beneath the rows now,
				    and Load disables itself per row for want of a selection. */}
				<Show when={!filaments.loading && (filaments() ?? []).length === 0}>
					<p class="job-empty filament-note">No filaments in {FILAMENTS_DIR}.</p>
				</Show>
				<Show when={filaments.loading}>
					<p class="job-empty filament-note">Reading filaments…</p>
				</Show>
				<For each={feeders()}>
						{tool => (
							// is-current is not decoration: the Feed row below acts on
							// whichever tool is selected, so this marks the row those
							// buttons will move.
							<div class="filament-row" classList={{ "is-current": tool.number === current() }}>
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

				{/* Feed the CURRENT tool. G1 E has no tool parameter — it moves
				    whichever extruder is selected — so this row sits below the
				    per-tool rows as a machine-wide footer, and the row it will
				    actually move is marked above. Without that mark these are two
				    buttons whose effect you have to remember the tool state to
				    predict. */}
				<div class="filament-row filament-feed">
					<GcodeButton
						label="Retract"
						variant="danger"
						stamp={false}
						disabled={current() < 0}
						command={cmd.extrude(-feedMm(), feedRate())}
					/>
					<GcodeButton
						label="Extrude"
						variant="go"
						stamp={false}
						disabled={current() < 0}
						command={cmd.extrude(feedMm(), feedRate())}
					/>
					<span class="ctl-name">Feed</span>
					<span class="filament-feed-fields">
						<label class="feed-field feed-mm">
							<input
								type="number"
								value={feedMm()}
								onInput={e => setFeedMm(Number(e.currentTarget.value))}
								aria-label="Feed distance"
							/>
							mm
						</label>
						<label class="feed-field feed-rate">
							<input
								type="number"
								value={feedRate()}
								onInput={e => setFeedRate(Number(e.currentTarget.value))}
								aria-label="Feed rate"
							/>
							F
						</label>
					</span>
					{/* Which tool these two will move, in the column that already
					    answers "what is on this extruder". */}
					<span class="filament-loaded" classList={{ none: current() < 0 }}>
						{current() < 0 ? "no tool" : `Tool ${current()}`}
					</span>
				</div>
			</div>
		</Show>
	);
}
