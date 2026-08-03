import { createStore, reconcile, unwrap } from "solid-js/store";
import type { Connector } from "@dwc-ng/connector";
import { FileNotFoundError } from "@dwc-ng/connector";
import { isPlainObject, safeEntries } from "@dwc-ng/connector";
import { parseOverlay, parseOverlayPayload } from "./parse.ts";
import {
	CONFIG_CACHE_KEY, CONFIG_FILE, CONFIG_VERSION, DEFAULT_CONFIG, MAX_SNAPSHOTS,
	MAX_LABEL_LEN, DEFAULT_SNAPSHOT_LABEL,
	isUserScreenId,
	type CameraConfig, type ConfigOverlay, type ConfigSnapshot, type CustomCardId,
	type DockSensorRef, type BedConfig, type MacrosConfig, type SlotRect, type ThermalColors,
	type UiConfig, type UserScreenId,
} from "./types.ts";

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
	setSensorName(key: string, name: string): void;
	clearSensorName(key: string): void;
	setMacros(patch: Partial<MacrosConfig>): void;
	setBed(patch: Partial<BedConfig>): void;

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

export function createConfigStore(): ConfigStore {
	// Seed from the cache — AND restore its dirty flag, so unsaved edits made
	// before a reload are still known to be unsaved and are not overwritten from
	// the SD card on the next connect.
	const cached = loadCache();
	let overlay: ConfigOverlay = cached?.overlay ?? {};
	const [config, setConfig] = createStore<UiConfig>(effective(overlay));
	const [meta, setMeta] = createStore<{ dirty: boolean; snapshots: ConfigSnapshot[] }>({
		dirty: cached?.dirty ?? false,
		// Restore the backup history too, so it survives a reload.
		snapshots: cached?.snapshots ?? [],
	});

	/**
	 * @invariant whole-cache-write
	 * @rung 6  choke-point — the single call to writeCache, taking all three
	 *          pieces of state together, inside a closure nothing outside can
	 *          reach
	 * @why the three are one fact about "what the user has unsaved". Persisting
	 *      two and dropping the third is the dropped-snapshots bug: the overlay
	 *      survived a reload while the history it belonged to did not, so revert
	 *      offered nothing to revert to
	 * @debt promote by making writeCache take one CacheRecord value assembled in
	 *       one place, so a second call site physically cannot pass a subset.
	 */
	const persistCache = (): void => writeCache(overlay, meta.dirty, meta.snapshots);

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
	 * three callers differ only in the flag: an edit and a revert are unsaved
	 * work, a load from the card is not.
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

function loadCache(): { overlay: ConfigOverlay; dirty: boolean; snapshots: ConfigSnapshot[] } | null {
	if (typeof localStorage === "undefined") return null;
	const raw = localStorage.getItem(CONFIG_CACHE_KEY);
	if (raw === null) return null;
	// The real parse boundary (config/parse.ts): mis-typed leaves are dropped,
	// so a bad cached overlay can no longer crash every boot.
	const overlay = parseOverlayPayload(raw) ?? {};
	// dirty is a hint, not safety-critical — a garbled flag defaults to clean,
	// which at worst lets SD win, never destroys unsaved work silently.
	let dirty = false;
	let snapshots: ConfigSnapshot[] = [];
	try {
		const parsed = JSON.parse(raw) as { dirty?: unknown; snapshots?: unknown };
		dirty = parsed.dirty === true;
		// The backup history persists here (not on the SD card) — that is what
		// stops a reload from clearing it.
		snapshots = parseSnapshots(parsed.snapshots);
	} catch {
		// keep defaults
	}
	return { overlay, dirty, snapshots };
}

function writeCache(overlay: ConfigOverlay, dirty: boolean, snapshots: readonly ConfigSnapshot[]): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ version: CONFIG_VERSION, overlay, dirty, snapshots }));
}
