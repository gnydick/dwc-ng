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

export function ToolsBody() {
	const app = useApp();
	// Blank means "send no P", which is not the same as P0 - see cmd.selectTool.
	const [toolP, setToolP] = createSignal("");
	const toolPValue = (): number | undefined => {
		const raw = toolP().trim();
		if (raw === "") return undefined;
		const v = Number(raw);
		return Number.isInteger(v) && v >= 0 && v <= 7 ? v : undefined;
	};
	return (
		<>
			{/* RRF's tool-change macro bitmask. Blank sends no P at all, letting
			    the firmware run tfree/tpre/tpost as usual; P0 suppresses all
			    three. Kept as the raw number the G-code takes (1:1 with the
			    command) with the meaning decoded beside it, rather than hidden
			    behind three checkboxes that would have to be translated back. */}
			<div class="tool-p">
				{/* First in the row: P is what separates a plain T-1 from one that skips
				    the tool-change macros, so the button and the value it carries are read
				    together - the action first, then the parameter qualifying it. */}
				<GcodeButton label="Deselect" variant="quiet" command={cmd.deselectTool(toolPValue())} />
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
			<div class="ctl-wrap">
				<For each={app.om.om.tools}>
					{tool => (
						<Show when={tool}>
							{t => (
								<GcodeButton
									label={t().name || `Tool ${t().number}`}
									variant={app.om.om.state.currentTool === t().number ? "go" : undefined}
									command={cmd.selectTool(t().number, toolPValue())}
								/>
							)}
						</Show>
					)}
				</For>
			</div>
		</>
	);
}

export function FilamentBody() {
	const app = useApp();
	return <FilamentCard tools={app.om.om.tools} />;
}

export function HeatersBody() {
	const app = useApp();
	const heaterActive = (modelIndex: number): number =>
		app.om.om.heat.heaters[modelIndex]?.active ?? 0;
	const bedModelIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);
	return (
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
							/>
						)}
					</Show>
				)}
			</For>
			<Show when={bedModelIndex() >= 0}>
				<HeaterControl label="Bed" kind="bed" num={0} active={heaterActive(bedModelIndex())} />
			</Show>
		</div>
	);
}

export function FansBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	return (
		<div class="heater-list" classList={{ horizontal: props.orientation() === "horizontal" }}>
			<For each={app.om.om.fans}>
				{(fan, i) => (
					<Show when={isManualFan(fan) ? fan : undefined}>
						{f => <FanControl label={f().name || `Fan ${i()}`} index={i()} value={f().actualValue} />}
					</Show>
				)}
			</For>
		</div>
	);
}

export function TuningBody() {
	const app = useApp();
	const [babyStep, setBabyStep] = createSignal(0.02);
	return (
		<div class="heater-list">
			<SpeedSlider currentPct={Math.round((app.om.om.move.speedFactor ?? 1) * 100)} />
			<div class="heater-ctl">
				<span class="ctl-name">Babystep Z</span>
				<label class="feed-field">mm <input type="number" step="0.01" value={babyStep()} onInput={e => setBabyStep(Number(e.currentTarget.value))} /></label>
				<div class="btn-cluster">
					<GcodeButton label={`− ${babyStep()}`} command={cmd.babystep(-babyStep())} stamp={false} />
					<GcodeButton label={`+ ${babyStep()}`} command={cmd.babystep(babyStep())} stamp={false} />
				</div>
			</div>
		</div>
	);
}

function HeaterControl(props: { label: string; kind: "tool" | "bed"; num: number; active: number }) {
	const [temp, setTemp] = createSignal(props.active > 0 ? props.active : 0);
	const activeCmd = () => (props.kind === "bed" ? cmd.bedActive(props.num, temp()) : cmd.toolActive(props.num, temp()));
	const offCmd = () => (props.kind === "bed" ? cmd.bedOff(props.num) : cmd.toolOff(props.num));
	return (
		<div class="heater-ctl">
			<span class="ctl-name">{props.label}</span>
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

function FanControl(props: { label: string; index: number; value: number }) {
	const [pct, setPct] = createSignal(Math.round((props.value ?? 0) * 100));
	return (
		<div class="heater-ctl">
			<span class="ctl-name">{props.label}</span>
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
