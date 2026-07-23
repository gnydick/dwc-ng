import { For, Show, createEffect, createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { AppContext, type AppServices, useApp } from "../shell/context.ts";
import { createTemperatureHistory } from "../om/temperature.ts";
import type { OmStore, ConnectionState } from "../om/store.ts";
import type { ConsoleLine } from "../om/consoleLog.ts";
import type { ObjectModel } from "../om/types.ts";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { CARD_DEFS, allCardIds, type CardId } from "../compose/defs.ts";
import { RegistryCard, cardTitleOf } from "../compose/RegistryCard.tsx";
import { CustomCard } from "../compose/CustomCard.tsx";
import { CardStudio } from "../compose/CardStudio.tsx";
import { isCustomCardId, type CustomCardId, type SlotId } from "../compose/composition.ts";
import { createServicePool } from "../compose/services.ts";
import type { CardCtx } from "../compose/ctx.ts";
import { SCENARIOS, scenarioModel, type ScenarioId } from "./cardScenarios.ts";
import { createStubConnector } from "./stubConnector.ts";

/**
 * Card Lab (dev-only): render one REGISTRY card at a time against a synthetic
 * object model you can switch between states — idle, printing, paused, heater
 * fault, multi-tool — without a board or even the mock.
 *
 * Since the A9 conversion the lab has no card list of its own: the pills, the
 * wrapper chrome, and the natural sizes all come from the same registry
 * ComposedScreen renders (compose/defs.ts + RegistryCard), so a new card is
 * in the lab the moment it is registered and the two surfaces cannot drift.
 *
 * The lab still supplies its OWN AppContext — synthetic OM store (per-key
 * reconcile, mirroring om/store.ts), the real config, a stub connector that
 * echoes G-code into the synthetic console, temp history over the synthetic
 * model — and its own service pool over those services, so service-backed
 * cards (browsers, height map) run against the stub too.
 */
export default function CardLab() {
	const outer = useApp();

	const [scenario, setScenario] = createSignal<ScenarioId>("printing");
	const [featured, setFeatured] = createSignal<SlotId>("active-job-detailed");
	// The card studio, launchable from the lab — authoring next to the
	// scenario switcher, so a new card can be tested against printing/fault
	// states the moment it exists. null = closed; id null = new card.
	const [studio, setStudio] = createSignal<{ id: CustomCardId | null } | null>(null);

	// Synthetic OM store, swapped when the scenario changes — reconcile per
	// top-level key exactly as om/store.ts does.
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
		config: outer.config, // real config so user axis-role/sensor labels render
		connector: createStubConnector(echo),
		temps: createTemperatureHistory(omStore),
	};
	const connected = (): boolean => true;
	const service = createServicePool({ ...services, connected });

	// Isolated canvas key — never touches a real screen's saved layout. Every
	// card defaults to (0,0) at its registry natural size; only the featured
	// card counts for collisions (they all overlap by design).
	const canvas = createPanelCanvas(
		"dwc-ng.canvas.cardlab",
		allCardIds().map(id => ({ id, col: 0, row: 0, ...CARD_DEFS[id].size })),
		id => id === featured(),
	);

	// User-authored cards join the lab as they exist (incl. ones made HERE):
	// adopt a slot for each at the custom default size.
	const customIds = (): CustomCardId[] => Object.keys(outer.config.config.cards) as CustomCardId[];
	createEffect(() => {
		for (const id of customIds()) canvas.ensureSlot(id, { col: 0, row: 0, colSpan: 12, rowSpan: 40 });
	});

	const ctxFor = (id: SlotId): CardCtx => ({
		...services,
		connected,
		orientation: () => canvas.orientationFor(id),
		service,
	});

	return (
		<div class="card-lab">
			<div class="lab-bar">
				<span class="lab-cap">Card</span>
				<div class="lab-pills" role="group" aria-label="Card">
					<For each={allCardIds()}>
						{id => (
							<button class="lab-pill" aria-pressed={featured() === id} onClick={() => setFeatured(id)}>
								{cardTitleOf(id)}
							</button>
						)}
					</For>
					<For each={customIds()}>
						{id => (
							<button class="lab-pill lab-pill-custom" aria-pressed={featured() === id} onClick={() => setFeatured(id)}>
								{outer.config.config.cards[id]!.name}
							</button>
						)}
					</For>
					<button class="lab-pill lab-pill-new" onClick={() => setStudio({ id: null })}>+ New card</button>
					<Show when={isCustomCardId(featured()) ? featured() as CustomCardId : null}>
						{id => (
							<button class="lab-pill" onClick={() => setStudio({ id: id() })}>✎ Edit</button>
						)}
					</Show>
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
					{/* Keyed remount on switch: a fresh card, no leaked internal state.
					    visibleWhen is deliberately NOT applied here — the lab's job is
					    to show the card, whatever the scenario says. */}
					<Show when={featured()} keyed>
						{id => (
							<Show
								when={isCustomCardId(id) ? id : null}
								fallback={<RegistryCard id={id as CardId} canvas={canvas} ctx={ctxFor(id)} />}
							>
								{customId => <CustomCard id={customId()} canvas={canvas} ctx={ctxFor(id)} />}
							</Show>
						)}
					</Show>
				</PanelCanvas>
				<Show when={studio()} keyed>
					{s => (
						<CardStudio
							cardId={s.id}
							ctx={ctxFor(s.id ?? featured())}
							onSaved={(id, name, specJson) => {
								if (id === null) {
									const minted = outer.config.addCustomCard(name, specJson) as CustomCardId;
									setFeatured(minted); // straight onto the bench
								} else {
									outer.config.updateCustomCard(id, { name, spec: specJson });
								}
								setStudio(null);
							}}
							onClose={() => setStudio(null)}
						/>
					)}
				</Show>
			</AppContext.Provider>
		</div>
	);
}
