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
 *  - the layout toolbar and the compose drawer (A8): add/remove cards on
 *    THIS screen, rename, hide/delete screen, new screen — card DELETION
 *    lives in the Card Studio, which shows the delete's blast radius;
 *  - the single <Card> wrapper per slot (compose/RegistryCard.tsx).
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { Portal } from "solid-js/web";
import { useApp } from "../shell/context.ts";
import { createArmed } from "../control/armed.ts";
import { railSlot } from "../shell/railSlot.ts";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { createPanelCanvas, machineCanvasKeys, nullCanvasKeys, type PanelCanvasController } from "../shell/panelCanvas.ts";
import { machineStoreFor, type MachineStore } from "../config/machineStore.ts";
import { CARD_DEFS, allCardIds, parseCardId, type CardId } from "./defs.ts";
import { RegistryCard, cardTitleOf } from "./RegistryCard.tsx";
import { addCard, compositionRects, customCardIds, isCustomCardId, slotsOf, type Composition, type CustomCardId, type SlotId } from "./composition.ts";
import { createServicePool } from "./services.ts";
import { orientationsOf, planScreenImport, replaceScreenLayout, resolveScreen, savedScreenLayout, screenList, type ScreenEntry } from "./screens.ts";
import { CustomCard } from "./CustomCard.tsx";
import { CardStudio } from "./CardStudio.tsx";
import { ImportReview } from "./ImportReview.tsx";
import { exportCard, exportScreen, parseShareFile, remapScreenCards, type ShareImport } from "./share.ts";
import type { CardCtx } from "./ctx.ts";

/**
 * A stable sentinel so "unidentified" is its OWN keyed branch of the `<Show>`
 * below, rather than the falsy value that sends it to a fallback with no
 * card in hand at all (GIT_86 finding 1). A module-level constant, not one
 * minted per render: `<Show keyed>` remounts its child whenever the `when`
 * value's REFERENCE changes, so a fresh object every render would remount
 * the whole canvas on every poll tick. This one reference never changes, so
 * repeated "still unidentified" renders are a no-op, and the ONLY remount is
 * the real transition — sentinel to a genuine `MachineStore` — the instant
 * identity resolves.
 */
const UNIDENTIFIED_CANVAS: unique symbol = Symbol("unidentified-canvas");

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
	//
	// `onScreen` reads the composition memo at CALL time, not at pool creation,
	// so a card added or removed from the compose drawer changes the answer
	// immediately — the composition is the total slot truth for a screen
	// (see the ensureSlot/removeSlot effect below), so membership in it is what
	// "this card is on the screen" means.
	const service = createServicePool({
		...app,
		connected,
		onScreen: (id: CardId) => composition()[id] !== undefined,
	});

	// A screen's canvas is per-machine (GIT_86): the layout a card sits at was
	// laid out on THIS machine, so it must not flash into view under a
	// different one. `machineStoreFor` derives from AppServices.machineId,
	// the one identity App.tsx resolves — never a second resolution.
	const machineStore = createMemo<MachineStore | null>(() => machineStoreFor(app.machineId()));

	// GIT_86 Critical 2: identity resolving (machineStore() going non-null)
	// happens INSIDE connector.connect()'s fullSync, strictly before
	// config.loadFromMachine ever runs (App.tsx chains it after connect()
	// resolves) — so a canvas constructed the instant identity resolves reads
	// `savedScreenLayout` against a machine half that is still `{}`, seeds
	// itself empty, and settle-writes that emptiness before the real SD
	// layout ever arrives. Gating this `<Show>`'s key on `configLoaded` TOO —
	// not identity alone — makes the seed's precondition (the config's
	// machine half is the one that just came off the SD card, or there
	// genuinely was none) true by construction: before the first load
	// attempt settles, this always reads as UNIDENTIFIED_CANVAS regardless of
	// identity, so the canvas binds through the already-correct, non-
	// persisting `nullCanvasKeys` for the WHOLE pre-load window, and remounts
	// into the real, persisting branch exactly once — the instant identity
	// AND a settled load are both true — never one further remount than the
	// sentinel-to-store swap this file already documents.
	const canvasIdentity = createMemo<MachineStore | typeof UNIDENTIFIED_CANVAS>(() =>
		app.configLoaded() ? (machineStore() ?? UNIDENTIFIED_CANVAS) : UNIDENTIFIED_CANVAS,
	);

	return (
		<Show
			// UNIDENTIFIED_CANVAS, never `null`/`undefined`: an unidentified
			// machine is a SUPPORTED operating mode (spec §3), not an absence
			// of content, so it must not fall to `<Show>`'s falsy fallback —
			// there IS no fallback branch any more (GIT_86 finding 1). Both
			// branches render the exact same cards, including the
			// machine-identity card whose whole job is explaining this very
			// state; only the CanvasKeys they persist through differ.
			when={canvasIdentity()}
			keyed
		>
			{resolved => {
				// Narrowed once per mount of this branch, never reassigned — the
				// `<Show keyed>` above already remounts this whole closure the one
				// time `resolved` changes from the sentinel to a real store (or
				// back, on a re-identify), so nothing further down needs to react
				// to identity changing itself.
				// The cast is TS inference, not a real widening: Solid's generic
				// `Show<T>` loses the sentinel's `unique symbol` branding down to
				// bare `symbol` when inferring T from `when`, so the `===` check
				// below narrows the RUNTIME value correctly but not the static
				// type. `resolved` can only ever be `UNIDENTIFIED_CANVAS` itself or
				// whatever `machineStore()` produced, so once it fails that
				// equality check it IS a `MachineStore`.
				const store: MachineStore | null = resolved === UNIDENTIFIED_CANVAS ? null : (resolved as MachineStore);

				const ctxFor = (id: SlotId): CardCtx => ({
					...app,
					connected,
					orientation: () => canvas.orientationFor(id),
					labels: () => canvas.labelsFor(id),
					service,
				});

				const visibleFor = (id: CardId): boolean => {
					const visibleWhen = CARD_DEFS[id].visibleWhen;
					if (visibleWhen === undefined) return true;
					// Containment: a predicate that throws is a card bug, but it must
					// cost that CARD (shown despite the error), never the screen or the
					// router — an exception here propagates through Show's memo and
					// wedges the whole shell (observed live 2026-07-23 with an OM field
					// a board didn't report). Predicates should be total; this makes
					// the blast radius card-sized when one isn't.
					try {
						return visibleWhen(ctxFor(id));
					} catch {
						return true;
					}
				};

				// Initial defaults from the composition at mount; later membership
				// edits flow through the sync effect below instead of a remount.
				//
				// KEYS: `machineCanvasKeys` once identified — the ONLY producer
				// backed by real storage — or `nullCanvasKeys` while unidentified,
				// an in-memory stand-in that writes nowhere (GIT_86 finding 1). A
				// drag made in this state is real for as long as this render lives
				// and vanishes with it the instant identity resolves and the
				// `<Show>` above remounts against the real store — which is exactly
				// the "defaults render, then the saved layout replaces them in ONE
				// transition" property the old whole-canvas gate existed to protect,
				// kept here without ever blanking the screen to get it.
				const canvas = createPanelCanvas(
					store !== null ? machineCanvasKeys(store, props.screenId) : nullCanvasKeys(),
					untrack(() => slotsOf(composition()).map(([id, slot]) => ({ id, ...slot }))),
					rawId => {
						const id = parseCardId(rawId);
						return id === null ? true : visibleFor(id);
					},
					// A moved or resized card is an unsaved change: Save to machine is
					// gated on the dirty flag, and geometry only reaches the overlay at
					// save time (captureScreenGeometry), so without this the button
					// stays greyed out and the layout can never leave this browser.
					//
					// Reached ONLY from an operator gesture. The canvas decides that,
					// not this call site: `persist` takes a LayoutOrigin and only
					// "operator-gesture" reaches this callback. The sync effect below
					// (ensureSlot/removeSlot) is a "composition-reconcile" and is
					// silent — the config edit that caused it already marked itself
					// dirty via setScreenCard -> apply -> commit, and at boot there
					// was no edit to report (#120 defect B).
					() => app.config.markLayoutDirty(),
					undefined,
					// Seeds a canvas store with no record at all (GIT_86 task 16) from
					// what the operator actually saved to the SD card, so a card they
					// placed is honoured exactly and a coded-only card can never land
					// on top of it - see createPanelCanvas's seedFromOverlay doc. While
					// unidentified the machine half of the overlay is always `{}`
					// (config/store.ts's writeMachineOverlay never ran without a
					// handle), so this naturally yields null and every card sites at
					// its coded default — nothing extra to gate here.
					untrack(() => savedScreenLayout(app.config.config, props.screenId)),
				);

				// Composition edits → canvas slots. Adding a card adopts its
				// (auto-placed) rect; removing forgets it. Untouched cards keep their
				// state and DOM. The composition is the TOTAL slot truth for a
				// screen, so anything the canvas tracks that isn't in it is stale —
				// including unrecognizable junk ids from old storage, which the
				// previous "known ids only" sweep kept forever (audit L5).
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
						{/* Into the RAIL, not above the canvas. The toolbar that used to
						    live here cost 36px of full-width canvas height on every
						    screen — nine row units off the top of every card — while the
						    rail carried 812px of unused column. Portalled rather than
						    hoisted: see railSlot.ts.
						    Only once identified: composing (rename/delete/import a
						    screen, add/remove cards) needs a real MachineStore — an
						    import replaces the canvas's PERSISTED geometry
						    (replaceScreenLayout/writeCanvasState), which has nowhere to
						    go while unidentified. The cards themselves render regardless
						    (below); this is the one piece that stays gated. */}
						<Show when={store} keyed>
							{s => (
								<Show when={railSlot()}>
									{slot => (
										<Portal mount={slot()}>
											<ComposeDrawer screenId={props.screenId} entry={entry()} composition={composition()} previewCtx={ctxFor("console")} canvas={canvas} machineStore={s} />
										</Portal>
									)}
								</Show>
							)}
						</Show>
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
			}}
		</Show>
	);
}

/**
 * The compose drawer: which cards this screen holds, and the screen's own
 * lifecycle (rename / hide / delete / new). All of it is config-overlay data —
 * membership edits write through updateScreenCards (custom in place, built-in
 * via the layouts override). Reset-everything on Settings undoes the
 * OVERRIDES (renames, hides, layouts, membership changes to built-ins) but
 * keeps the user's creations — a custom screen dies only by its own explicit
 * Delete here, and a custom CARD only in the Card Studio, whose armed confirm
 * shows the screens the delete would strip it from.
 */
/**
 * An artist's palette, drawn rather than borrowed.
 *
 * Inline SVG and not an emoji: 🎨 renders in whatever colour and shape the
 * platform's font decides, which is the one thing a UI with a deliberate,
 * re-groundable palette cannot have — and it would be the only glyph in the
 * rail we did not control. currentColor throughout, so it inherits the same
 * dim → silk → accent treatment as every other rail control, needs no separate
 * hover rule, and followed the palette from navy to anodize without an edit.
 *
 * Dabs at FULL currentColor, all four. They were drawn at descending opacity
 * first, on the theory that a rarely-used control should stay quiet; magnified
 * ten times it looked right and at its real 18px the two faintest dabs
 * disappeared into the navy entirely, leaving a bean with two dots. Contrast a
 * 1.1px-radius circle needs is not contrast a 200px preview shows.
 *
 * NO width/height ATTRIBUTES. The glyph occupies layout space beside a label
 * that scales, so its size is `calc(4.5 * var(--u))` in CSS (.palette-glyph)
 * — 18px at scale 1, the value the attributes used to hard-code. An HTML
 * attribute is not CSS, so the px lint could never have seen that pair; the
 * viewBox alone fixes the drawing's proportions.
 */
function PaletteIcon() {
	return (
		<svg class="palette-glyph" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3.2c-4.9 0-8.8 3.5-8.8 7.8 0 4.3 3.9 7.8 8.8 7.8a1.45 1.45 0 0 0 1.1-2.4 1.5 1.5 0 0 1 1.1-2.5h1.7c2.7 0 4.9-2.2 4.9-4.9 0-3.8-3.9-5.8-8.8-5.8Z"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
			/>
			<circle cx="7.4" cy="11.6" r="1.2" fill="currentColor" />
			<circle cx="9.4" cy="7.9" r="1.2" fill="currentColor" />
			<circle cx="13.6" cy="7.2" r="1.2" fill="currentColor" />
			<circle cx="17.2" cy="9.4" r="1.2" fill="currentColor" />
		</svg>
	);
}

/** Case- and accent-insensitive compare, so the picker sorts "ATX" next to
 *  "atx-like" names naturally — "case doesn't matter". */
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });

function ComposeDrawer(props: { screenId: string; entry: ScreenEntry | null; composition: Composition; previewCtx: CardCtx; canvas: PanelCanvasController; machineStore: MachineStore }) {
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
			placeOne(minted);
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
			replaceScreenLayout(app.config, props.machineStore, screenId, rects);
			// The screen being replaced may be the one on screen, which no route
			// change would remount.
			if (screenId === props.screenId) props.canvas.adoptLayout(rects, orientationsOf(rects));
			window.location.hash = `#/${screenId}`;
		}
		setImporting(null);
		setOpen(false);
	};

	const asRects = compositionRects;

	/**
	 * Place one card, at the spot addCard picks for it. Written as a SINGLE-card
	 * write rather than a whole-record one: these are membership edits, the
	 * canvas syncs the changed slot itself, and a wholesale write here would
	 * need the second tier too (see config/screen-layout-two-tier).
	 */
	const placeOne = (id: SlotId): void => {
		const rect = asRects(addCard(props.composition, id))[id];
		if (rect !== undefined) app.config.setScreenCard(props.screenId, id, rect);
	};

	const toggleCard = (id: SlotId): void => {
		if (props.composition[id] !== undefined) app.config.setScreenCard(props.screenId, id, null);
		else placeOne(id);
	};

	/** The studio already validated through the one boundary; just store. */
	const onStudioSaved = (id: CustomCardId | null, name: string, specJson: string): void => {
		if (id === null) {
			const minted = app.config.addCustomCard(name, specJson);
			// A just-made card lands on the current screen immediately — the
			// author is composing here, not filing it away.
			placeOne(minted);
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

	// Two-step confirm for the drawer's one destructive act (house pattern —
	// matching file delete / heater reset / macro run): first click arms, the
	// second fires. Deleting a CREATION is permanent once saved, so it never
	// rides on a single click. Card deletion is the Card Studio's job — the
	// drawer only composes the current screen. createArmed, so Escape disarms
	// this like every other armed control.
	const [armedScreenDelete, setArmedScreenDelete] = createArmed<true>();

	const deleteScreen = (): void => {
		if (armedScreenDelete() === null) {
			setArmedScreenDelete(true);
			return;
		}
		setArmedScreenDelete(null);
		app.config.removeScreen(props.screenId);
		// The hash still points at the screen just deleted, which would fall
		// through to the first screen's cards while the nav highlights nothing —
		// looking like the delete failed. Navigate somewhere real.
		const first = screenList(app.config.config)[0];
		if (first !== undefined) window.location.hash = `#/${first.id}`;
	};

	// TAP OUTSIDE TO DISMISS, registered only while open.
	//
	// pointerleave is the desktop path and it is explicitly mouse-only — on
	// touch it fires the instant the finger lifts, so the drawer would shut on
	// the tap that opened it. That left touch with no dismissal at all except
	// finding the palette again, and at narrow widths the drawer is a bottom
	// sheet with the button up in the rail, so there is nothing to leave.
	//
	// pointerdown rather than click: a tap that starts outside should dismiss
	// even if it turns into a drag, and click would let a press-and-drag on the
	// canvas leave the sheet open over what is being dragged.
	let wrapEl: HTMLDivElement | undefined;
	createEffect(() => {
		if (!open()) return;
		const dismiss = (e: PointerEvent): void => {
			if (wrapEl !== undefined && e.target instanceof Node && wrapEl.contains(e.target)) return;
			setOpen(false);
		};
		document.addEventListener("pointerdown", dismiss);
		onCleanup(() => document.removeEventListener("pointerdown", dismiss));
	});

	return (
		<div class="compose-wrap" ref={wrapEl}>
			{/* CLICK, not hover. Hover does not exist on touch, and this is the
			    only way into composing a screen — a control you cannot open on a
			    phone is a control the phone does not have. */}
			<button
				class="rail-palette"
				aria-pressed={open()}
				aria-label="Compose this screen"
				title="Compose this screen"
				onClick={() => setOpen(v => !v)}
			>
				<PaletteIcon />
			</button>
			<Show when={open()}>
				<div
					class="compose-drawer"
					onPointerLeave={e => {
						// ON THE DRAWER, NOT THE PALETTE ROW.
						//
						// It used to close when the pointer left `.compose-wrap` — a
						// 169x34 band at the foot of the rail — while the drawer is a
						// 340x501 rectangle standing mostly ABOVE it. Every natural
						// route from the button to a card checkbox therefore left the
						// band while still in open ground, and the drawer vanished in
						// flight: measured leaving at (123, 1137), six pixels above the
						// button and still sixty-six short of the drawer's edge. An 8px
						// bridge beside the button could not help, because the gap is
						// L-shaped, not a strip.
						//
						// Binding the close to the DRAWER removes the dead ground and
						// the arming problem in one move: pointerleave here cannot fire
						// before pointerenter here, so "only after the card grid has
						// been hovered" is true by construction rather than by a flag
						// someone has to remember to set. Getting to the drawer is now
						// unconditional — take any path, as slowly as you like.
						//
						// Mouse only. On touch pointerleave fires the moment the finger
						// lifts, so tapping a checkbox would dismiss the drawer; touch
						// dismisses by tapping outside instead (see above).
						if (e.pointerType !== "mouse") return;
						setOpen(false);
					}}
				>
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
									classList={{ armed: armedScreenDelete() !== null }}
									onClick={deleteScreen}
								>
									{armedScreenDelete() !== null ? "Confirm" : "Delete screen"}
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
					{/* Last, and set apart: everything above edits WHAT is on the
					    screen, this throws away where the cards were put. It moved in
					    here when the toolbar went into the rail — one entry was the
					    ask, so the second button became a row rather than a second
					    icon. */}
					<div class="compose-row compose-reset">
						<button class="layout-reset" onClick={() => props.canvas.reset()}>↺ Reset layout</button>
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
