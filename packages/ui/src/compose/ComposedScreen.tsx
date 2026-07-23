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
import { addCard, isCustomCardId, removeCard, slotsOf, type Composition, type CustomCardId, type SlotId } from "./composition.ts";
import { createServicePool } from "./services.ts";
import { resolveScreen, screenList, type ScreenEntry } from "./screens.ts";
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
			const known = parseCardId(id) !== null || isCustomCardId(id);
			if (known && !(id in comp)) canvas.removeSlot(id);
		}
	});

	// Stable primitive keys: <For> keeps DOM/state for ids that remain.
	const slotIdList = createMemo<SlotId[]>(() => slotsOf(composition()).map(([id]) => id));

	return (
		<>
			<div class="layout-toolbar">
				<ComposeDrawer screenId={props.screenId} entry={entry()} composition={composition()} previewCtx={ctxFor("console")} />
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
 * via the layouts override), so Reset-everything on Settings undoes the lot.
 */
function ComposeDrawer(props: { screenId: string; entry: ScreenEntry | null; composition: Composition; previewCtx: CardCtx }) {
	const app = useApp();
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
			const minted = app.config.addCustomCard(parsed.name, parsed.specText) as CustomCardId;
			app.config.updateScreenCards(props.screenId, asRects(addCard(props.composition, minted)));
		} else {
			const idMap = new Map<string, string>();
			for (const card of parsed.customCards) {
				idMap.set(card.fileId, app.config.addCustomCard(card.name, card.specText));
			}
			const screenId = app.config.addScreen(parsed.name);
			app.config.updateScreenCards(screenId, remapScreenCards(parsed.cards, idMap));
			window.location.hash = `#/${screenId}`;
		}
		setImporting(null);
		setOpen(false);
	};

	const asRects = (comp: Composition): Record<string, { col: number; row: number; colSpan: number; rowSpan: number }> =>
		Object.fromEntries(slotsOf(comp).map(([id, s]) => [id, { col: s.col, row: s.row, colSpan: s.colSpan, rowSpan: s.rowSpan }]));

	const toggleCard = (id: SlotId): void => {
		const has = props.composition[id] !== undefined;
		const next = has ? removeCard(props.composition, id) : addCard(props.composition, id);
		app.config.updateScreenCards(props.screenId, asRects(next));
	};

	/** The studio already validated through the one boundary; just store. */
	const onStudioSaved = (id: CustomCardId | null, name: string, specJson: string): void => {
		if (id === null) {
			const minted = app.config.addCustomCard(name, specJson) as CustomCardId;
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
					<Show when={Object.keys(app.config.config.cards).length > 0}>
						<div class="compose-cards compose-custom-list">
							<For each={Object.keys(app.config.config.cards) as CustomCardId[]}>
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
										<button class="link-btn" onClick={() => app.config.removeCustomCard(id)}>✕</button>
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
