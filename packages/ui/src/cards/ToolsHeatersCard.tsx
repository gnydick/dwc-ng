import { For, Show, createMemo, createResource, createSignal, type Resource } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import { HeaterState } from "./HeaterState.tsx";
import type { Heater, Tool } from "../om/types.ts";
import type { Orientation } from "../shell/panelOrientation.ts";

const FILAMENTS_DIR = "0:/filaments";

/**
 * Tools & heaters — the interactive per-tool hub. One block per tool: name +
 * dock-presence dot + current temperature + heater setpoint control (Active /
 * Standby / Off, M568) + filament load/unload (M701/M702/M703) for tools that
 * feed an extruder + the M562 fault reset. The bed gets a heater block with no
 * standby and no filament.
 *
 * Every control is 1:1 with a G-code (project rule); the firmware is the
 * authority. Filaments live under 0:/filaments as directories — picking one
 * here is choosing a material, not browsing files.
 *
 * Content-only body; chrome comes from the compose registry
 * (compose/defs.ts "tools-heaters"). Vertical stack or horizontal strip via the
 * orientation toggle.
 */
export function ToolsHeatersBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	// Mirrors the tool-change P parameter: off sends P0, skipping the filament's
	// own load.g/unload.g (what you want when a macro would drive an axis you
	// don't). Shared across the card's rows, as the old Filament card did.
	const [runMacros, setRunMacros] = createSignal(true);

	const connected = (): boolean => app.om.connection.status === "connected";
	const [filaments] = createResource(
		() => (connected() ? FILAMENTS_DIR : false),
		async dir => {
			const entries = await app.connector.list(dir as string);
			// Each filament is a DIRECTORY holding load.g/unload.g/config.g.
			return entries.filter(e => e.type === "d").map(e => e.name).sort((a, b) => a.localeCompare(b));
		},
	);

	const bedHeaterIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);
	const bedHeater = (): Heater | null => app.om.om.heat.heaters[bedHeaterIndex()] ?? null;

	// Any tool feeds an extruder → the filament apparatus is relevant; with none,
	// the macros toggle would qualify controls that never render.
	const anyFeeder = createMemo(() => app.om.om.tools.some(t => t !== null && t.filamentExtruder >= 0));

	return (
		<div class="th-hub" classList={{ horizontal: props.orientation() === "horizontal" }}>
			<Show when={anyFeeder()}>
				<label class="filament-macros">
					<input type="checkbox" checked={runMacros()} onChange={e => setRunMacros(e.currentTarget.checked)} />
					<span>Run macros</span>
					<span class="filament-macros-hint">{runMacros() ? "load.g / unload.g run" : "P0 — macros skipped"}</span>
				</label>
			</Show>

			<For each={app.om.om.tools}>
				{tool => (
					<Show when={tool}>
						{t => <ToolRow tool={t()} filaments={filaments} runMacros={runMacros} />}
					</Show>
				)}
			</For>

			<Show when={bedHeater()}>
				{h => <BedRow heater={h()} index={bedHeaterIndex()} />}
			</Show>
		</div>
	);
}

/** One tool: identity + heater control + (when it feeds an extruder) filament. */
function ToolRow(props: { tool: Tool; filaments: Resource<string[]>; runMacros: () => boolean }) {
	const app = useApp();

	const heaterIndex = (): number => props.tool.heaters[0] ?? -1;
	const heater = (): Heater | null => app.om.om.heat.heaters[heaterIndex()] ?? null;

	// Seeded once from this tool's current active setpoint; from then on it is
	// the operator's target. One ToolRow per tool, so a live temperature change
	// can never overwrite what is being typed.
	const seed = heater();
	const [target, setTarget] = createSignal(seed !== null && seed.active > 0 ? seed.active : 0);

	const isCurrent = (): boolean => app.om.om.state.currentTool === props.tool.number;
	/** Only prepend a T-code when this tool isn't already the selected one. */
	const selectFirst = (): number | undefined => (isCurrent() ? undefined : props.tool.number);

	const isFeeder = (): boolean => props.tool.filamentExtruder >= 0;
	const loaded = (): string => app.om.om.move.extruders[props.tool.filamentExtruder]?.filament ?? "";
	const [choice, setChoice] = createSignal("");
	const selected = (): string => choice() || props.filaments()?.[0] || "";

	const label = (): string => props.tool.name || `Tool ${props.tool.number}`;

	/** docked/away from the user-mapped gpIn sensor; null = unknowable. */
	const dockState = (): "docked" | "away" | null => {
		const ref = app.config.config.dockSensors[String(props.tool.number)];
		if (ref === undefined) return null;
		const gpIn = app.om.om.sensors.gpIn[ref.gpIn];
		if (gpIn === null || gpIn === undefined) return null;
		const active = gpIn.value >= 0.5;
		return (ref.inverted ? !active : active) ? "docked" : "away";
	};

	return (
		<div class="th-tool" classList={{ current: isCurrent() }}>
			<div class="th-head">
				<span class="heat-name">
					<span class="heat-tool">{label()}</span>
					<span class="des">T{props.tool.number}</span>
					{/* Dock presence: green = docked, gold = away. Kept from the
					    read-only card — a single dot, no column to scroll off. */}
					<Show when={dockState()}>
						{state => (
							<span
								class={`dock-dot ${state()}`}
								title={state() === "docked" ? "Docked" : "Away"}
								aria-label={state() === "docked" ? "Docked" : "Away"}
							/>
						)}
					</Show>
				</span>
				<Show when={heater()} fallback={<span class="th-no-heater">no heater</span>}>
					{h => (
						<>
							<HeaterCurrent heater={h()} />
							<HeaterState heater={h()} index={heaterIndex()} />
						</>
					)}
				</Show>
				<GcodeButton
					label={isCurrent() ? "Selected" : "Select"}
					variant={isCurrent() ? "go" : "quiet"}
					stamp={false}
					command={cmd.selectTool(props.tool.number)}
				/>
			</div>

			<Show when={heater()}>
				<div class="th-line">
					<label class="temp-field">
						<input
							type="number"
							value={target()}
							onInput={e => setTarget(Number(e.currentTarget.value))}
							aria-label={`${label()} target`}
						/>
						<span class="deg">°C</span>
					</label>
					<div class="btn-cluster">
						<GcodeButton label="Active" variant="go" command={cmd.toolActive(props.tool.number, target())} stamp={false} />
						<GcodeButton label="Standby" command={cmd.toolStandby(props.tool.number, target())} stamp={false} />
						<GcodeButton label="Off" variant="danger" command={cmd.toolOff(props.tool.number)} stamp={false} />
					</div>
				</div>
			</Show>

			<Show when={isFeeder()}>
				<div class="th-line">
					<select
						class="filament-pick"
						aria-label={`Filament for ${label()}`}
						value={selected()}
						onInput={e => setChoice(e.currentTarget.value)}
					>
						<For each={props.filaments() ?? []}>{name => <option value={name}>{name}</option>}</For>
					</select>
					{/* Reserved width: flips between a name and an em dash on every load
					    and must not shove the row when it does. */}
					<span class="filament-loaded" classList={{ none: loaded() === "" }}>{loaded() || "—"}</span>
					<div class="btn-cluster">
						<GcodeButton
							label="Load"
							variant="go"
							stamp={false}
							disabled={selected() === ""}
							command={cmd.loadFilament(selected(), { selectTool: selectFirst(), runMacros: props.runMacros() })}
						/>
						<GcodeButton
							label="Unload"
							variant="danger"
							stamp={false}
							disabled={loaded() === ""}
							command={cmd.unloadFilament({ selectTool: selectFirst(), runMacros: props.runMacros() })}
						/>
					</div>
				</div>
			</Show>
		</div>
	);
}

/** The bed: a heater with no standby mode and no filament. */
function BedRow(props: { heater: Heater; index: number }) {
	const [target, setTarget] = createSignal(props.heater.active > 0 ? props.heater.active : 0);
	return (
		<div class="th-tool th-bed">
			<div class="th-head">
				<span class="heat-name">
					<span class="heat-tool">Bed</span>
					<span class="des">heater{props.index}</span>
				</span>
				<HeaterCurrent heater={props.heater} />
				<HeaterState heater={props.heater} index={props.index} />
			</div>
			<div class="th-line">
				<label class="temp-field">
					<input
						type="number"
						value={target()}
						onInput={e => setTarget(Number(e.currentTarget.value))}
						aria-label="Bed target"
					/>
					<span class="deg">°C</span>
				</label>
				<div class="btn-cluster">
					<GcodeButton label="Active" variant="go" command={cmd.bedActive(0, target())} stamp={false} />
					{/* the bed has no standby mode — no standby button, ever */}
					<GcodeButton label="Off" variant="danger" command={cmd.bedOff(0)} stamp={false} />
				</div>
			</div>
		</div>
	);
}

function HeaterCurrent(props: { heater: Heater }) {
	return (
		<span
			class="heat-cur"
			classList={{
				"t-cold": props.heater.current < 45,
				"t-warm": props.heater.current >= 45 && props.heater.current < 160,
				"t-hot": props.heater.current >= 160,
			}}
		>
			{props.heater.current.toFixed(1)}<small>°C</small>
		</span>
	);
}
