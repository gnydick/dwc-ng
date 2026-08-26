import { createStore, reconcile, unwrap } from "solid-js/store";
import { createComputed, untrack, type Accessor } from "solid-js";
import type { Connector } from "@dwc-ng/connector";
import { FileNotFoundError } from "@dwc-ng/connector";
import { isPlainObject, safeEntries } from "@dwc-ng/connector";
import { asEnvelope, isAccelAddr, parseOverlay, parseOverlayPayload, parseShapingDefaults } from "./parse.ts";
import {
	CONFIG_CACHE_KEY, CONFIG_FILE, CONFIG_VERSION, DEFAULT_CONFIG, MAX_SNAPSHOTS,
	MAX_LABEL_LEN, DEFAULT_SNAPSHOT_LABEL,
	isUserScreenId, joinOverlay, splitOverlay,
	type CameraConfig, type CameraPrefsConfig, type ConfigOverlay, type ConfigSnapshot, type CustomCardId,
	type DeepPartial, type DockSensorRef, type BedConfig, type Envelope, type MachineConfig, type MacrosConfig,
	type PersonConfig, type ShapingDefaults,
	type SlotRect, type ThermalColors, type UiConfig, type UserScreenId,
} from "./types.ts";
import type { MachineStore } from "./machineStore.ts";
import {
	migrateLegacySnapshots, migratePersonCacheToV3, overlaySectionNames, readAndClearLegacyPersonCache,
	readStampedMachineOverlay, stampMachineOverlay,
} from "./migrateStorage.ts";

/**
 * What a caller may change about the shaping section. `envelope` is declared
 * whole (both axes, both bounds) so a partial box is not even sayable; the
 * ordering it cannot express is checked by `asEnvelope`.
 */
export interface ShapingPatch {
	/** A user-entered box, or `null` to unset it. */
	envelope?: Envelope | null;
	defaults?: Partial<ShapingDefaults>;
}

/**
 * A settings profile read off the SD card but not yet known to belong to
 * THIS machine (spec §3, "claimed, not adopted" — config/migrateStorage.ts's
 * `readStampedMachineOverlay`). Deliberately carries only the ORIGIN and the
 * section NAMES a mismatched file held — never a leaf value. The actual
 * overlay is kept in a closure-private variable only `adoptClaimedProfile`
 * can read (see its definition below); nothing exported from this module can
 * reach it any other way, so a caller cannot render a claimed fact as if it
 * were live config even by accident — there is no live-value field to
 * misread. `cards/machineIdentityText.ts` imports this type rather than
 * declaring its own, so a shape change here is a compile error there too,
 * not merely a review risk.
 */
export interface ClaimedProfile {
	readonly writtenFor: string | null;
	readonly sections: readonly string[];
}

export interface ConfigStore {
	/** Effective config = defaults + overlay. Read this in the UI. */
	config: UiConfig;
	/** True when the overlay changed since the last save/load. */
	readonly dirty: boolean;
	/**
	 * A settings profile read off the SD card for a DIFFERENT machine than the
	 * one currently identified — `null` when there is nothing claimed. See
	 * `ClaimedProfile`'s own doc comment for what it does and does not expose.
	 */
	readonly meta: { readonly claimedProfile: ClaimedProfile | null };
	/**
	 * Apply a claimed profile's machine half and clear the claim. A no-op when
	 * nothing is claimed. The ONLY place the private pending overlay (set by
	 * loadFromMachine) is read back out — see ClaimedProfile's doc comment.
	 */
	adoptClaimedProfile(): void;
	/** Discard a claimed profile without applying it. A no-op when nothing is
	 *  claimed. */
	clearClaimedProfile(): void;
	/**
	 * Report that a screen's LAYOUT changed (a card dragged or resized).
	 *
	 * Geometry lives in the per-browser canvas store and only reaches the
	 * config overlay at Save time, via captureScreenGeometry. Nothing about
	 * that path went through apply(), so rearranging a screen never marked the
	 * config dirty — and Save to machine is gated on dirty, so it sat greyed
	 * out and the new layout could never be pushed to the SD card at all
	 * (reported 2026-07-24: "save to machine is ghosted out"). The layout IS an
	 * unsaved change; this says so.
	 */
	markLayoutDirty(): void;
	readonly snapshots: readonly ConfigSnapshot[];
	/**
	 * Machine sections the v2 → v3 migration found in the legacy
	 * (origin-global) cache and could not carry forward — set once at
	 * construction, from whatever config/migrateStorage.ts's
	 * migratePersonCacheToV3 reported. Empty when there was nothing to
	 * migrate. Task 11's card renders this so an upgrade that drops
	 * machine-scoped settings says so, rather than silently forgetting them.
	 */
	readonly droppedMachineSections: readonly string[];

	setAxisRole(letter: string, role: string): void;
	clearAxisRole(letter: string): void;
	/** Override one heater's chart line colour. Clearing returns it to the
	 *  derived palette entry, which is never mutated. */
	setHeaterColor(heaterIndex: number, hex: string): void;
	clearHeaterColor(heaterIndex: number): void;
	setThermalColors(patch: Partial<ThermalColors>): void;
	setDockSensor(toolNumber: number, ref: DockSensorRef): void;
	clearDockSensor(toolNumber: number): void;
	setCamera(patch: Partial<CameraConfig>): void;
	/** Toggle the camera panel pin — a viewing habit, distinct from the
	 *  camera's own streamUrl (see CameraPrefsConfig). */
	setCameraPrefs(patch: Partial<CameraPrefsConfig>): void;
	setSensorName(key: string, name: string): void;
	clearSensorName(key: string): void;
	setMacros(patch: Partial<MacrosConfig>): void;
	setBed(patch: Partial<BedConfig>): void;

	/**
	 * Patch the shaping section.
	 *
	 * `envelope` goes through `asEnvelope` — the SAME gate the SD file passes
	 * — so a reversed, half-entered or non-numeric box from the Settings
	 * editor lands as `null` (unset) rather than as a box a run would trust.
	 * The type cannot express "lo < hi", which is exactly why there is one
	 * gate and no second route to this field (spec I8).
	 */
	setShaping(patch: ShapingPatch): void;
	/** Point one tool at its accelerometer ("board.slot"). A malformed
	 *  address is ignored, exactly as it is from the SD file. */
	setAccelAddr(toolNumber: number, addr: string): void;
	clearAccelAddr(toolNumber: number): void;

	/** Create a user screen; returns its minted stable id ("u-…"). */
	addScreen(name: string): UserScreenId;
	/** Rename a screen — custom in place, built-in via the renames overlay.
	 *  The id (and everything keyed on it) is untouched. */
	renameScreen(id: string, name: string): void;
	/** Delete a custom screen. Built-ins can only be hidden. */
	removeScreen(id: string): void;
	/** Hide/show a built-in from the nav. */
	setScreenHidden(id: string, hidden: boolean): void;
	/**
	 * Replace a screen's card slots (membership + geometry) — custom screens
	 * in place, built-ins via the layouts overlay.
	 *
	 * ⚠ INCREMENTAL EDITS ONLY (adding, removing, or retitling ONE card).
	 *
	 * This writes the config overlay and NOTHING ELSE. A screen's geometry
	 * lives in two deliberate tiers (see compose/screens.ts), and mergeCanvas
	 * assembles what renders CARD BY CARD from whichever tier holds each id.
	 * For an incremental edit that is correct — the canvas syncs the one
	 * changed slot via ensureSlot/removeSlot. For a WHOLESALE replacement it
	 * is not: every card the browser already knows keeps its old position and
	 * the incoming layout is silently shredded.
	 *
	 * Replacing a whole layout (import, preset, restore) MUST go through
	 * `replaceScreenLayout` in compose/screens.ts, which writes both tiers.
	 *
	 * @invariant screen-layout-two-tier
	 * @rung 6  choke-point — the whole-record write has TWO callers left, both in
	 *          compose/screens.ts and both deliberate about the tiers
	 *          (replaceScreenLayout writes both; captureScreenGeometry reads the
	 *          canvas, so config alone is correct). The three incremental callers
	 *          that used to rebuild a whole composition to change one card now
	 *          use setScreenCard, which cannot express a wholesale write.
	 *          Promoted 2026-08-01; removeCard, the helper they used to rebuild
	 *          the dangerous shape, was deleted rather than left unused
	 * @why a screen's geometry lives in two deliberate tiers and mergeCanvas
	 *      assembles what renders CARD BY CARD, so a wholesale replacement that
	 *      writes one tier alone delivers a shredded layout — reported
	 *      2026-07-24 as "machine import didn't work", where the outcome was
	 *      decided by how much the file and the browser happened to overlap
	 * @debt replaceAllScreenCards is still reachable from anywhere holding the
	 *       store, and its name is the only thing saying the caller owes the
	 *       second tier — which is naming, not prevention. Rung 7 is having it
	 *       take a branded value that only compose/screens.ts can mint, so a
	 *       bare Record cannot be passed. Rung 8 would be folding the canvas
	 *       write in here so one tier alone has no encoding at all; that needs
	 *       the config store to reach the canvas store, which is a bigger
	 *       architectural change than this invariant alone justifies.
	 */
	replaceAllScreenCards(id: string, cards: Record<string, SlotRect>): void;

	/**
	 * Add, move or (with `null`) remove ONE card on a screen.
	 *
	 * The incremental intent, and the only screen-geometry write most callers
	 * should reach for. It cannot express a wholesale replacement, which is the
	 * point: the canvas syncs a single changed slot on its own, so this needs no
	 * second-tier write, while a whole-layout write does — and a caller holding
	 * only this method cannot get that wrong.
	 */
	setScreenCard(screenId: string, cardId: string, rect: SlotRect | null): void;

	/** Create a user-authored card; returns its minted stable id ("c-…"). */
	addCustomCard(name: string, spec: string): CustomCardId;
	updateCustomCard(id: CustomCardId, patch: { name?: string; spec?: string }): void;
	removeCustomCard(id: CustomCardId): void;

	/** Append an arbitrary pinned command (disabled). Returns its minted id. */
	addPin(command: string): string;
	updatePin(id: string, patch: { command?: string; enabled?: boolean }): void;
	removePin(id: string): void;
	/** Upsert a UI-owned pin by key (fan speed pins). Replaces any existing
	 *  pin with the same key. */
	setKeyedPin(key: string, command: string, enabled: boolean): void;
	removeKeyedPin(key: string): void;

	/**
	 * Drop one section's overlay — that section returns to defaults. The
	 * creation-holding sections ("cards", "screens") are excluded AT THE TYPE:
	 * a call that would destroy authored content does not compile. Creations
	 * go through their own explicit removeCustomCard/removeScreen.
	 */
	resetSection(section: Exclude<keyof UiConfig, "cards" | "screens">): void;
	/**
	 * Drop every OVERRIDE — settings, screen renames/hides, layout overrides —
	 * returning the built-ins to defaults. The user's CREATIONS (custom cards,
	 * custom screens) are kept: they are not deviations from a default, they
	 * are authored content with no default to return to, and deleting them
	 * would make reset destructive — the opposite of "modify without fear".
	 * Each creation has its own explicit delete for when that is meant.
	 */
	resetAll(): void;

	/**
	 * Take a backup of the current overlay. The label is trimmed, capped at
	 * MAX_LABEL_LEN and defaulted when blank — here, so every caller is
	 * covered.
	 *
	 * The MACHINE half of this backup (Ruling 17) is kept only if a machine
	 * is currently identified, and only behind THAT machine's own store —
	 * never here, and never in the origin-global cache this store also
	 * writes. With no machine identified, the machine half is not recorded
	 * anywhere: there is nothing to attribute it to, and guessing is exactly
	 * the hazard this split exists to remove.
	 */
	snapshot(label: string): void;
	/**
	 * Restore the overlay from a snapshot (the snapshot itself is kept).
	 *
	 * The PERSON half always applies. The MACHINE half applies only if the
	 * CURRENTLY connected machine is the one that took the snapshot — reading
	 * it back out of that machine's own store is what proves it, the same way
	 * the SD file proves itself on download. Reverting on a different machine
	 * (or with none identified) restores the person half only; the machine
	 * half is silently left as-is rather than guessed at.
	 */
	revert(index: number): void;

	/**
	 * Persist the overlay to the machine's SD card (and the local cache).
	 *
	 * `label` names the backup this save takes, so the Saved versions list can
	 * say what a revert would restore rather than ten rows of "saved". It is
	 * local-only: the uploaded payload is byte-identical with or without it.
	 */
	saveToMachine(connector: Connector, label?: string): Promise<void>;
	/** Load the overlay: SD card first, local cache as fallback. */
	loadFromMachine(connector: Connector): Promise<void>;
}

/**
 * `machineStore` names WHICH machine's local cache the machine half of the
 * overlay reads from and writes to. REQUIRED, not optional-with-a-default:
 * an optional parameter here was tried and is a defect, not a convenience —
 * `Accessor<MachineStore | null>` already says "identity may be unknown"
 * (pass `() => null` for that), so an omittable argument would let a real
 * call site (App.tsx once did) forget identity entirely and have the
 * compiler have nothing to say about it. A caller with no machine session
 * yet must write `() => null` at the call site, which is also documentation:
 * every test that does so is explicitly declaring "this test has no
 * machine" rather than silently defaulting into it.
 */
export function createConfigStore(options: { machineStore: Accessor<MachineStore | null> }): ConfigStore {
	const machineStore = options.machineStore;

	// Seed from the PERSON cache only — AND restore its dirty flag, so unsaved
	// edits made before a reload are still known to be unsaved and are not
	// overwritten from the SD card on the next connect. The machine half is
	// NOT seeded here: it depends on `machineStore`, which the hydrateMachine
	// computed below reads and applies synchronously, before this function
	// returns, whatever `machineStore` resolves to at construction time.
	//
	// The one-shot v2 migration below (readAndClearLegacyPersonCache runs at
	// most once per browser) never consults `machineStore()` (Ruling 18): a
	// legacy snapshot's machine half is exactly as unattributable as the live
	// overlay's — localStorage carries no proof of origin regardless of which
	// machine happens to be resolved at this synchronous instant — so it is
	// dropped unconditionally, the same as the live overlay's, never kept on
	// the strength of incidental boot ordering.
	const cached = loadPersonCache();
	let overlay: ConfigOverlay = joinOverlay({}, cached?.person ?? {});
	const [config, setConfig] = createStore<UiConfig>(effective(overlay));
	const [meta, setMeta] = createStore<{
		dirty: boolean; snapshots: ConfigSnapshot[]; droppedMachineSections: readonly string[];
		claimedProfile: ClaimedProfile | null;
	}>({
		dirty: cached?.dirty ?? false,
		// Restore the backup history too, so it survives a reload.
		snapshots: cached?.snapshots ?? [],
		droppedMachineSections: cached?.droppedMachineSections ?? [],
		// Never restored from cache: a claim is a fact about the SD card just
		// downloaded, not about this browser's own history, and there is
		// nothing claimed until loadFromMachine runs at least once.
		claimedProfile: null,
	});
	/**
	 * The claimed profile's ACTUAL machine-half values, pending Adopt.
	 *
	 * @invariant claimed-not-reachable-without-adopt
	 * @rung 6  choke-point, and a stronger one than the usual convention-only
	 *          kind: this is a closure-local variable with no export and no
	 *          field on `store`, so no code OUTSIDE this function can even
	 *          NAME it, let alone read it — a bypass from another module is
	 *          not merely discouraged, it is unwritable. `adoptClaimedProfile`
	 *          below is its one reader; nothing stops a second reader being
	 *          added INSIDE this same closure by a future edit to this file,
	 *          which is why this stays rung 6 rather than a claimed 7
	 * @why `store.meta.claimedProfile` (exposed, reactive) carries only the
	 *      origin and section NAMES — see ClaimedProfile's doc comment — so a
	 *      caller reading it can never mistake a claimed fact for live config.
	 *      The real values still have to live SOMEWHERE for Adopt to apply
	 *      them; keeping them here, off the store entirely, is what makes
	 *      "cannot be consumed as fact without an explicit act" true by
	 *      construction rather than by a caller remembering to check a flag
	 */
	let pendingClaimOverlay: DeepPartial<MachineConfig> | null = null;

	/**
	 * @invariant whole-cache-write
	 * @rung 6  choke-point — the single call to persistCache splits ONE
	 *          `overlay`/`meta` snapshot into its two halves rather than
	 *          reading them twice, so the person record and (when a machine is
	 *          identified) the machine record always describe the SAME edit —
	 *          never one a step ahead of the other. writeMachineOverlay is
	 *          itself the sole writer of the machine half (see its own
	 *          invariant below); this function is the only thing that calls it
	 * @why the three pieces (overlay, dirty, snapshots) are one fact about
	 *      "what the user has unsaved". Persisting two and dropping the third
	 *      is the dropped-snapshots bug: the overlay survived a reload while
	 *      the history it belonged to did not, so revert offered nothing to
	 *      revert to. Task 7 splits `overlay` itself across two records; a
	 *      second, independently-timed write path to either one would
	 *      reintroduce the same class of bug
	 * @debt promote by making persistCache take one CacheRecord value assembled
	 *       in one place, so a second call site physically cannot pass a subset.
	 */
	const persistCache = (): void => {
		const { machine, person } = splitOverlay(overlay);
		writePersonCache(person, meta.dirty, meta.snapshots);
		// Skipped ENTIRELY — not written as `{}` — when no machine is
		// identified. See writeMachineOverlay's own invariant.
		writeMachineOverlay(machineStore(), machine);
	};

	/**
	 * @invariant overlay-writes-persist
	 * @rung 6  choke-point — `commit` below is the only place `overlay` is
	 *          assigned, and it does all four steps together: assign, re-derive
	 *          the effective config, set the flag, cache. A fourth writer gets
	 *          them by having nowhere else to go. Promoted 2026-08-01 from a
	 *          rung 5 where three sites each repeated the same four lines — and
	 *          before that from a rung-6 claim that was simply FALSE, made by
	 *          reading the function instead of searching for the assignment
	 * @why every edit must cache and mark itself unsaved, or it vanishes on
	 *      reload — the 2026-07-25 report where imported, deleted and edited
	 *      screens all came back as if nothing had happened
	 * @debt `commit` is closure-private, so this holds within the module and
	 *       says nothing about a future module. Promotion to 7 is making the
	 *       overlay a branded value only commit can produce, so a second store
	 *       could not assign one either.
	 */
	/**
	 * The ONE place `overlay` is assigned. Everything that must happen with it —
	 * re-derive the effective config, set the unsaved flag, cache — happens
	 * here, so a new writer gets all four by having nowhere else to go. The
	 * callers differ only in the flag: an edit and a revert are unsaved work; a
	 * load from the card marks it saved; a machine-identity hydration (below)
	 * passes the CURRENT flag through unchanged, since re-deriving from a
	 * newly-known (or newly-lost) machine handle is not itself an edit.
	 */
	const commit = (next: ConfigOverlay, dirty: boolean): void => {
		overlay = next;
		setConfig(reconcile(effective(overlay)));
		setMeta("dirty", dirty);
		// Cache on EVERY change, with its flag. This is the one path every edit
		// — import, delete, card authoring, a role change — flows through, so
		// caching here is what makes any of them survive a reload.
		persistCache();
	};

	/**
	 * Re-derive the machine half for a (possibly new) machine handle: read the
	 * handle's own persisted overlay (or take `{}` when there is no handle),
	 * join it against the person half of whatever `overlay` currently holds,
	 * and commit that — through `commit`, never a second assignment site (see
	 * overlay-writes-persist above). This is what makes "B must not inherit
	 * A's machine state" true the instant identity changes, not merely on the
	 * next edit.
	 *
	 * The join is a full reconstruction: whatever the CURRENT machine half of
	 * `overlay` holds — including an edit made moments ago while `handle` was
	 * still `null` — is discarded, not carried forward or merged in. That is
	 * deliberate, not an oversight: an edit made with no machine known has no
	 * machine to belong to, and adopting it the instant one shows up would
	 * attribute it to whichever machine happens to answer first. That is
	 * exactly the inherited-envelope hazard this whole campaign exists to
	 * remove — an unset-envelope refusal is safe; a GUESSED one, sourced from
	 * an edit that was never actually validated against ANY machine's axes,
	 * is the crash. See test/config-cache-scope.test.ts's "an edit made before
	 * identity resolves is discarded" for the pinned behaviour.
	 *
	 * @invariant claim-invalidated-on-reidentify
	 * @rung 6  choke-point — this is the ONLY place `machineStore()` having
	 *          changed is acted on, so it is also the one place a stale claim
	 *          can be cleared the instant the machine it was checked against
	 *          stops being current. `pendingClaimOverlay` and
	 *          `meta.claimedProfile` are cleared here unconditionally, same as
	 *          the machine half of `overlay` a few lines above — never
	 *          re-attributed to the newly-current machine, never left
	 *          pointing at the one that is no longer connected
	 * @why a claim names the board it was checked against ("written for b.A")
	 *      by testing it against WHICHEVER machine was current at load time.
	 *      Spec §3 explicitly anticipates identity changing under a live
	 *      session (a mainboard swap, an SD card moved to another board) — a
	 *      claim raised against B and left standing after re-resolving to C
	 *      would let Adopt commit A's machine half (envelope included) into
	 *      config now keyed to C: the exact cross-machine leak this campaign
	 *      exists to make unrepresentable, reached THROUGH the confirm action
	 *      rather than around it
	 */
	const hydrateMachine = (handle: MachineStore | null): void => {
		const machine = readMachineOverlay(handle);
		const { person } = splitOverlay(overlay);
		commit(joinOverlay(machine, person), meta.dirty);
		pendingClaimOverlay = null;
		setMeta("claimedProfile", null);
	};

	/**
	 * Calls hydrateMachine every time `machineStore()` changes (identity
	 * resolving, or a future re-resolution).
	 *
	 * `createComputed`, NOT `createEffect`, and this is load-bearing, not a
	 * style choice: in this repo's solid-js (1.9.14), a `createEffect`'s very
	 * first run — and every later re-run, since it is not `pure` — is deferred
	 * past the caller's own synchronous code whenever it is created inside a
	 * still-open batch, which is every `createRoot` with no render loop (i.e.
	 * every construction site in this test suite and in a plain factory
	 * function called with no ambient root at all). Verified against
	 * node_modules/solid-js/dist/solid.js's Effects/Updates queues with a
	 * standalone repro: a `createEffect` inside such a root never ran at all
	 * before the root's callback returned, while `createComputed` ran
	 * synchronously on both creation and every signal write. A caller that
	 * switches machine and immediately reads its own config back (exactly what
	 * every test here does, and what any real caller reasonably would) must
	 * see the NEW machine's state in that same synchronous turn, not the
	 * previous one — the deferred form would leak the previous machine's
	 * config for the rest of the caller's turn, which is the exact class of
	 * bug this store exists to prevent.
	 *
	 * `untrack` wraps the call to hydrateMachine, past the one tracked read
	 * (`machineStore()`): hydrateMachine's own `commit` writes `config` and
	 * `meta`, and letting those writes register as dependencies of THIS
	 * computation would make it re-run on every unrelated edit for no reason,
	 * and risks a self-referential update loop.
	 */
	createComputed(() => {
		const handle = machineStore();
		untrack(() => hydrateMachine(handle));
	});

	/**
	 * The flag alone, for the two things that change whether work is saved
	 * without changing the overlay: a layout edit (geometry lives in the canvas
	 * store until Save reads it) and a successful upload.
	 */
	const markDirty = (dirty: boolean): void => {
		setMeta("dirty", dirty);
		persistCache();
	};

	const apply = (mutate: (draft: ConfigOverlay) => void): void => {
		const next = structuredClone(overlay);
		mutate(next);
		commit(prune(next) ?? {}, true);
	};

	const store: ConfigStore = {
		config,
		get dirty() { return meta.dirty; },

		markLayoutDirty() {
			// Deliberately not apply(): the overlay does not change here. The
			// geometry is read out of the canvas store when Save runs; all that
			// is needed now is for Save to be reachable, and for a reload to
			// know the work is unsaved.
			if (meta.dirty) return;
			markDirty(true);
		},
		get snapshots() { return meta.snapshots; },
		get droppedMachineSections() { return meta.droppedMachineSections; },
		get meta() { return meta; },

		adoptClaimedProfile() {
			if (pendingClaimOverlay === null) return;
			const { person } = splitOverlay(overlay);
			// Dirty, deliberately: the SD file itself still carries the OTHER
			// machine's stamp. Adopting only changes what THIS browser believes
			// in memory (and, via commit → persistCache, this machine's own
			// local cache) — the file is not re-stamped until the next Save.
			commit(joinOverlay(pendingClaimOverlay, person), true);
			pendingClaimOverlay = null;
			setMeta("claimedProfile", null);
		},
		clearClaimedProfile() {
			pendingClaimOverlay = null;
			setMeta("claimedProfile", null);
		},

		setAxisRole(letter, role) {
			apply(draft => { (draft.axisRoles ??= {})[letter] = role; });
		},
		clearAxisRole(letter) {
			apply(draft => { delete draft.axisRoles?.[letter]; });
		},
		setHeaterColor(heaterIndex, hex) {
			apply(draft => { (draft.heaterColors ??= {})[String(heaterIndex)] = hex; });
		},
		clearHeaterColor(heaterIndex) {
			apply(draft => { delete draft.heaterColors?.[String(heaterIndex)]; });
		},
		setThermalColors(patch) {
			apply(draft => { draft.thermalColors = { ...draft.thermalColors, ...patch }; });
		},
		setDockSensor(toolNumber, ref) {
			apply(draft => { (draft.dockSensors ??= {})[String(toolNumber)] = ref; });
		},
		clearDockSensor(toolNumber) {
			apply(draft => { delete draft.dockSensors?.[String(toolNumber)]; });
		},
		setCamera(patch) {
			apply(draft => { draft.camera = { ...draft.camera, ...patch }; });
		},
		setCameraPrefs(patch) {
			apply(draft => { draft.cameraPrefs = { ...draft.cameraPrefs, ...patch }; });
		},
		setSensorName(key, name) {
			apply(draft => { (draft.sensorNames ??= {})[key] = name; });
		},
		clearSensorName(key) {
			apply(draft => { delete draft.sensorNames?.[key]; });
		},
		setMacros(patch) {
			apply(draft => { draft.macros = { ...draft.macros, ...patch }; });
		},
		setBed(patch) {
			apply(draft => { draft.bed = { ...draft.bed, ...patch }; });
		},
		setShaping(patch) {
			apply(draft => {
				const next = { ...draft.shaping };
				if ("envelope" in patch) {
					const envelope = asEnvelope(patch.envelope);
					// Unset is spelled by ABSENCE — the overlay's own word for
					// "never customized" — and the default it falls back to is
					// null, which is the invariant (spec I8), not a placeholder.
					if (envelope === null) delete next.envelope;
					else next.envelope = envelope;
				}
				if (patch.defaults !== undefined) {
					next.defaults = { ...next.defaults, ...parseShapingDefaults(patch.defaults) };
				}
				draft.shaping = next;
			});
		},
		setAccelAddr(toolNumber, addr) {
			if (!isAccelAddr(addr)) return;
			apply(draft => {
				draft.shaping = {
					...draft.shaping,
					accelByTool: { ...draft.shaping?.accelByTool, [toolNumber]: addr },
				};
			});
		},
		clearAccelAddr(toolNumber) {
			apply(draft => {
				const accelByTool = { ...draft.shaping?.accelByTool };
				delete accelByTool[toolNumber];
				draft.shaping = { ...draft.shaping, accelByTool };
			});
		},

		addScreen(name) {
			const id = mintId("u-");
			apply(draft => {
				((draft.screens ??= {}).custom ??= {})[id] = { name, cards: {} };
			});
			return id;
		},
		renameScreen(id, name) {
			apply(draft => {
				const custom = isUserScreenId(id) ? draft.screens?.custom?.[id] : undefined;
				if (custom !== undefined) custom.name = name;
				else ((draft.screens ??= {}).renames ??= {})[id] = name;
			});
		},
		removeScreen(id) {
			apply(draft => { if (isUserScreenId(id)) delete draft.screens?.custom?.[id]; });
		},
		setScreenHidden(id, hidden) {
			apply(draft => {
				const screens = (draft.screens ??= {});
				const current = (screens.hidden ?? []).filter(h => h !== id);
				if (hidden) current.push(id);
				screens.hidden = current;
			});
		},
		replaceAllScreenCards(id, cards) {
			apply(draft => {
				const custom = isUserScreenId(id) ? draft.screens?.custom?.[id] : undefined;
				if (custom !== undefined) custom.cards = cards;
				else ((draft.screens ??= {}).layouts ??= {})[id] = cards;
			});
		},
		setScreenCard(screenId, cardId, rect) {
			apply(draft => {
				const custom = isUserScreenId(screenId) ? draft.screens?.custom?.[screenId] : undefined;
				const target = custom !== undefined
					? (custom.cards ??= {})
					: (((draft.screens ??= {}).layouts ??= {})[screenId] ??= {});
				if (rect === null) delete target[cardId];
				else target[cardId] = rect;
			});
		},

		addCustomCard(name, spec) {
			const id = mintId("c-");
			apply(draft => { (draft.cards ??= {})[id] = { name, spec }; });
			return id;
		},
		updateCustomCard(id, patch) {
			apply(draft => {
				const card = draft.cards?.[id];
				if (card === undefined) return;
				if (patch.name !== undefined) card.name = patch.name;
				if (patch.spec !== undefined) card.spec = patch.spec;
			});
		},
		removeCustomCard(id) {
			apply(draft => { delete draft.cards?.[id]; });
		},

		// Pins are a whole-array overlay (arrays replace wholesale in mergeInto),
		// so each mutator reads the CURRENT array off the draft — never the
		// config proxy, which structuredClone rejects — and writes the new one.
		addPin(command) {
			const id = mintPinId();
			apply(draft => { draft.pins = [...(draft.pins ?? []), { id, command, enabled: false }]; });
			return id;
		},
		updatePin(id, patch) {
			apply(draft => { draft.pins = (draft.pins ?? []).map(p => (p.id === id ? { ...p, ...patch } : p)); });
		},
		removePin(id) {
			apply(draft => { draft.pins = (draft.pins ?? []).filter(p => p.id !== id); });
		},
		setKeyedPin(key, command, enabled) {
			apply(draft => {
				const kept = (draft.pins ?? []).filter(p => p.key !== key);
				draft.pins = [...kept, { id: mintPinId(), command, enabled, key }];
			});
		},
		removeKeyedPin(key) {
			apply(draft => { draft.pins = (draft.pins ?? []).filter(p => p.key !== key); });
		},

		resetSection(section) {
			apply(draft => { delete draft[section]; });
		},
		resetAll() {
			apply(draft => {
				for (const key of Object.keys(draft)) {
					// Creations survive a reset (see the interface doc).
					if (key === "cards" || key === "screens") continue;
					delete draft[key as keyof ConfigOverlay];
				}
				// Within screens, only `custom` is a creation — renames, hidden,
				// and layout overrides are overrides and reset like everything else.
				const customScreens = draft.screens?.custom;
				delete draft.screens;
				if (customScreens !== undefined && Object.keys(customScreens).length > 0) {
					draft.screens = { custom: customScreens };
				}
			});
		},

		/*
		 * @invariant sole-snapshot-producer
		 * @rung 6  choke-point — the one place a ConfigSnapshot is appended, so
		 *          trim / default-when-blank / cap and the MAX_SNAPSHOTS eviction
		 *          are applied to every backup that exists. revert() only READS
		 *          the arrays; saveToMachine takes its backup by calling this
		 * @why a blank name renders as an unlabelled row in Saved versions, and
		 *      the operator reverts by reading those names — ten rows of "saved"
		 *      is the state this replaced. Uncapped, one pasted paragraph makes
		 *      the list unreadable, and the label is the only thing distinguishing
		 *      one restore point from another
		 * @debt promote by making ConfigSnapshot's label a branded SnapshotLabel
		 *       this function is the sole producer of, so a snapshot assembled
		 *       elsewhere cannot be pushed at all rather than merely not being.
		 */
		snapshot(label) {
			// The sole place a snapshot is created, so the label rule lives here
			// and nowhere else: trim, fall back when blank, cap the length. A
			// future caller inherits the guarantee without having to know it
			// exists — see MAX_LABEL_LEN.
			const clean = label.trim().slice(0, MAX_LABEL_LEN) || DEFAULT_SNAPSHOT_LABEL;
			// Split exactly like the live overlay (Ruling 17, types.ts splitOverlay)
			// — the person half is all that ever reaches meta.snapshots, which is
			// what makes it safe for writePersonCache to persist wholesale into
			// the origin-global cache below.
			const { machine, person } = splitOverlay(overlay);
			const id = mintSnapshotId();
			setMeta("snapshots", snapshots => {
				const next = [...snapshots, { id, takenAt: Date.now(), label: clean, overlay: structuredClone(person) }];
				return next.slice(-MAX_SNAPSHOTS);
			});
			// The machine half goes behind whichever machine is CURRENTLY
			// connected, in that machine's own store — never here, and never
			// under `id` alone without one. No machine identified means nothing
			// to attribute it to, so nothing is written: exactly writeMachineOverlay's
			// own null-skip, applied to snapshots instead of the live overlay.
			const handle = machineStore();
			if (handle !== null) {
				const existing = parseMachineSnapshots(handle.get("snapshots"));
				writeMachineSnapshots(handle, [...existing, { id, overlay: structuredClone(machine) }].slice(-MAX_SNAPSHOTS));
			}
			// Persist the new backup immediately — the whole point is that it
			// outlives the session that took it.
			persistCache();
		},
		/*
		 * @invariant revert-machine-half-scoped-to-current-machine
		 * @rung 6  choke-point — the machine half of a snapshot applies ONLY if
		 *          it is found in the CURRENTLY connected machine's OWN
		 *          "snapshots" key. Being found there IS the proof — the same
		 *          way reading the SD file back over a live connection to
		 *          board X proves it is board X's (migrateStorage.ts's header)
		 *          — so no separate stamp/claimed check is needed here: a
		 *          different machine's store cannot produce another machine's
		 *          id by construction (machineStore.ts's own rung-6/7 keying).
		 *          A different machine, no machine identified, or the entry
		 *          having aged out of that machine's own MAX_SNAPSHOTS cap all
		 *          read as "nothing to restore" — `{}` — never a guess
		 * @why snapshot() (above) is the sole writer of a machine's own
		 *      "snapshots" key and never writes under an id taken on a
		 *      different machine, so `.find(e => e.id === snap.id)` coming up
		 *      empty on machine B is not a lookup miss to work around — it is
		 *      the correct, safe answer for a snapshot machine B never took
		 */
		revert(index) {
			const snap = meta.snapshots[index];
			if (snap === undefined) return;
			const handle = machineStore();
			const machineOverlay = handle !== null
				? (parseMachineSnapshots(handle.get("snapshots")).find(e => e.id === snap.id)?.overlay ?? {})
				: {};
			// unwrap first: snapshots live in a Solid store, so snap.overlay is a
			// proxy and structuredClone throws DataCloneError on it. (Node's
			// server build of Solid hands back plain objects, which hid this —
			// the tests now run with --conditions=browser so they can't again.)
			commit(joinOverlay(machineOverlay, structuredClone(unwrap(snap.overlay))), true);
		},

		/*
		 * @invariant labels-never-travel
		 * @rung 6  choke-point plus a type with no room for it — the payload is
		 *          assembled here and nowhere else, out of `overlay` and the
		 *          connected machine's own id, and ConfigOverlay has no label
		 *          field for one to be written into. Labels live in `meta`, a
		 *          separate store the upload never reads
		 * @why a save name is about THIS browser's restore points. In the payload
		 *      it becomes machine configuration: it rides to the SD card, comes
		 *      back on every other browser that loads the file, and names a
		 *      snapshot none of them took. A named save and an unnamed one must
		 *      upload identical bytes
		 * @debt the payload is a hand-built object literal, so a future field is
		 *       one line away — `machineId` (Task 9) is exactly that field
		 *       arriving. Promote by giving ConfigOverlay a single serialize
		 *       that returns a branded ConfigPayload upload accepts, so what
		 *       travels is decided by the overlay's own type rather than here.
		 */
		/*
		 * @invariant no-unstamped-sd-write
		 * @rung 6  choke-point — this is the ONLY function that writes CONFIG_FILE,
		 *          and it refuses before taking a snapshot or touching the
		 *          connector at all when no machine is identified. A file with no
		 *          stamp is indistinguishable from one written by this exact bug,
		 *          which is what readStampedMachineOverlay treats a missing stamp
		 *          as (claimed, never adopted) — refusing here is cheaper than
		 *          relying on that fallback to catch it later
		 * @why identity resolves about one poll after boot (machineSession.ts). A
		 *      save attempted in that window must not put an unattributable file
		 *      on the card — the next machine to read it (even THIS one, on a
		 *      later boot with a different resolution) would have no stamp to
		 *      check and no way to tell "mine" from "nobody's"
		 */
		async saveToMachine(connector, label) {
			const handle = machineStore();
			if (handle === null) return;
			// The snapshot is taken from the overlay BEING saved, so the name
			// describes exactly the state that went to the card. The label is
			// local-only — it never reaches the payload below, so a named save
			// and an unnamed one upload identical bytes.
			store.snapshot(label ?? "");
			// stampMachineOverlay is the sole producer of a machine id string in
			// this format (config/migrateStorage.ts) — reached for here even
			// though only `.machineId` is used, so the SD file's stamp and the
			// browser's own per-machine cache stamp can never drift apart.
			const { machineId } = stampMachineOverlay(splitOverlay(overlay).machine, handle.id);
			const payload = JSON.stringify({ version: CONFIG_VERSION, machineId, overlay }, null, "\t");
			await connector.upload(CONFIG_FILE, payload);
			markDirty(false);
		},

		/*
		 * @invariant claimed-not-adopted
		 * @rung 6  choke-point — readStampedMachineOverlay (config/migrateStorage.ts,
		 *          Task 8) is the ONLY function that decides whether a downloaded
		 *          file's machine half matches the CONNECTED machine, and this is
		 *          its only caller on the SD load path. A mismatch (or a v3 file
		 *          old enough to carry no stamp at all) never reaches `commit`: the
		 *          machine half of THIS commit is either the stamp's own returned
		 *          overlay (matched, or migrated — a pre-v3 file amnestied per spec
		 *          §4) or the UNCHANGED current machine half (claimed) — never the
		 *          claimed file's bytes. Those bytes are held only in the
		 *          closure-private `pendingClaimOverlay` above, reachable solely
		 *          through `adoptClaimedProfile`
		 * @why spec §3: an SD card cloned or moved to another board must not have
		 *      its settings silently adopted (a foreign envelope becomes the box
		 *      the head is driven inside) or silently discarded (a real machine's
		 *      real settings would be lost the first time its OWN card fails to
		 *      round-trip through some other path). "Claimed, not adopted" is the
		 *      third option this function exists to make the default
		 */
		async loadFromMachine(connector) {
			// NEVER clobber unsaved local edits, in the general case — after an
			// import/delete/edit the cache is the freshest local truth for BOTH
			// halves (a machine-scoped edit is written straight to the
			// per-machine store, dirty or not — see persistCache/
			// writeMachineOverlay), and pulling an ordinary SD copy over it is
			// exactly how edits vanished on the first reload after they were
			// made. The one exception is spec §4's v2→v3 migration amnesty,
			// below: a pre-v3 file was never checked against a stamp at all, so
			// there is no "this SD copy might be stale" question to protect
			// against for ITS machine half — that half is empty locally by
			// construction (nothing was ever written to a per-machine store
			// before this campaign introduced one), so there is nothing there
			// FOR this guard to protect. `wasDirty` is captured once, up front,
			// so a machine-half edit made mid-await cannot change which branch
			// below applies out from under this call.
			const wasDirty = meta.dirty;

			let text: string | null = null;
			try {
				text = await connector.download(CONFIG_FILE);
			} catch (err) {
				// No config on the SD card yet — a fresh machine, not an error
				if (!(err instanceof FileNotFoundError)) throw err;
			}

			const noClaim = (): void => {
				pendingClaimOverlay = null;
				setMeta("claimedProfile", null);
			};

			if (text === null) {
				// No file on the card — nothing to reconcile the local overlay
				// against, migration included. Not dirty: keep the current
				// (cache-seeded) overlay and mark clean, exactly as before Task 9.
				// Dirty: leave the overlay AND the flag exactly as they are.
				noClaim();
				if (!wasDirty) commit(overlay, false);
				return;
			}

			const loaded = parseOverlayPayload(text);
			if (loaded === null) {
				// Corrupt or foreign-versioned — same fallback as no file at all.
				noClaim();
				if (!wasDirty) commit(overlay, false);
				return;
			}

			const handle = machineStore();
			if (handle === null) {
				// No identified machine — nothing to migrate FOR (a stamp names a
				// machine, and there isn't one to name yet) and nothing to protect
				// unsaved work against either (hydrateMachine will rebuild the
				// machine half from scratch the instant identity resolves — see
				// its own doc comment — so nothing loaded here survives that
				// anyway). Dirty here is the general guard: leave everything as
				// is, same as any other ordinary (non-migrating) dirty load below.
				//
				// Checked against GIT_86 Critical 1 (an origin-global `dirty`
				// gating a machine-scoped load) and NOT the same defect, on
				// purpose left as a plain `wasDirty` check rather than the
				// empty-local-half bypass added below: `handle` is null here,
				// so there is no per-machine local store to have a "the local
				// half is empty, nothing to protect" case at all — `commit`
				// below (unlike every branch below this one) takes `loaded`
				// WHOLESALE, person half included, with no wasDirty-based split
				// to protect it. `wasDirty` here can therefore only ever be
				// describing this browser's own unsaved PERSON edits (or a
				// previous, now-disconnected machine's — either way nothing a
				// per-machine bypass could distinguish, since there is no
				// machine store yet to check). Refusing is the ONLY protection
				// this branch has for the person half, so it stays unqualified.
				// Also: saveToMachine is a no-op while unidentified (I4), so
				// even a wrongly-blocked load here can never propagate into a
				// destructive write the way the identified branches' did.
				if (wasDirty) return;
				// Per spec §3, an unidentified machine has "no local machine cache
				// at all: SD is its only store" — so the file is trusted in full,
				// exactly as it was before this task, rather than held back with
				// nothing to eventually reconcile it against.
				noClaim();
				commit(loaded, false);
				return;
			}

			// A second, harmless JSON.parse of the same text: parseOverlayPayload
			// (above) already validated and migrated the OVERLAY, but its return
			// type carries no room for a sibling `machineId` field, and that
			// field has no version-migration story of its own (Task 9 is where it
			// is introduced) — so re-parsing here duplicates no business logic,
			// only the deserialization step. `fileVersion` is this same payload's
			// `version` field — readStampedMachineOverlay needs it to tell a
			// pre-v3 file (no stamp ever existed) apart from an unstamped v3 one
			// (a stamp existed and is missing) — see its own doc comment.
			let rawTop: unknown = null;
			try { rawTop = JSON.parse(text); } catch { /* parseOverlayPayload already proved this text parses */ }
			const fileVersion = isPlainObject(rawTop) && typeof rawTop.version === "number" ? rawTop.version : 0;

			const { person: filePerson, machine: fileMachineHalf } = splitOverlay(loaded);

			// readStampedMachineOverlay does its own parse/split of `.overlay`, so
			// the already-split, already-validated `fileMachineHalf` passes
			// through it unchanged when the stamp matches or the file migrates —
			// this is not a second validation pass, just the one choke point's
			// own contract.
			const stamped = readStampedMachineOverlay(
				{ machineId: isPlainObject(rawTop) ? rawTop.machineId : undefined, overlay: fileMachineHalf },
				handle.id,
				fileVersion,
			);

			// `dirty` is restored from `dwc-ng.person` (Ruling 18), which is
			// deliberately NOT machine-scoped — it is one flag describing BOTH
			// halves at once, for whichever machine happened to be current when
			// it was last set. Gating the MACHINE half's load on it, unqualified,
			// is GIT_86 Critical 1: unsaved work done while pointed at machine A
			// makes `wasDirty` true on the next boot pointed at machine B, and
			// refusing B's own, correctly-stamped SD file on the strength of
			// THAT leaves B's machine half at `{}` — which a later Save then
			// uploads over B's intact config. `a5aa651` (the outage fix) carved
			// out only `stamped.migrated` and never asked what else `dirty`
			// could be true ABOUT; this is that same guard's second destructive
			// instance, found by the postmortem's own named generator (local
			// confirmation for general confirmation) firing again in the fix for
			// the first.
			//
			// The guard's real job is protecting THIS machine's own local,
			// unsaved copy of ITS machine half from an ordinary SD load — never
			// a fact about the person half (which has its own protection below,
			// unconditionally) and never a fact about a DIFFERENT machine's
			// edits. `writeMachineOverlay` only ever writes to whichever machine
			// is CURRENT at edit time (persistCache/hydrateMachine, above), so a
			// machine whose local machine-half overlay is EMPTY has never had a
			// local edit made against it on this browser, by construction —
			// there is nothing for the guard to protect, and `wasDirty` in that
			// case can only describe the person half or a different machine's
			// session. A migration is exempted unconditionally regardless (spec
			// §4's amnesty is a different question). Every other case — this
			// machine's own local overlay already holds something — keeps the
			// full original guard: dirty means stop here, touching nothing.
			const noLocalMachineHalfToProtect = Object.keys(splitOverlay(overlay).machine).length === 0;
			if (!stamped.migrated && wasDirty && !noLocalMachineHalfToProtect) return;

			// The file's person section may be a DIFFERENT browser's — never this
			// browser's own unsaved edits. "keep it" whenever wasDirty, "take
			// the file's" otherwise — this now also covers the bypass above: a
			// machine-half bypass never implies the person half is safe to
			// overwrite too.
			const person = wasDirty ? splitOverlay(overlay).person : filePerson;

			if (stamped.migrated) {
				// Pre-v3: the file came off THIS board's own card over a live
				// connection — that IS its proof of origin (spec §3/§4) — adopted
				// for the machine we are connected to right now, then written
				// back stamped so the next load does not have to migrate again.
				// Routed through saveToMachine (never a second CONFIG_FILE write
				// site — see its own no-unstamped-sd-write invariant), which also
				// takes a labelled backup and clears `dirty`: the whole overlay,
				// person half included, is now genuinely on the card.
				noClaim();
				commit(joinOverlay(stamped.overlay, person), wasDirty);
				await store.saveToMachine(connector, "migrated to v3");
			} else if (stamped.claimed) {
				pendingClaimOverlay = fileMachineHalf;
				setMeta("claimedProfile", { writtenFor: stamped.writtenFor, sections: overlaySectionNames(fileMachineHalf) });
				// The machine half is left UNCHANGED — never the claimed file's
				// bytes, never reset to empty either (that would discard this
				// machine's own already-hydrated local truth for no reason).
				// `wasDirty`, not a hardcoded false: the bypass above can now
				// reach this branch WITH wasDirty true (empty local machine half,
				// a claimed file, an unsaved PERSON edit) — `person` was just
				// kept local in exactly that case, and the flag must say so, or
				// a real unsaved person edit would read as already saved.
				commit(joinOverlay(splitOverlay(overlay).machine, person), wasDirty);
			} else {
				noClaim();
				// `wasDirty`, not a hardcoded false — see the claimed branch's
				// comment just above; this branch is the ordinary bypass path
				// GIT_86 Critical 1 is about.
				commit(joinOverlay(stamped.overlay, person), wasDirty);
			}
		},
	};

	return store;
}

/**
 * The ONE id mint.
 *
 * @invariant id-namespace
 * @rung 7  the return type IS the proof — `${P}${string}` means a minted id
 *          carries its prefix in its TYPE, so a consumer expecting a UserScreenId
 *          cannot be handed a bare string and no cast appears at any call site
 * @why "u-" ids must never collide with built-in screen ids or the lab route,
 *      and "c-" ids never with registry CardIds. A collision would silently
 *      shadow a built-in screen with a user one, and the user could not delete
 *      what they had not created
 */
function mintId<P extends "u-" | "c-">(prefix: P): `${P}${string}` {
	return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Pin ids need no namespace guarantee (they key nothing) — just uniqueness. */
function mintPinId(): string {
	return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** defaults + overlay → the effective config (pure). */
function effective(overlay: ConfigOverlay): UiConfig {
	return mergeInto(structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>, overlay as Record<string, unknown>) as unknown as UiConfig;
}

function mergeInto(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	// safeEntries, not Object.entries: the patch may be raw JSON.parse output
	// (SD card / localStorage) and a "__proto__" key here would recurse into
	// Object.prototype and pollute it globally.
	for (const [key, value] of safeEntries(patch)) {
		if (value === undefined) continue;
		const existing = base[key];
		if (isPlainObject(value) && isPlainObject(existing)) {
			mergeInto(existing, value);
		} else {
			base[key] = structuredClone(value);
		}
	}
	return base;
}

/** Remove empty objects so "customized then cleared" equals "never touched". */
function prune(value: ConfigOverlay): ConfigOverlay | undefined {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of safeEntries(value)) {
		if (isPlainObject(entry)) {
			const pruned = prune(entry as ConfigOverlay);
			if (pruned !== undefined) out[key] = pruned;
		} else if (entry !== undefined) {
			out[key] = entry;
		}
	}
	return Object.keys(out).length > 0 ? (out as ConfigOverlay) : undefined;
}

/**
 * The cache carries a `dirty` flag alongside the overlay so a reload can tell
 * SAVED state from UNSAVED. Without it, an import, a delete, or any edit lived
 * only in memory: the next connect ran loadFromMachine, which overwrote it from
 * the SD card, and the work vanished with no warning (the "import doesn't work
 * after reload" report).
 */
/**
 * Snapshots (the Save-to-machine backup history) rebuilt from untrusted cache
 * JSON: each entry needs an id, a time, a label, and an overlay that re-passes
 * the same parse boundary as the live one. Anything malformed drops.
 *
 * @invariant snapshot-cache-is-person-only
 * @rung 6  choke-point — `splitOverlay(...).person` (not a bare parseOverlay)
 *          is deliberate, not redundant: this is the sole reader of the
 *          origin-global person cache's snapshot list, and it runs every
 *          entry's overlay through splitOverlay before returning, so even a
 *          hand-edited file, or one written by a build that had this wrong,
 *          cannot smuggle a machine-scoped byte out through it. `snapshot()`
 *          below is the sole writer and already produces a person-only
 *          overlay; this is what makes that true of the untrusted read path
 *          too, not merely of the one writer that behaves today
 * @why a snapshot used to clone the WHOLE joined overlay into this same
 *      record (Ruling 17) — reverting to one taken on machine A while pointed
 *      at machine B restored A's axis roles and envelope onto B, the exact
 *      inherited-envelope hazard this campaign exists to remove
 */
function parseSnapshots(raw: unknown): ConfigSnapshot[] {
	if (!Array.isArray(raw)) return [];
	const out: ConfigSnapshot[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry) || typeof entry.id !== "string" || typeof entry.takenAt !== "number" || typeof entry.label !== "string") continue;
		const overlay = splitOverlay(parseOverlay(isPlainObject(entry.overlay) ? entry.overlay : {})).person;
		out.push({ id: entry.id, takenAt: entry.takenAt, label: entry.label, overlay });
	}
	return out.slice(-MAX_SNAPSHOTS);
}

/** Snapshot ids need no namespace guarantee (they key nothing else) — just
 *  uniqueness, and stability as the join key between a person-scoped record
 *  (dwc-ng.person) and its machine-scoped half (whichever machine's own
 *  "snapshots" key holds it — see parseMachineSnapshots/writeMachineSnapshots). */
function mintSnapshotId(): string {
	return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** One machine's own record of the machine half of every snapshot IT has
 *  taken (see MachineStore's "snapshots" key, config/machineStore.ts). */
interface MachineSnapshotEntry {
	id: string;
	overlay: DeepPartial<MachineConfig>;
}

/**
 * Read back a machine's own "snapshots" key. `splitOverlay(parseOverlay(...))`
 * — not a bare cast — for the same reason parseSnapshots uses it: even a
 * hand-edited machine store must not be able to smuggle a person-scoped field
 * out through a machine-scoped read.
 */
function parseMachineSnapshots(raw: string | null): MachineSnapshotEntry[] {
	if (raw === null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!isPlainObject(parsed) || !Array.isArray(parsed.snapshots)) return [];
	const out: MachineSnapshotEntry[] = [];
	for (const entry of parsed.snapshots) {
		if (!isPlainObject(entry) || typeof entry.id !== "string") continue;
		const overlay = splitOverlay(parseOverlay(isPlainObject(entry.overlay) ? entry.overlay : {})).machine;
		out.push({ id: entry.id, overlay });
	}
	return out;
}

function writeMachineSnapshots(handle: MachineStore, entries: readonly MachineSnapshotEntry[]): void {
	handle.set("snapshots", JSON.stringify({ version: CONFIG_VERSION, snapshots: entries }));
}

/**
 * Both the person cache and a machine's own "config" key store the identical
 * `{version, overlay}` envelope the SD file uses — parseOverlayPayload already
 * knows that shape, drops mis-typed leaves, and handles the v1 migration and
 * any corruption. This just adapts "no record yet" (`null`) to "never
 * customized" (`{}`), so the two callers below don't each repeat that check.
 */
function parseCacheRecord(raw: string | null): ConfigOverlay {
	if (raw === null) return {};
	return parseOverlayPayload(raw) ?? {};
}

/**
 * @invariant legacy-snapshot-machine-half-unconditional-drop
 * @rung 6  choke-point — this is the ONLY place a legacy (pre-v3) snapshot's
 *          machine half is decided, and the decision is a constant: it is
 *          never written anywhere, and no parameter of this function names a
 *          machine to consult. There is nothing left to make conditional.
 * @why (Ruling 18) an earlier version wrote this half into whichever machine
 *      happened to be resolved by `machineStore()` at the synchronous instant
 *      `createConfigStore` runs — no stamp, no evidence, on data
 *      migrateStorage.ts's own header says "carries no such proof" and "must
 *      be DROPPED, never guessed at". That branch was unreachable in THIS
 *      app only because of incidental boot ordering (App.tsx constructs the
 *      config store before the machine session can resolve) — improbable,
 *      not impossible, and this project's standard is that a hazard must be
 *      unrepresentable, not merely unlikely today. There is nothing an
 *      operator could confirm a recovered half against either (the origin is
 *      unknowable in principle), so there is no "claimed, pending
 *      confirmation" state to offer instead — dropping it is the only
 *      correct answer
 *
 * The one-shot v2 → v3 backfill of the pre-split, origin-global legacy cache
 * (spec §4, campaign #76 phase 1 task 8; see migrateStorage.ts for the exact
 * key name — only that module may spell it). That legacy cache predates
 * Task 6/7's split and, like the live overlay it once carried, proves nothing
 * about which machine wrote its machine-scoped bytes — Ruling 17/18 apply the
 * identical drop-unconditionally rule to its snapshots that the live overlay
 * already follows.
 *
 * The drop is not silent (Ruling 19): every migrated snapshot that HAD a
 * non-empty machine half is named in the returned `droppedMachineSections`,
 * alongside the live overlay's own report, so the one channel the System
 * card already reads (Task 11) carries both.
 *
 * Returns `null` when there was nothing to migrate — the common case on every
 * boot after the first, since readAndClearLegacyPersonCache removes the key
 * on the one read that finds it.
 */
function migrateLegacyPersonCache(): {
	person: DeepPartial<PersonConfig>; dirty: boolean; snapshots: ConfigSnapshot[]; droppedMachineSections: string[];
} | null {
	const raw = readAndClearLegacyPersonCache();
	if (raw === null) return null;

	const { person, droppedMachineSections } = migratePersonCacheToV3(raw);
	let dirty = false;
	let rawSnapshots: unknown = [];
	try {
		const parsed = JSON.parse(raw) as { dirty?: unknown; snapshots?: unknown };
		dirty = parsed.dirty === true;
		rawSnapshots = parsed.snapshots;
	} catch {
		// keep defaults
	}

	// The machine half of every legacy snapshot is dropped, unconditionally
	// — see this function's own invariant above. Only the person half ever
	// becomes a ConfigSnapshot; a snapshot that HAD a machine half is still
	// named in droppedMachineSections, by its label, so the loss is visible
	// rather than silent (Ruling 19).
	const migrated = migrateLegacySnapshots(rawSnapshots);
	const snapshots: ConfigSnapshot[] = migrated.map(e => ({ id: e.id, takenAt: e.takenAt, label: e.label, overlay: e.person }));
	const droppedSnapshotLabels = migrated
		.filter(e => Object.keys(e.machine).length > 0)
		.map(e => `saved version "${e.label}"`);

	return { person, dirty, snapshots, droppedMachineSections: [...droppedMachineSections, ...droppedSnapshotLabels] };
}

/**
 * The PERSON half only. `dwc-ng.person` never hands a machine-scoped byte
 * back to a caller: this is the sole reader, and it runs the stored overlay
 * through `splitOverlay` before returning, so even a record written before
 * this split existed (or hand-edited) cannot smuggle a machine section out
 * through it.
 *
 * Also runs the one-shot legacy migration (migrateLegacyPersonCache) BEFORE
 * reading the current cache, and merges the two with `current` winning on
 * conflict — `dwc-ng.person` only exists at all once Task 7's code has run at
 * least once, so anything already in it postdates whatever the legacy key
 * carried and must not be clobbered by an older record.
 */
function loadPersonCache(): {
	person: DeepPartial<PersonConfig>; dirty: boolean; snapshots: ConfigSnapshot[]; droppedMachineSections: string[];
} | null {
	if (typeof localStorage === "undefined") return null;

	const legacy = migrateLegacyPersonCache();

	const raw = localStorage.getItem(CONFIG_CACHE_KEY);
	let current: { person: DeepPartial<PersonConfig>; dirty: boolean; snapshots: ConfigSnapshot[] } | null = null;
	if (raw !== null) {
		const { person } = splitOverlay(parseCacheRecord(raw));
		// dirty is a hint, not safety-critical — a garbled flag defaults to
		// clean, which at worst lets SD win, never destroys unsaved work
		// silently.
		let dirty = false;
		let snapshots: ConfigSnapshot[] = [];
		try {
			const parsed = JSON.parse(raw) as { dirty?: unknown; snapshots?: unknown };
			dirty = parsed.dirty === true;
			// The backup history (person halves only — see ConfigSnapshot and
			// snapshot()) persists here, not on the SD card and not in a
			// machine's own cache, which is what stops a reload from clearing
			// it.
			snapshots = parseSnapshots(parsed.snapshots);
		} catch {
			// keep defaults
		}
		current = { person, dirty, snapshots };
	}

	if (legacy === null) return current === null ? null : { ...current, droppedMachineSections: [] };
	if (current === null) {
		// Nothing to merge against. Persist immediately: the legacy key is
		// already gone (readAndClearLegacyPersonCache removed it on read), so
		// if this boot never reaches a save, the migrated data must already be
		// on disk or it is lost with nothing left to retry from.
		writePersonCache(legacy.person, legacy.dirty, legacy.snapshots);
		return legacy;
	}

	const merged = {
		person: mergeInto(structuredClone(legacy.person) as Record<string, unknown>, current.person as Record<string, unknown>) as DeepPartial<PersonConfig>,
		dirty: legacy.dirty || current.dirty,
		// Legacy (older) entries first; slice(-MAX_SNAPSHOTS) drops the
		// oldest first if the combined count exceeds the cap, same as every
		// other eviction in this file.
		snapshots: [...legacy.snapshots, ...current.snapshots].slice(-MAX_SNAPSHOTS),
		droppedMachineSections: legacy.droppedMachineSections,
	};
	writePersonCache(merged.person, merged.dirty, merged.snapshots);
	return merged;
}

/** Never throws — matching every other storage writer in this file (see
 *  writeMachineOverlay, and editor/drafts.ts / om/commandHistory.ts /
 *  om/consoleLog.ts's identical try/catch). GIT_86 finding 3: this used to
 *  be an uncaught setItem, and createComputed's construction-time
 *  hydrateMachine -> commit -> persistCache chain calls it SYNCHRONOUSLY
 *  from createConfigStore() — a quota-exceeded or storage-blocked browser
 *  (Safari private mode) threw out of App() and rendered nothing, where a
 *  failed write must instead mean "does not survive a reload", never a
 *  blank app. */
function writePersonCache(person: DeepPartial<PersonConfig>, dirty: boolean, snapshots: readonly ConfigSnapshot[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ version: CONFIG_VERSION, overlay: person, dirty, snapshots }));
	} catch {
		// Private mode / quota exceeded: this edit just won't survive a reload.
	}
}

/**
 * The MACHINE half only, read back out of the given handle's own "config"
 * key. `handle === null` (no identified machine) reads as "never
 * customized" — `{}` — exactly like a never-written key would; there is no
 * separate "identity unknown" state for a caller to mishandle.
 */
function readMachineOverlay(handle: MachineStore | null): DeepPartial<MachineConfig> {
	if (handle === null) return {};
	return splitOverlay(parseCacheRecord(handle.get("config"))).machine;
}

/**
 * @invariant no-machine-write-without-identity
 * @rung 6  choke-point — this is the ONLY function that writes a machine-
 *          scoped byte to storage (persistCache's sole call to it), and the
 *          gate is a plain runtime branch: `handle === null` returns before
 *          touching storage at all. It inherits real strength from
 *          machineStore.ts's own rung 6/7 work rather than standing alone —
 *          `handle` can only ever be a `MachineStore`, and `openMachineStore`
 *          can only mint one from an `IdentifiedMachine` — so this branch is
 *          the LAST place an unidentified machine is kept out, not the only
 *          one
 * @why identity resolves about one poll after boot (machineSession.ts). An
 *      edit made in that window must not survive anywhere, or the very first
 *      write after connecting to a machine could land under a stale
 *      resolution, or vanish into a key nobody ever reads back — either way
 *      it is the cross-machine leak this whole campaign exists to close
 * @debt this function's contract depends on its caller never fabricating a
 *       `MachineStore` for the wrong machine — nothing here re-checks that a
 *       `handle`'s `id` matches "the current machine" beyond what
 *       machineSession.ts already guarantees by construction.
 */
function writeMachineOverlay(handle: MachineStore | null, machine: DeepPartial<MachineConfig>): void {
	if (handle === null) return;
	handle.set("config", JSON.stringify({ version: CONFIG_VERSION, overlay: machine }));
}
