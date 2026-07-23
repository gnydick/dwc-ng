/**
 * The one renderer (I8): screen id in, screen out. Everything the eight
 * bespoke view files each hand-rolled lives here exactly once —
 *
 *  - the effective composition, derived reactively from the screen registry
 *    (built-in defaults + the user's config overlay, or a custom screen);
 *  - the canvas (storage key = the stable screen id, I10), with slots synced
 *    to composition edits at runtime (ensureSlot/removeSlot — adding a card
 *    never remounts the others);
 *  - the isActive predicate, derived from each card's ONE visibleWhen (I3:
 *    the mount Show uses the same expression), contained so a throwing
 *    predicate costs that card, never the screen;
 *  - the layout toolbar and the compose drawer (A8): add/remove cards,
 *    rename, hide/delete, new screen;
 *  - the single <Card> wrapper per slot (compose/RegistryCard.tsx).
 */
import { For, Show, createEffect, createMemo, createSignal, untrack } from "solid-js";
import { useApp } from "../shell/context.ts";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { createPanelCanvas } from "../shell/panelCanvas.ts";
import { CARD_DEFS, allCardIds, parseCardId, type CardId } from "./defs.ts";
import { RegistryCard, cardTitleOf } from "./RegistryCard.tsx";
import { addCard, removeCard, slotsOf, type Composition } from "./composition.ts";
import { createServicePool } from "./services.ts";
import { resolveScreen, screenList, type ScreenEntry } from "./screens.ts";
import type { CardCtx } from "./ctx.ts";

export function ComposedScreen(props: { screenId: string }) {
	const app = useApp();
	const connected = (): boolean => app.om.connection.status === "connected";

	// The entry may momentarily be null while a just-deleted screen's route
	// change propagates — render nothing for that tick rather than crash.
	const entry = createMemo<ScreenEntry | null>(() => resolveScreen(app.config.config, props.screenId));
	const composition = createMemo<Composition>(() => entry()?.def.composition ?? {});

	// One pool per screen: shared card state (browser selections, the height
	// map) provisions on first access and dies with the screen.
	const service = createServicePool({ ...app, connected });

	const ctxFor = (id: CardId): CardCtx => ({
		...app,
		connected,
		orientation: () => canvas.orientationFor(id),
		service,
	});

	const visibleFor = (id: CardId): boolean => {
		const visibleWhen = CARD_DEFS[id].visibleWhen;
		if (visibleWhen === undefined) return true;
		// Containment: a predicate that throws is a card bug, but it must cost
		// that CARD (shown despite the error), never the screen or the router —
		// an exception here propagates through Show's memo and wedges the whole
		// shell (observed live 2026-07-23 with an OM field a board didn't
		// report). Predicates should be total; this makes the blast radius
		// card-sized when one isn't.
		try {
			return visibleWhen(ctxFor(id));
		} catch {
			return true;
		}
	};

	// Initial defaults from the composition at mount; later membership edits
	// flow through the sync effect below instead of a remount.
	const canvas = createPanelCanvas(
		`dwc-ng.canvas.${props.screenId}`,
		untrack(() => slotsOf(composition()).map(([id, slot]) => ({ id, ...slot }))),
		rawId => {
			const id = parseCardId(rawId);
			return id === null ? true : visibleFor(id);
		},
	);

	// Composition edits → canvas slots. Adding a card adopts its (auto-placed)
	// rect; removing forgets it. Untouched cards keep their state and DOM.
	createEffect(() => {
		const comp = composition();
		for (const [id, slot] of slotsOf(comp)) canvas.ensureSlot(id, slot);
		for (const id of canvas.slotIds()) {
			const known = parseCardId(id);
			if (known !== null && !(known in comp)) canvas.removeSlot(id);
		}
	});

	// Stable primitive keys: <For> keeps DOM/state for ids that remain.
	const slotIdList = createMemo<CardId[]>(() => slotsOf(composition()).map(([id]) => id));

	return (
		<>
			<div class="layout-toolbar">
				<ComposeDrawer screenId={props.screenId} entry={entry()} composition={composition()} />
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class={entry()?.def.class}>
				<For each={slotIdList()}>
					{id => (
						// I3, mount half — same predicate the canvas filter uses.
						<Show when={visibleFor(id)}>
							<RegistryCard id={id} canvas={canvas} ctx={ctxFor(id)} />
						</Show>
					)}
				</For>
			</PanelCanvas>
		</>
	);
}

/**
 * The compose drawer: which cards this screen holds, and the screen's own
 * lifecycle (rename / hide / delete / new). All of it is config-overlay data —
 * membership edits write through updateScreenCards (custom in place, built-in
 * via the layouts override), so Reset-everything on Settings undoes the lot.
 */
function ComposeDrawer(props: { screenId: string; entry: ScreenEntry | null; composition: Composition }) {
	const app = useApp();
	const [open, setOpen] = createSignal(false);
	const [newName, setNewName] = createSignal("");

	const asRects = (comp: Composition): Record<string, { col: number; row: number; colSpan: number; rowSpan: number }> =>
		Object.fromEntries(slotsOf(comp).map(([id, s]) => [id, { col: s.col, row: s.row, colSpan: s.colSpan, rowSpan: s.rowSpan }]));

	const toggleCard = (id: CardId): void => {
		const has = props.composition[id] !== undefined;
		const next = has ? removeCard(props.composition, id) : addCard(props.composition, id);
		app.config.updateScreenCards(props.screenId, asRects(next));
	};

	const createScreen = (): void => {
		const name = newName().trim();
		if (name === "") return;
		const id = app.config.addScreen(name);
		setNewName("");
		setOpen(false);
		window.location.hash = `#/${id}`;
	};

	return (
		<div class="compose-wrap">
			<button class="layout-reset" aria-pressed={open()} onClick={() => setOpen(v => !v)}>⊞ Compose</button>
			<Show when={open()}>
				<div class="compose-drawer">
					<div class="compose-row compose-screen">
						<input
							class="fb-input"
							aria-label="Screen name"
							value={props.entry?.def.name ?? ""}
							onChange={e => {
								const v = e.currentTarget.value.trim();
								if (v !== "") app.config.renameScreen(props.screenId, v);
							}}
						/>
						<Show
							when={props.entry?.builtin}
							fallback={
								<button class="fb-act danger" onClick={() => app.config.removeScreen(props.screenId)}>Delete screen</button>
							}
						>
							<button class="fb-act" onClick={() => app.config.setScreenHidden(props.screenId, true)}>Hide screen</button>
						</Show>
					</div>
					<div class="compose-cards">
						<For each={allCardIds()}>
							{id => (
								<label class="compose-card">
									<input
										type="checkbox"
										checked={props.composition[id] !== undefined}
										onChange={() => toggleCard(id)}
									/>
									{cardTitleOf(id)}
								</label>
							)}
						</For>
					</div>
					<div class="compose-row">
						<input
							class="fb-input"
							placeholder="New screen name"
							value={newName()}
							onInput={e => setNewName(e.currentTarget.value)}
							onKeyDown={e => { if (e.key === "Enter") createScreen(); }}
						/>
						<button class="fb-act ok" disabled={newName().trim() === ""} onClick={createScreen}>+ New screen</button>
					</div>
					<Show when={screenList(app.config.config).some(s => s.builtin) && app.config.config.screens.hidden.length > 0}>
						<div class="compose-row compose-hidden">
							<span class="lab-cap">Hidden</span>
							<For each={app.config.config.screens.hidden}>
								{id => (
									<button class="fb-act" onClick={() => app.config.setScreenHidden(id, false)}>{id} ↩</button>
								)}
							</For>
						</div>
					</Show>
				</div>
			</Show>
		</div>
	);
}
