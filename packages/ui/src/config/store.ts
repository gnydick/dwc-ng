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

export interface ConfigStore {
	/** Effective config = defaults + overlay. Read this in the UI. */
	config: UiConfig;
	/** True when the overlay changed since the last save/load. */
	readonly dirty: boolean;
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

	/** Take a backup of the current overlay. The label is trimmed, capped at
	 *  MAX_LABEL_LEN and defaulted when blank — here, so every caller is
	 *  covered. */
	snapshot(label: string): void;
	/** Restore the overlay from a snapshot (the snapshot itself is kept). */
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
 * overlay reads from and writes to. Omitting it (every call site not yet
 * wired to identity resolution) is the same as passing `() => null` — the
 * store still works, it just never has anywhere machine-scoped to persist
 * to, which is the correct behaviour for "identity unknown" rather than a
 * degraded one (see the hydrateMachine computed below and
 * writeMachineOverlay's invariant).
 */
export function createConfigStore(options?: { machineStore?: Accessor<MachineStore | null> }): ConfigStore {
	const machineStore: Accessor<MachineStore | null> = options?.machineStore ?? (() => null);

	// Seed from the PERSON cache only — AND restore its dirty flag, so unsaved
	// edits made before a reload are still known to be unsaved and are not
	// overwritten from the SD card on the next connect. The machine half is
	// NOT seeded here: it depends on `machineStore`, which the hydrateMachine
	// computed below reads and applies synchronously, before this function
	// returns, whatever `machineStore` resolves to at construction time.
	const cached = loadPersonCache();
	let overlay: ConfigOverlay = joinOverlay({}, cached?.person ?? {});
	const [config, setConfig] = createStore<UiConfig>(effective(overlay));
	const [meta, setMeta] = createStore<{ dirty: boolean; snapshots: ConfigSnapshot[] }>({
		dirty: cached?.dirty ?? false,
		// Restore the backup history too, so it survives a reload.
		snapshots: cached?.snapshots ?? [],
	});

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
	 */
	const hydrateMachine = (handle: MachineStore | null): void => {
		const machine = readMachineOverlay(handle);
		const { person } = splitOverlay(overlay);
		commit(joinOverlay(machine, person), meta.dirty);
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
		 *          the array; saveToMachine takes its backup by calling this
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
			setMeta("snapshots", snapshots => {
				const next = [...snapshots, { takenAt: Date.now(), label: clean, overlay: structuredClone(overlay) }];
				return next.slice(-MAX_SNAPSHOTS);
			});
			// Persist the new backup immediately — the whole point is that it
			// outlives the session that took it.
			persistCache();
		},
		revert(index) {
			const snap = meta.snapshots[index];
			if (snap === undefined) return;
			// unwrap first: snapshots live in a Solid store, so snap.overlay is a
			// proxy and structuredClone throws DataCloneError on it. (Node's
			// server build of Solid hands back plain objects, which hid this —
			// the tests now run with --conditions=browser so they can't again.)
			commit(structuredClone(unwrap(snap.overlay)), true);
		},

		/*
		 * @invariant labels-never-travel
		 * @rung 6  choke-point plus a type with no room for it — the payload is
		 *          assembled here and nowhere else, out of `overlay` alone, and
		 *          ConfigOverlay has no label field for one to be written into.
		 *          Labels live in `meta`, a separate store the upload never reads
		 * @why a save name is about THIS browser's restore points. In the payload
		 *      it becomes machine configuration: it rides to the SD card, comes
		 *      back on every other browser that loads the file, and names a
		 *      snapshot none of them took. A named save and an unnamed one must
		 *      upload identical bytes
		 * @debt the payload is a hand-built object literal, so a future field is
		 *       one line away. Promote by giving ConfigOverlay a single serialize
		 *       that returns a branded ConfigPayload upload accepts, so what
		 *       travels is decided by the overlay's own type rather than here.
		 */
		async saveToMachine(connector, label) {
			// The snapshot is taken from the overlay BEING saved, so the name
			// describes exactly the state that went to the card. The label is
			// local-only — it never reaches the payload below, so a named save
			// and an unnamed one upload identical bytes.
			store.snapshot(label ?? "");
			const payload = JSON.stringify({ version: CONFIG_VERSION, overlay }, null, "\t");
			await connector.upload(CONFIG_FILE, payload);
			markDirty(false);
		},

		async loadFromMachine(connector) {
			// NEVER clobber unsaved local edits. After an import/delete/edit the
			// cache is the freshest local truth; pulling the SD config over it is
			// exactly how imports vanished on the first reload after they were
			// made. The operator still Saves to machine to push, or reverts to
			// pull — but a mere reconnect must not silently discard their work.
			if (meta.dirty) return;
			let loaded: ConfigOverlay | null = null;
			try {
				loaded = parseOverlayPayload(await connector.download(CONFIG_FILE));
			} catch (err) {
				// No config on the SD card yet — a fresh machine, not an error
				if (!(err instanceof FileNotFoundError)) throw err;
			}
			// Keep the current (cache-seeded) overlay when the SD has none.
			commit(loaded ?? overlay, false);
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
/** Snapshots (the Save-to-machine backup history) rebuilt from untrusted cache
 *  JSON: each entry needs a time, a label, and an overlay that re-passes the
 *  same parse boundary as the live one. Anything malformed drops. */
function parseSnapshots(raw: unknown): ConfigSnapshot[] {
	if (!Array.isArray(raw)) return [];
	const out: ConfigSnapshot[] = [];
	for (const entry of raw) {
		if (!isPlainObject(entry) || typeof entry.takenAt !== "number" || typeof entry.label !== "string") continue;
		out.push({ takenAt: entry.takenAt, label: entry.label, overlay: parseOverlay(isPlainObject(entry.overlay) ? entry.overlay : {}) });
	}
	return out.slice(-MAX_SNAPSHOTS);
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
 * The PERSON half only. `dwc-ng.person` never hands a machine-scoped byte
 * back to a caller: this is the sole reader, and it runs the stored overlay
 * through `splitOverlay` before returning, so even a record written before
 * this split existed (or hand-edited) cannot smuggle a machine section out
 * through it.
 */
function loadPersonCache(): { person: DeepPartial<PersonConfig>; dirty: boolean; snapshots: ConfigSnapshot[] } | null {
	if (typeof localStorage === "undefined") return null;
	const raw = localStorage.getItem(CONFIG_CACHE_KEY);
	if (raw === null) return null;
	const { person } = splitOverlay(parseCacheRecord(raw));
	// dirty is a hint, not safety-critical — a garbled flag defaults to clean,
	// which at worst lets SD win, never destroys unsaved work silently.
	let dirty = false;
	let snapshots: ConfigSnapshot[] = [];
	try {
		const parsed = JSON.parse(raw) as { dirty?: unknown; snapshots?: unknown };
		dirty = parsed.dirty === true;
		// The backup history persists here (not on the SD card, and not in a
		// machine's own cache) — that is what stops a reload from clearing it.
		// Each snapshot carries a WHOLE overlay clone taken at snapshot() time
		// (see its invariant), machine sections included — a revert only makes
		// sense against the machine it was taken on, which the operator is
		// expected to be connected to when they use it (phase 1 does not gate
		// revert on machine identity).
		snapshots = parseSnapshots(parsed.snapshots);
	} catch {
		// keep defaults
	}
	return { person, dirty, snapshots };
}

function writePersonCache(person: DeepPartial<PersonConfig>, dirty: boolean, snapshots: readonly ConfigSnapshot[]): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ version: CONFIG_VERSION, overlay: person, dirty, snapshots }));
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
