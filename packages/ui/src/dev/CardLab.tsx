import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { AppContext, type AppServices, useApp } from "../shell/context.ts";
import { createTemperatureHistory } from "../om/temperature.ts";
import type { OmStore, ConnectionState } from "../om/store.ts";
import type { ConsoleLine } from "../om/consoleLog.ts";
import type { ObjectModel } from "../om/types.ts";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { Card } from "../shell/Card.tsx";
import { createPanelCanvas, type PanelCanvasController, type PanelDefault } from "../shell/panelCanvas.ts";
import { PositionCard } from "../cards/PositionCard.tsx";
import { ToolsHeatersCard } from "../cards/ToolsHeatersCard.tsx";
import { SensorsCard } from "../cards/SensorsCard.tsx";
import { TemperaturesCard } from "../cards/TemperaturesCard.tsx";
import { ActiveJobCard } from "../cards/ActiveJobCard.tsx";
import { BuildObjects } from "../cards/BuildObjects.tsx";
import { HeaterState } from "../cards/HeaterState.tsx";
import { ConsolePanel } from "../shell/ConsolePanel.tsx";
import { CameraPanel } from "../shell/CameraPanel.tsx";
import { SCENARIOS, scenarioModel, type ScenarioId } from "./cardScenarios.ts";
import { createStubConnector } from "./stubConnector.ts";

/**
 * Card Lab (dev-only): render one card at a time against a synthetic object
 * model you can switch between states — idle, printing, paused, heater fault,
 * multi-tool — without a board or even the mock. It fixes the recurring pain of
 * a card whose interesting state (mid-print, a fault) can't be seen on an idle
 * machine.
 *
 * The lab supplies its OWN AppContext: a synthetic OM store, the real config
 * (so your axis-role / sensor labels show), a stub connector that echoes
 * G-code into the console instead of sending it, and a temp history over the
 * synthetic model. Cards are unmodified — they read the same useApp() and can't
 * tell they're in the lab.
 */

/** A card the lab can feature. `panelId` is the id the card's own <Panel> uses
 *  (so the canvas keys its geometry correctly). */
interface LabCard {
	key: string;
	label: string;
	panelId: string;
	render: (canvas: PanelCanvasController) => JSX.Element;
}

const LAB_CARDS: LabCard[] = [
	{ key: "position", label: "Position", panelId: "position", render: c => <PositionCard canvas={c} /> },
	{ key: "tools-heaters", label: "Tools & Heaters", panelId: "tools-heaters", render: c => <ToolsHeatersCard canvas={c} /> },
	{ key: "temperatures", label: "Temperatures", panelId: "temperatures", render: c => <TemperaturesCard canvas={c} /> },
	{ key: "sensors", label: "Sensors", panelId: "sensors", render: c => <SensorsCard canvas={c} /> },
	{ key: "job-compact", label: "Printing (compact)", panelId: "active-job", render: c => <ActiveJobCard canvas={c} /> },
	{ key: "job-detailed", label: "Printing (detailed)", panelId: "active-job", render: c => <ActiveJobCard canvas={c} detailed /> },
	{ key: "heater", label: "Heater", panelId: "heater", render: c => (
		<Card id="heater" canvas={c} ariaLabel="Heater" title="Heater" tip="heat.heaters">
			<HeaterTile />
		</Card>
	) },
	{ key: "objects", label: "Objects (M486)", panelId: "build-objects", render: c => (
		<Card id="build-objects" canvas={c} ariaLabel="Objects" title="Objects" tip="M486 · job.build">
			<BuildObjects />
		</Card>
	) },
	{ key: "console", label: "Console", panelId: "console", render: c => <ConsolePanel canvas={c} /> },
	{ key: "camera", label: "Camera", panelId: "camera", render: c => <CameraPanel canvas={c} /> },
];

/** Each panel id at col 0 — only one card is ever mounted, so they can share a cell. */
const LAB_DEFAULTS: PanelDefault[] = [
	{ id: "position", col: 0, row: 0, colSpan: 12, rowSpan: 95 },
	{ id: "tools-heaters", col: 0, row: 0, colSpan: 12, rowSpan: 89 },
	{ id: "temperatures", col: 0, row: 0, colSpan: 14, rowSpan: 70 },
	{ id: "sensors", col: 0, row: 0, colSpan: 12, rowSpan: 44 },
	{ id: "active-job", col: 0, row: 0, colSpan: 12, rowSpan: 62 },
	{ id: "heater", col: 0, row: 0, colSpan: 8, rowSpan: 40 },
	{ id: "build-objects", col: 0, row: 0, colSpan: 12, rowSpan: 60 },
	{ id: "console", col: 0, row: 0, colSpan: 16, rowSpan: 90 },
	{ id: "camera", col: 0, row: 0, colSpan: 12, rowSpan: 80 },
];

/** Nozzle 1 (heater index 1) — the one the heater-fault scenario latches. */
function HeaterTile() {
	const app = useApp();
	return (
		<Show when={app.om.om.heat.heaters[1]} fallback={<p class="job-empty">No heater at index 1.</p>}>
			{h => <HeaterState heater={h()} index={1} />}
		</Show>
	);
}

export default function CardLab() {
	const outer = useApp();

	const [scenario, setScenario] = createSignal<ScenarioId>("printing");
	const [featured, setFeatured] = createSignal<string>("job-detailed");

	// Synthetic OM store, swapped when the scenario changes. Reconcile per
	// top-level key exactly as the real om/store.ts does, so only the fields
	// that actually differ re-notify — the same fine-grained update path the
	// cards see in production.
	const [model, setModel] = createStore<ObjectModel>(scenarioModel(scenario()));
	createEffect(() => {
		const next = scenarioModel(scenario());
		for (const key of Object.keys(next)) {
			setModel(key as keyof ObjectModel, reconcile(next[key] as never));
		}
	});

	const [consoleLines, setConsoleLines] = createStore<ConsoleLine[]>([
		{ receivedAt: Date.now(), text: "Card Lab — a control's code is echoed here, not sent." },
	]);
	const echo = (code: string): void =>
		setConsoleLines(produce(lines => { lines.push({ receivedAt: Date.now(), text: "→ " + code }); }));

	const connection: ConnectionState = {
		status: "connected", detail: "Card Lab — synthetic model, no machine",
		emulated: false, boardType: "Card Lab",
	};
	const omStore: OmStore = {
		om: model, setOm: setModel, connection, console: consoleLines, events: {},
	};

	const services: AppServices = {
		om: omStore,
		config: outer.config, // real config so role/sensor labels render
		connector: createStubConnector(echo),
		temps: createTemperatureHistory(omStore),
	};

	// Isolated canvas key — never touches a real view's saved layout.
	const canvas = createPanelCanvas("dwc-ng.canvas.cardlab", LAB_DEFAULTS);
	const current = (): LabCard => LAB_CARDS.find(c => c.key === featured()) ?? LAB_CARDS[0]!;

	return (
		<div class="card-lab">
			<div class="lab-bar">
				<span class="lab-cap">Card</span>
				<div class="lab-pills" role="group" aria-label="Card">
					<For each={LAB_CARDS}>
						{c => (
							<button class="lab-pill" aria-pressed={featured() === c.key} onClick={() => setFeatured(c.key)}>
								{c.label}
							</button>
						)}
					</For>
				</div>
			</div>
			<div class="lab-bar">
				<span class="lab-cap">State</span>
				<div class="lab-pills" role="group" aria-label="Scenario">
					<For each={SCENARIOS}>
						{s => (
							<button class="lab-pill" aria-pressed={scenario() === s.id} onClick={() => setScenario(s.id)}>
								{s.label}
							</button>
						)}
					</For>
				</div>
				<span class="lab-note">{SCENARIOS.find(s => s.id === scenario())?.note}</span>
			</div>

			<AppContext.Provider value={services}>
				<PanelCanvas class="lab-canvas">
					{/* Keyed on the featured card so switching remounts a clean card
					    rather than reusing the previous one's internal state. */}
					<Show when={current()} keyed>
						{card => card.render(canvas)}
					</Show>
				</PanelCanvas>
			</AppContext.Provider>
		</div>
	);
}
