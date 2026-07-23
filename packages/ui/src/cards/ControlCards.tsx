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

const STEPS = [0.1, 1, 10, 100];

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

export function HomingBody() {
	const app = useApp();
	const axes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const role = (letter: string): string | undefined => app.config.config.axisRoles[letter];
	return (
		<>
			{/* A grid, not a wrap: axis labels differ in length ("Home All" vs
			    "Home U · Z motor 1"), so flex-wrapping produced six different
			    button widths and six different left edges. Equal columns give
			    one width and aligned rows regardless of what the axes are called. */}
			<div class="ctl-grid">
				<GcodeButton label="Home All" variant="go" command={cmd.homeAll()} />
				<For each={axes()}>
					{axis => (
						<GcodeButton
							label={`Home ${axis.letter}${role(axis.letter) ? ` · ${role(axis.letter)}` : ""}`}
							command={cmd.homeAxis(axis.letter)}
						/>
					)}
				</For>
			</div>
			{/* Releasing drops the homed state the row above establishes, so it
			    belongs in this card. Compact and stamp-free: sixteen full-size
			    buttons would not fit the panel, and the command is already named
			    in the card tip (M84). */}
			<div class="release-row">
				<span class="ctl-name">Release</span>
				<GcodeButton class="rel-key" label="All" variant="danger" command={cmd.releaseAllMotors()} stamp={false} />
				<For each={axes()}>
					{axis => (
						<GcodeButton
							class="rel-key"
							label={axis.letter}
							variant="quiet"
							command={cmd.releaseAxis(axis.letter)}
							stamp={false}
						/>
					)}
				</For>
			</div>
		</>
	);
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

export function MovementBody() {
	const app = useApp();
	const axes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const role = (letter: string): string | undefined => app.config.config.axisRoles[letter];
	const hasAxis = (letter: string): boolean => axes().some(a => a.letter === letter);
	/** Axes that aren't part of the cardinal XY/Z pad or the coupler — e.g. the
	    U/V/W leadscrews, jogged individually for tramming. */
	const auxAxes = createMemo(() => axes().filter(a => !["X", "Y", "Z", "C"].includes(a.letter)));

	const [step, setStep] = createSignal(1);
	const [jogFeed, setJogFeed] = createSignal(6000);
	const [extAmt, setExtAmt] = createSignal(5);
	const [extFeed, setExtFeed] = createSignal(300);

	return (
		<div class="jog-controls">
			<div class="step-row">
				<span class="ctl-name">Step</span>
				<For each={STEPS}>
					{s => (
						<button class="chip-btn" classList={{ active: step() === s }} onClick={() => setStep(s)}>{s} mm</button>
					)}
				</For>
				<label class="feed-field">Feed <input type="number" value={jogFeed()} onInput={e => setJogFeed(Number(e.currentTarget.value))} /></label>
			</div>

			<div class="jog-pad">
				<Show when={hasAxis("X") && hasAxis("Y")}>
					<div class="jog-xy" role="group" aria-label="X/Y jog">
						<GcodeButton class="jog-key pos-yp" label="+Y" command={cmd.jog("Y", step(), jogFeed())} stamp={false} />
						<GcodeButton class="jog-key pos-xn" label="−X" command={cmd.jog("X", -step(), jogFeed())} stamp={false} />
						<span class="jog-center">{step()}<small>mm</small></span>
						<GcodeButton class="jog-key pos-xp" label="+X" command={cmd.jog("X", step(), jogFeed())} stamp={false} />
						<GcodeButton class="jog-key pos-yn" label="−Y" command={cmd.jog("Y", -step(), jogFeed())} stamp={false} />
					</div>
				</Show>
				<Show when={hasAxis("Z")}>
					<div class="jog-z" role="group" aria-label="Z jog">
						<GcodeButton class="jog-key" label="+Z" command={cmd.jog("Z", step(), jogFeed())} stamp={false} />
						<span class="jog-zlabel">Z</span>
						<GcodeButton class="jog-key" label="−Z" command={cmd.jog("Z", -step(), jogFeed())} stamp={false} />
					</div>
				</Show>
			</div>

			<Show when={auxAxes().length > 0}>
				<div class="jog-aux">
					<For each={auxAxes()}>
						{axis => (
							<div class="jog-row">
								<span class="ctl-name">{axis.letter}<Show when={role(axis.letter)}>{r => <small>{r()}</small>}</Show></span>
								<GcodeButton label={`− ${step()}`} command={cmd.jog(axis.letter, -step(), jogFeed())} stamp={false} />
								<GcodeButton label={`+ ${step()}`} command={cmd.jog(axis.letter, step(), jogFeed())} stamp={false} />
							</div>
						)}
					</For>
				</div>
			</Show>

			<Show when={hasAxis("C")}>
				<div class="coupler-row">
					<span class="ctl-name">Coupler <small>C</small></span>
					<GcodeButton label="Lock" command={cmd.couplerLock()} />
					<GcodeButton label="Unlock" variant="quiet" command={cmd.couplerUnlock()} />
				</div>
			</Show>
			<div class="extrude-row">
				<span class="ctl-name">Extruder</span>
				<label class="feed-field">mm <input type="number" value={extAmt()} onInput={e => setExtAmt(Number(e.currentTarget.value))} /></label>
				<label class="feed-field">F <input type="number" value={extFeed()} onInput={e => setExtFeed(Number(e.currentTarget.value))} /></label>
				<GcodeButton label="Retract" command={cmd.extrude(-extAmt(), extFeed())} stamp={false} />
				<GcodeButton label="Extrude" command={cmd.extrude(extAmt(), extFeed())} stamp={false} />
			</div>
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
