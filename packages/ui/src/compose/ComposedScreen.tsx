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
import { canvasStorageKey, createPanelCanvas, type PanelCanvasController } from "../shell/panelCanvas.ts";
import { CARD_DEFS, allCardIds, parseCardId, type CardId } from "./defs.ts";
import { RegistryCard, cardTitleOf } from "./RegistryCard.tsx";
import { addCard, compositionRects, customCardIds, isCustomCardId, removeCard, slotsOf, type Composition, type CustomCardId, type SlotId } from "./composition.ts";
import { createServicePool } from "./services.ts";
import { orientationsOf, planScreenImport, replaceScreenLayout, resolveScreen, screenList, type ScreenEntry } from "./screens.ts";
import { CustomCard } from "./CustomCard.tsx";
import { CardStudio } from "./CardStudio.tsx";
import { ImportReview } from "./ImportReview.tsx";
import { exportCard, exportScreen, parseShareFile, remapScreenCards, type ShareImport } from "./share.ts";
import type { CardCtx } from "./ctx.ts";

/** Hand a share file to the browser as a download. */
function downloadShare(file: { fileName: string; text: string }): void {
	const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = file.fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

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

	const ctxFor = (id: SlotId): CardCtx => ({
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
		canvasStorageKey(props.screenId),
		untrack(() => slotsOf(composition()).map(([id, slot]) => ({ id, ...slot }))),
		rawId => {
			const id = parseCardId(rawId);
			return id === null ? true : visibleFor(id);
		},
		// A moved or resized card is an unsaved change: Save to machine is
		// gated on the dirty flag, and geometry only reaches the overlay at
		// save time (captureScreenGeometry), so without this the button stays
		// greyed out and the layout can never leave this browser.
		() => app.config.markLayoutDirty(),
	);

	// Composition edits → canvas slots. Adding a card adopts its (auto-placed)
	// rect; removing forgets it. Untouched cards keep their state and DOM.
	// The composition is the TOTAL slot truth for a screen, so anything the
	// canvas tracks that isn't in it is stale — including unrecognizable junk
	// ids from old storage, which the previous "known ids only" sweep kept
	// forever (audit L5).
	createEffect(() => {
		const comp = composition();
		for (const [id, slot] of slotsOf(comp)) canvas.ensureSlot(id, slot);
		for (const id of canvas.slotIds()) {
			if (!(id in comp)) canvas.removeSlot(id);
		}
	});

	// Stable primitive keys: <For> keeps DOM/state for ids that remain.
	const slotIdList = createMemo<SlotId[]>(() => slotsOf(composition()).map(([id]) => id));

	return (
		<>
			<div class="layout-toolbar">
				<ComposeDrawer screenId={props.screenId} entry={entry()} composition={composition()} previewCtx={ctxFor("console")} canvas={canvas} />
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class={entry()?.def.class}>
				<For each={slotIdList()}>
					{id => (
						<Show
							when={isCustomCardId(id) ? id : null}
							fallback={
								// I3, mount half — same predicate the canvas filter uses.
								<Show when={visibleFor(id as CardId)}>
									<RegistryCard id={id as CardId} canvas={canvas} ctx={ctxFor(id)} />
								</Show>
							}
						>
							{customId => <CustomCard id={customId()} canvas={canvas} ctx={ctxFor(id)} />}
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
 * via the layouts override). Reset-everything on Settings undoes the
 * OVERRIDES (renames, hides, layouts, membership changes to built-ins) but
 * keeps the user's creations — custom cards and screens die only by their
 * own explicit ✕/Delete.
 */
/** Case- and accent-insensitive compare, so the picker sorts "ATX" next to
 *  "atx-like" names naturally — "case doesn't matter". */
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });

function ComposeDrawer(props: { screenId: string; entry: ScreenEntry | null; composition: Composition; previewCtx: CardCtx; canvas: PanelCanvasController }) {
	const app = useApp();
	// The card pickers, alphabetized. Spread before sort so the registry's own
	// definition order is never mutated.
	const sortedRegistryCards = createMemo(() =>
		[...allCardIds()].sort((a, b) => byName(cardTitleOf(a), cardTitleOf(b))),
	);
	const sortedCustomCards = createMemo(() =>
		[...customCardIds(app.config.config)].sort((a, b) =>
			byName(app.config.config.cards[a]!.name, app.config.config.cards[b]!.name),
		),
	);
	const [open, setOpen] = createSignal(false);
	const [newName, setNewName] = createSignal("");
	// The card studio: null = closed; id null = authoring a new card.
	const [studio, setStudio] = createSignal<{ id: CustomCardId | null } | null>(null);
	// A parsed share file awaiting the operator's review; nothing is written
	// until Import is clicked.
	const [importing, setImporting] = createSignal<ShareImport | null>(null);
	let importInput!: HTMLInputElement;

	const onImportFile = (file: File | undefined): void => {
		if (file === undefined) return;
		void file.text().then(text => setImporting(parseShareFile(text)));
	};

	/** Commit a reviewed import: mint fresh ids, remap, land. */
	const commitImport = (): void => {
		const parsed = importing();
		if (parsed === null || parsed.kind === "error") return;
		if (parsed.kind === "card") {
			const minted = app.config.addCustomCard(parsed.name, parsed.specText);
			app.config.updateScreenCards(props.screenId, asRects(addCard(props.composition, minted)));
		} else {
			// Re-importing a screen with the same name REPLACES it rather than
			// stacking a duplicate: "import my Control again" means update, not
			// make a third. A built-in wins the match — importing "Control"
			// means THIS Control, and built-ins take compositions through the
			// layouts overlay, so it is overwritten in place and keeps the
			// stable id everything else is keyed on. See planScreenImport.
			const plan = planScreenImport(app.config.config, parsed.name);

			// Cards embedded in whatever we displace go too, or a replace leaks
			// them into the card list with nothing referencing them.
			const dropEmbeddedCards = (screenId: string): void => {
				const entry = resolveScreen(app.config.config, screenId);
				if (entry === null) return;
				for (const slotId of Object.keys(entry.def.composition)) {
					if (isCustomCardId(slotId)) app.config.removeCustomCard(slotId as CustomCardId);
				}
			};
			for (const staleId of plan.purge) {
				dropEmbeddedCards(staleId);
				app.config.removeScreen(staleId);
			}
			if (plan.target !== null) dropEmbeddedCards(plan.target.id);

			const idMap = new Map<string, string>();
			for (const card of parsed.customCards) {
				idMap.set(card.fileId, app.config.addCustomCard(card.name, card.specText));
			}
			// An import REBUILDS the page: every card lands where the file says.
			// replaceScreenLayout is the only writer that touches both the config
			// overlay and this browser's canvas store, so the imported layout
			// cannot arrive half-applied — see its comment for why writing one
			// store alone shreds the layout card by card.
			const screenId = plan.target?.id ?? app.config.addScreen(parsed.name);
			const rects = remapScreenCards(parsed.cards, idMap);
			replaceScreenLayout(app.config, screenId, rects);
			// The screen being replaced may be the one on screen, which no route
			// change would remount.
			if (screenId === props.screenId) props.canvas.adoptLayout(rects, orientationsOf(rects));
			window.location.hash = `#/${screenId}`;
		}
		setImporting(null);
		setOpen(false);
	};

	const asRects = compositionRects;

	const toggleCard = (id: SlotId): void => {
		const has = props.composition[id] !== undefined;
		const next = has ? removeCard(props.composition, id) : addCard(props.composition, id);
		app.config.updateScreenCards(props.screenId, asRects(next));
	};

	/** The studio already validated through the one boundary; just store. */
	const onStudioSaved = (id: CustomCardId | null, name: string, specJson: string): void => {
		if (id === null) {
			const minted = app.config.addCustomCard(name, specJson);
			// A just-made card lands on the current screen immediately — the
			// author is composing here, not filing it away.
			app.config.updateScreenCards(props.screenId, asRects(addCard(props.composition, minted)));
		} else {
			app.config.updateCustomCard(id, { name, spec: specJson });
		}
		setStudio(null);
	};

	const createScreen = (): void => {
		const name = newName().trim();
		if (name === "") return;
		const id = app.config.addScreen(name);
		setNewName("");
		setOpen(false);
		window.location.hash = `#/${id}`;
	};

	// Two-step confirms for the drawer's destructive acts (house pattern —
	// matching file delete / heater reset / macro run): first click arms,
	// second fires; arming anything else disarms. Deleting a CREATION is
	// permanent once saved, so it never rides on a single click.
	const [armedCardDelete, setArmedCardDelete] = createSignal<CustomCardId | null>(null);
	const [armedScreenDelete, setArmedScreenDelete] = createSignal(false);

	const deleteCard = (id: CustomCardId): void => {
		setArmedScreenDelete(false);
		if (armedCardDelete() !== id) {
			setArmedCardDelete(id);
			return;
		}
		setArmedCardDelete(null);
		app.config.removeCustomCard(id);
	};

	const deleteScreen = (): void => {
		setArmedCardDelete(null);
		if (!armedScreenDelete()) {
			setArmedScreenDelete(true);
			return;
		}
		setArmedScreenDelete(false);
		app.config.removeScreen(props.screenId);
		// The hash still points at the screen just deleted, which would fall
		// through to the first screen's cards while the nav highlights nothing —
		// looking like the delete failed. Navigate somewhere real.
		const first = screenList(app.config.config)[0];
		if (first !== undefined) window.location.hash = `#/${first.id}`;
	};

	return (
		<div
			class="compose-wrap"
			onPointerLeave={e => {
				// Mouse only. On touch, pointerleave fires as soon as the finger
				// lifts, so the drawer would shut on the tap that opened it.
				if (e.pointerType !== "mouse") return;
				// Closes the FIRST time the pointer leaves, with no other condition.
				//
				// There was a guard here that kept the drawer open while focus was
				// inside it, meant to protect a half-typed screen rename. It made
				// the control unpredictable instead: clicking any button in the
				// drawer focuses that button, so from then on leaving did nothing
				// and the drawer stayed until you clicked Compose again. A close
				// that happens only sometimes is worse than one that always does.
				//
				// And it was guarding a loss that cannot happen: the name field
				// commits on `change`, which fires on blur, so closing the drawer
				// SAVES the rename rather than discarding it.
				setOpen(false);
			}}
		>
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
						<button
							class="fb-act"
							title="Download this screen (with its custom cards) as a share file"
							onClick={() => { if (props.entry !== null) downloadShare(exportScreen(props.entry, app.config.config)); }}
						>
							⤓ Export
						</button>
						<Show
							when={props.entry?.builtin}
							fallback={
								<button
									class="fb-act danger"
									classList={{ armed: armedScreenDelete() }}
									onClick={deleteScreen}
								>
									{armedScreenDelete() ? "Confirm" : "Delete screen"}
								</button>
							}
						>
							<button class="fb-act" onClick={() => app.config.setScreenHidden(props.screenId, true)}>Hide screen</button>
						</Show>
					</div>
					{/* Directly under the screen row: the unhide affordance lives next
					    to the Hide that created it (it used to sit at the drawer's
					    bottom, which clipped off-screen on short viewports). */}
					<Show when={app.config.config.screens.hidden.length > 0}>
						<div class="compose-row compose-hidden">
							<span class="lab-cap">Hidden</span>
							<For each={app.config.config.screens.hidden}>
								{id => (
									<button class="fb-act" onClick={() => app.config.setScreenHidden(id, false)}>{id} ↩</button>
								)}
							</For>
						</div>
					</Show>
					<div class="compose-cards">
						<For each={sortedRegistryCards()}>
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
					<div class="compose-row compose-custom-head">
						<span class="lab-cap">Your cards</span>
						<button class="fb-act ok" onClick={() => setStudio({ id: null })}>+ New card</button>
						<button class="fb-act" title="Import a shared card or screen file" onClick={() => importInput.click()}>⤒ Import</button>
						<input
							ref={importInput}
							type="file"
							accept=".json,application/json"
							class="fb-file-input"
							onChange={e => { onImportFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }}
						/>
					</div>
					<Show when={customCardIds(app.config.config).length > 0}>
						<div class="compose-cards compose-custom-list">
							<For each={sortedCustomCards()}>
								{id => (
									<div class="compose-customrow">
										<label class="compose-card">
											<input
												type="checkbox"
												checked={props.composition[id] !== undefined}
												onChange={() => toggleCard(id)}
											/>
											{app.config.config.cards[id]!.name}
										</label>
										<button class="link-btn" onClick={() => setStudio({ id })}>Edit</button>
										<button
											class="link-btn"
											title="Download as a share file"
											onClick={() => {
												const def = app.config.config.cards[id]!;
												const file = exportCard(def.name, def.spec);
												if (file !== null) downloadShare(file);
											}}
										>
											⤓
										</button>
										<button
											class="fb-act danger"
											classList={{ armed: armedCardDelete() === id }}
											title={`Delete ${app.config.config.cards[id]!.name} — removes it from every screen`}
											onClick={() => deleteCard(id)}
										>
											{armedCardDelete() === id ? "Confirm" : "✕"}
										</button>
									</div>
								)}
							</For>
						</div>
					</Show>
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
				</div>
			</Show>
			<Show when={studio()} keyed>
				{s => (
					<CardStudio
						cardId={s.id}
						ctx={props.previewCtx}
						onSaved={onStudioSaved}
						onClose={() => setStudio(null)}
					/>
				)}
			</Show>
			<Show when={importing()} keyed>
				{parsed => (
					<ImportReview
						parsed={parsed}
						onImport={commitImport}
						onClose={() => setImporting(null)}
					/>
				)}
			</Show>
		</div>
	);
}
