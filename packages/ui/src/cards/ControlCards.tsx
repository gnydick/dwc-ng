/**
 * The Control surface's eight card bodies — every control 1:1 with G-code,
 * wearing its command (the signature). No GUI-encoded safety: the firmware is
 * the authority; rejected commands show their reply in the console.
 *
 * Extracted from views/Control.tsx in the A4 conversion. All state here is
 * card-local (step sizes, feeds, targets) — none of it crosses cards, which
 * is what made this a pure extraction. Chrome/visibility live in
 * compose/defs.ts; these are content-only bodies.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import { SpeedSlider } from "../control/SpeedSlider.tsx";
import { FilamentCard } from "../control/FilamentCard.tsx";
import { isManualFan } from "../om/fans.ts";
import type { Orientation } from "../shell/panelOrientation.ts";

/**
 * Human reading of RRF's tool-change macro bitmask (1 tfree | 2 tpre | 4 tpost).
 * undefined means no P is sent at all, which lets the firmware run all three.
 */
function describeToolP(p: number | undefined): string {
	if (p === undefined) return "all macros (no P sent)";
	if (p === 0) return "no macros";
	const parts: string[] = [];
	if (p & 1) parts.push("tfree");
	if (p & 2) parts.push("tpre");
	if (p & 4) parts.push("tpost");
	return parts.join(" · ");
}

export function AtxBody() {
	return (
		<div class="ctl-wrap">
			<GcodeButton label="PSU On" variant="go" command={cmd.atxPower(true)} />
			<GcodeButton label="PSU Off" variant="danger" command={cmd.atxPower(false)} />
		</div>
	);
}

export function FilamentBody() {
	const app = useApp();
	return <FilamentCard tools={app.om.om.tools} />;
}

export function HeatersBody() {
	const app = useApp();
	// Blank means "send no P", which is not the same as P0 - see cmd.selectTool.
	const [toolP, setToolP] = createSignal("");
	const toolPValue = (): number | undefined => {
		const raw = toolP().trim();
		if (raw === "") return undefined;
		const v = Number(raw);
		return Number.isInteger(v) && v >= 0 && v <= 7 ? v : undefined;
	};
	const heaterActive = (modelIndex: number): number =>
		app.om.om.heat.heaters[modelIndex]?.active ?? 0;
	const bedModelIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);
	return (
		<>
			{/* Deselect and the tool-change bitmask act on the machine, not on one
			    tool, so they sit above the rows. P blank sends no P at all; P0
			    suppresses tfree/tpre/tpost, decoded beside the field. */}
			<div class="tool-p">
				<GcodeButton label="Deselect" variant="quiet" stamp={false} command={cmd.deselectTool(toolPValue())} />
				<label class="feed-field">
					P
					<input
						type="number"
						min="0"
						max="7"
						placeholder="all"
						value={toolP()}
						onInput={e => setToolP(e.currentTarget.value)}
						aria-label="Tool change macro bitmask"
					/>
				</label>
				<span class="tool-p-decode">{describeToolP(toolPValue())}</span>
			</div>
			<div class="heater-list">
				<For each={app.om.om.tools}>
					{tool => (
						<Show when={tool}>
							{t => (
								<HeaterControl
									label={t().name || `Tool ${t().number}`}
									kind="tool"
									num={t().number}
									active={heaterActive(t().heaters[0] ?? -1)}
									selectCommand={cmd.selectTool(t().number, toolPValue())}
									current={app.om.om.state.currentTool === t().number}
								/>
							)}
						</Show>
					)}
				</For>
				<Show when={bedModelIndex() >= 0}>
					<HeaterControl label="Bed" kind="bed" num={0} active={heaterActive(bedModelIndex())} />
				</Show>
			</div>
		</>
	);
}

export function FansBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	return (
		<div class="heater-list" classList={{ horizontal: props.orientation() === "horizontal" }}>
			<For each={app.om.om.fans}>
				{(fan, i) => (
					<Show when={isManualFan(fan) ? fan : undefined}>
						{f => <FanControl label={f().name || `Fan ${i()}`} index={i()} value={f().actualValue} rpm={f().rpm} />}
					</Show>
				)}
			</For>
		</div>
	);
}

export function TuningBody() {
	const app = useApp();
	const [babyStep, setBabyStep] = createSignal(0.02);
	// The machine's own accumulated offset (move.axes[].babystep) — the
	// firmware reports it, we only mirror. Signed and fixed-width so the
	// readout can't jitter the row as it changes.
	const applied = createMemo(() => {
		const z = app.om.om.move.axes.find(a => a.letter === "Z");
		return z?.babystep ?? 0;
	});
	const appliedLabel = (): string => `${applied() > 0 ? "+" : ""}${applied().toFixed(2)}`;
	return (
		<div class="heater-list">
			<SpeedSlider currentPct={Math.round((app.om.om.move.speedFactor ?? 1) * 100)} />
			<div class="heater-ctl">
				<span class="ctl-name">Babystep Z</span>
				<span
					class="baby-applied"
					classList={{ "is-live": applied() !== 0 }}
					title="Accumulated Z babystep the firmware is applying (move.axes Z.babystep)"
				>
					{appliedLabel()}
				</span>
				<label class="feed-field">mm <input type="number" step="0.01" value={babyStep()} onInput={e => setBabyStep(Number(e.currentTarget.value))} /></label>
				<div class="btn-cluster">
					<GcodeButton label={`− ${babyStep()}`} command={cmd.babystep(-babyStep())} stamp={false} />
					<GcodeButton label={`+ ${babyStep()}`} command={cmd.babystep(babyStep())} stamp={false} />
					<GcodeButton label="Zero" command={cmd.babystepZero()} variant="quiet" stamp={false} />
				</div>
			</div>
		</div>
	);
}

function HeaterControl(props: {
	label: string;
	kind: "tool" | "bed";
	num: number;
	active: number;
	/** Present only for a selectable tool; the bed has none. */
	selectCommand?: string;
	current?: boolean;
}) {
	const [temp, setTemp] = createSignal(props.active > 0 ? props.active : 0);
	const activeCmd = () => (props.kind === "bed" ? cmd.bedActive(props.num, temp()) : cmd.toolActive(props.num, temp()));
	const offCmd = () => (props.kind === "bed" ? cmd.bedOff(props.num) : cmd.toolOff(props.num));
	return (
		<div class="heater-ctl">
			{/* A tool's own label IS its selector (T<n>) - the thing you read is the
			    thing you click. The bed is not selectable and stays a plain label. */}
			<Show when={props.selectCommand} fallback={<span class="ctl-name">{props.label}</span>}>
				{command => (
					<GcodeButton
						class="ctl-name tool-select"
						label={props.label}
						variant={props.current ? "go" : "quiet"}
						stamp={false}
						command={command()}
					/>
				)}
			</Show>
			<label class="temp-field">
				<input type="number" value={temp()} onInput={e => setTemp(Number(e.currentTarget.value))} aria-label={`${props.label} target`} />
				<span class="deg">°C</span>
			</label>
			<div class="btn-cluster">
				<GcodeButton label="Active" variant="go" command={activeCmd()} stamp={false} />
				<Show when={props.kind === "tool"}>
					<GcodeButton label="Standby" command={cmd.toolStandby(props.num, temp())} stamp={false} />
				</Show>
				<GcodeButton label="Off" variant="danger" command={offCmd()} stamp={false} />
			</div>
		</div>
	);
}

function FanControl(props: { label: string; index: number; value: number; rpm: number }) {
	const [pct, setPct] = createSignal(Math.round((props.value ?? 0) * 100));
	return (
		<div class="heater-ctl">
			<span class="ctl-name">{props.label}</span>
			{/* Live tacho reading — shown only when a tacho is configured
			    (rpm >= 0; RRF reports -1 otherwise). Tabular figures on a
			    reserved width so the per-poll value never jitters the row. */}
			<Show when={props.rpm >= 0}>
				<span class="fan-rpm" title="Tacho reading (fans[].rpm)">{props.rpm}<small>rpm</small></span>
			</Show>
			<label class="temp-field">
				<input type="number" min="0" max="100" value={pct()} onInput={e => setPct(Number(e.currentTarget.value))} aria-label={`${props.label} percent`} />
				<span class="deg">%</span>
			</label>
			<div class="btn-cluster">
				<GcodeButton label="Set" command={cmd.fan(props.index, pct())} stamp={false} />
				<GcodeButton label="Off" variant="quiet" command={cmd.fan(props.index, 0)} stamp={false} />
			</div>
		</div>
	);
}
