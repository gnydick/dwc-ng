import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { GcodeButton } from "../control/GcodeButton.tsx";
import { Panel } from "../shell/Panel.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { CONTROL_PANEL_DEFAULTS } from "./control.panelDefaults.ts";

const STEPS = [0.1, 1, 10, 100];

/**
 * Control — the interactive surface (Machine stays a read-only glance). Every
 * control is 1:1 with G-code and wears its command (the signature). No
 * GUI-encoded safety: the firmware is the authority; rejected commands show
 * their reply in the console.
 */
export default function Control() {
	const app = useApp();
	const hasFans = createMemo(() => app.om.om.fans.some(f => f !== null));
	const canvas = createPanelCanvas("dwc-ng.canvas.control", CONTROL_PANEL_DEFAULTS, id => {
		if (id === "camera") return app.config.config.camera.pinned;
		if (id === "fans") return hasFans();
		return true;
	});

	const axes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const role = (letter: string): string | undefined => app.config.config.axisRoles[letter];
	const hasAxis = (letter: string): boolean => axes().some(a => a.letter === letter);
	/** Axes that aren't part of the cardinal XY/Z pad or the coupler — e.g. the
	    U/V/W leadscrews, jogged individually for tramming. */
	const auxAxes = createMemo(() => axes().filter(a => !["X", "Y", "Z", "C"].includes(a.letter)));

	const heaterActive = (modelIndex: number): number =>
		app.om.om.heat.heaters[modelIndex]?.active ?? 0;
	const bedModelIndex = createMemo(() => app.om.om.heat.bedHeaters.find(i => i >= 0) ?? -1);

	const [step, setStep] = createSignal(1);
	const [jogFeed, setJogFeed] = createSignal(6000);
	const [extAmt, setExtAmt] = createSignal(5);
	const [extFeed, setExtFeed] = createSignal(300);
	const [babyStep, setBabyStep] = createSignal(0.02);

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class="control">
				<Panel id="homing" canvas={canvas} ariaLabel="Homing">
					<div class="card-head"><h2 class="card-title">Homing</h2><span class="des">G28</span></div>
					<div class="ctl-wrap">
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
				</Panel>

				<Panel id="tools" canvas={canvas} ariaLabel="Tools">
					<div class="card-head"><h2 class="card-title">Tools</h2><span class="des">T · state.currentTool</span></div>
					<div class="ctl-wrap">
						<For each={app.om.om.tools}>
							{tool => (
								<Show when={tool}>
									{t => (
										<GcodeButton
											label={t().name || `Tool ${t().number}`}
											variant={app.om.om.state.currentTool === t().number ? "go" : undefined}
											command={cmd.selectTool(t().number)}
										/>
									)}
								</Show>
							)}
						</For>
						<GcodeButton label="Deselect" variant="quiet" command={cmd.deselectTool()} />
					</div>
				</Panel>

				<Panel id="heaters" canvas={canvas} ariaLabel="Heaters">
					<div class="card-head"><h2 class="card-title">Heaters</h2><span class="des">M568 · M140</span></div>
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
				</Panel>

				<Panel id="movement" canvas={canvas} ariaLabel="Movement">
					<div class="card-head"><h2 class="card-title">Movement</h2><span class="des">M120 · G91 · M121</span></div>
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
				</Panel>

				<Show when={hasFans()}>
					<Panel id="fans" canvas={canvas} ariaLabel="Fans">
						<div class="card-head"><h2 class="card-title">Fans</h2><span class="des">M106</span></div>
						<div class="heater-list">
							<For each={app.om.om.fans}>
								{(fan, i) => (
									<Show when={fan}>
										{f => <FanControl label={f().name || `Fan ${i()}`} index={i()} value={f().actualValue} />}
									</Show>
								)}
							</For>
						</div>
					</Panel>
				</Show>

				<Panel id="tuning" canvas={canvas} ariaLabel="Tuning">
					<div class="card-head"><h2 class="card-title">Tuning</h2><span class="des">M220 · M221 · M290</span></div>
					<div class="heater-list">
						<FactorControl label="Speed" build={cmd.speedFactor} current={Math.round((app.om.om.move.speedFactor ?? 1) * 100)} />
						<div class="heater-ctl">
							<span class="ctl-name">Babystep Z</span>
							<label class="feed-field">mm <input type="number" step="0.01" value={babyStep()} onInput={e => setBabyStep(Number(e.currentTarget.value))} /></label>
							<div class="btn-cluster">
								<GcodeButton label={`− ${babyStep()}`} command={cmd.babystep(-babyStep())} stamp={false} />
								<GcodeButton label={`+ ${babyStep()}`} command={cmd.babystep(babyStep())} stamp={false} />
							</div>
						</div>
					</div>
				</Panel>

				<ConsolePanel canvas={canvas} />
				<CameraPanel canvas={canvas} />
			</PanelCanvas>
		</>
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

function FactorControl(props: { label: string; build: (pct: number) => string; current: number }) {
	const [pct, setPct] = createSignal(props.current || 100);
	return (
		<div class="heater-ctl">
			<span class="ctl-name">{props.label}</span>
			<label class="temp-field">
				<input type="number" value={pct()} onInput={e => setPct(Number(e.currentTarget.value))} aria-label={`${props.label} percent`} />
				<span class="deg">%</span>
			</label>
			<div class="btn-cluster">
				<GcodeButton label="Set" command={props.build(pct())} stamp={false} />
			</div>
		</div>
	);
}
