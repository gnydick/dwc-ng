import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
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
import { customCardIds, isCustomCardId, isOrphanSlot, type CustomCardId, type SlotId } from "../compose/composition.ts";
import { createServicePool } from "../compose/services.ts";
import type { CardCtx } from "../compose/ctx.ts";
import { SCENARIOS, scenarioModel, type ScenarioId } from "./cardScenarios.ts";
import { createStubConnector } from "@dwc-ng/connector";
import { LayoutAuditAll, LayoutAuditPanel } from "./LayoutAuditPanel.tsx";

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
		emulated: false, transport: null, boardType: "Card Lab",
	};
	const omStore: OmStore = {
		om: model, setOm: setModel, connection, console: consoleLines, events: {},
	};

	const services: AppServices = {
		om: omStore,
		config: outer.config, // real config so user axis-role/sensor labels render
		connector: createStubConnector(echo),
		temps: createTemperatureHistory(omStore),
		backend: outer.backend,
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
		// Device-only geometry: no markLayoutDirty.
		undefined,
		// A BENCH — one card at a time, all parked at the origin, overlaps
		// intentional. Without this, reflow() scatters all fifty the first time
		// anything grows their default size.
		true,
	);

	// User-authored cards join the lab as they exist (incl. ones made HERE):
	// adopt a slot for each at the custom default size.
	const customIds = (): CustomCardId[] => customCardIds(outer.config.config);

	// The featured card can be deleted out from under us — the studio's
	// delete, an import purge — and a featured id with no definition renders
	// a ghost. Fall back to the default featured card instead. This guards
	// EVERY deletion path, not just the studio's.
	createEffect(() => {
		if (isOrphanSlot(featured(), outer.config.config)) setFeatured("active-job-detailed");
	});

	/**
	 * Every card, registry and custom together, in one alphabetical list.
	 *
	 * Sorted by the LABEL you read, not by id: the ids are kebab-case and often
	 * differ from the title ("active-job-detailed" is "Printing · estimates"),
	 * so sorting by id put the list in an order nothing on screen explained.
	 * Registry and custom are interleaved rather than grouped, because when you
	 * are hunting for a card by name its provenance is not what you remember —
	 * the dashed border still says which is which.
	 *
	 * localeCompare so "·" and case sort the way a person expects.
	 */
	const pillEntries = createMemo(() => {
		const registry = allCardIds().map(id => ({ id: id as SlotId, label: cardTitleOf(id), custom: false }));
		const custom = customIds().map(id => ({ id: id as SlotId, label: outer.config.config.cards[id]!.name, custom: true }));
		return [...registry, ...custom].sort((a, b) => a.label.localeCompare(b.label));
	});
	createEffect(() => {
		for (const id of customIds()) canvas.ensureSlot(id, { col: 0, row: 0, colSpan: 12, rowSpan: 40 });
	});

	const ctxFor = (id: SlotId): CardCtx => ({
		...services,
		connected,
		orientation: () => canvas.orientationFor(id),
		labels: () => canvas.labelsFor(id),
		service,
	});

	// The bench element the audit measures. One card is mounted at a time, so
	// one ref suffices; the sweep features each id and re-reads this.
	let benchEl: HTMLDivElement | undefined;
	const [auditOpen, setAuditOpen] = createSignal(false);
	// The single-card audit hands its action here so its button can sit in the
	// sweep's bar — every audit control on one row, per the operator.
	let runThisCard: (() => void) | undefined;

	return (
		<div class="card-lab">
			{/* Down the left edge, alphabetical: ~50 cards in a wrapping bar meant
			    hunting a name in a block of text with no order to it. One column,
			    one sort, and the pill you want is where the alphabet says. */}
			<aside class="lab-rail">
				<span class="lab-cap">Card</span>
				<div class="lab-pills lab-pills-rail" role="group" aria-label="Card">
					<For each={pillEntries()}>
						{entry => (
							<button
								class="lab-pill"
								classList={{ "lab-pill-custom": entry.custom }}
								aria-pressed={featured() === entry.id}
								onClick={() => setFeatured(entry.id)}
							>
								{entry.label}
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
			</aside>
			<div class="lab-main">
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

			{/* Audit THIS card — built in the same pass as the sweep and then never
			    rendered, so its "Run layout audit" button has been dead code since
			    the day it was written. The sweep answers "which cards are wrong";
			    this answers "what exactly is wrong with the one in front of me",
			    which is the question you have while editing a card. */}
			<LayoutAuditPanel
				cardEl={() => benchEl?.querySelector<HTMLElement>("[data-panel-id]") ?? null}
				id={() => featured()}
				title={() => (isCustomCardId(featured())
					? outer.config.config.cards[featured() as CustomCardId]?.name ?? featured()
					: cardTitleOf(featured() as CardId))}
				hideBar
				registerRun={run => { runThisCard = run; }}
			/>
			{/* Always mounted: the sweep button lives in the audit's own bar
			    beside this toggle, so neither appears nor disappears. Only the
			    RESULTS collapse. */}
			<LayoutAuditAll
				ids={() => allCardIds()}
				titleOf={id => cardTitleOf(id as CardId)}
				feature={id => setFeatured(id as CardId)}
				current={() => featured()}
				benchEl={() => benchEl?.querySelector<HTMLElement>("[data-panel-id]") ?? null}
				open={auditOpen}
				toggle={
					<>
						<span class="lab-cap">Audit</span>
						<button class="lab-pill" onClick={() => runThisCard?.()}>Audit this card</button>
						<button class="lab-pill" aria-pressed={auditOpen()} onClick={() => setAuditOpen(v => !v)}>
							{auditOpen() ? "Hide results" : "Show results"}
						</button>
					</>
				}
			/>

			{/* Directly above the bench, and the last thing before it. Reset acts
			    on the card you are looking at, so it belongs against the card
			    rather than stranded at the top under the scenario switcher with
			    the audit between them. The bars above are right-aligned to leave
			    this the only thing on the left edge at this height. */}
			<div class="layout-toolbar">
				{/* Scoped to the card on the bench. reset() would restore all of
				    them at once, which is never what "reset" means on a surface
				    that shows one card at a time. */}
				<button class="layout-reset" onClick={() => canvas.resetSlot(featured())}>↺ Reset card</button>
			</div>
			<AppContext.Provider value={services}>
				<div ref={benchEl}>
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
				</div>
				<Show when={studio()} keyed>
					{s => (
						<CardStudio
							cardId={s.id}
							ctx={ctxFor(s.id ?? featured())}
							onSaved={(id, name, specJson) => {
								if (id === null) {
									const minted = outer.config.addCustomCard(name, specJson);
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
		</div>
	);
}
