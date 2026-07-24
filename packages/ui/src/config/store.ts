import { createStore, reconcile, unwrap } from "solid-js/store";
import type { Connector } from "../connector/types.ts";
import { FileNotFoundError } from "../connector/types.ts";
import { isPlainObject, safeEntries } from "../util/safeObject.ts";
import { parseOverlayPayload } from "./parse.ts";
import {
	CONFIG_CACHE_KEY, CONFIG_FILE, CONFIG_VERSION, DEFAULT_CONFIG, MAX_SNAPSHOTS,
	isUserScreenId,
	type CameraConfig, type ConfigOverlay, type ConfigSnapshot, type CustomCardId,
	type DockSensorRef, type BedConfig, type MacrosConfig, type SlotRect, type UiConfig,
	type UserScreenId,
} from "./types.ts";

export interface ConfigStore {
	/** Effective config = defaults + overlay. Read this in the UI. */
	config: UiConfig;
	/** True when the overlay changed since the last save/load. */
	readonly dirty: boolean;
	readonly snapshots: readonly ConfigSnapshot[];

	setAxisRole(letter: string, role: string): void;
	clearAxisRole(letter: string): void;
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
	/** Replace a screen's card slots (membership + geometry) — custom screens
	 *  in place, built-ins via the layouts overlay. */
	updateScreenCards(id: string, cards: Record<string, SlotRect>): void;

	/** Create a user-authored card; returns its minted stable id ("c-…"). */
	addCustomCard(name: string, spec: string): CustomCardId;
	updateCustomCard(id: CustomCardId, patch: { name?: string; spec?: string }): void;
	removeCustomCard(id: CustomCardId): void;

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

	snapshot(label: string): void;
	/** Restore the overlay from a snapshot (the snapshot itself is kept). */
	revert(index: number): void;

	/** Persist the overlay to the machine's SD card (and the local cache). */
	saveToMachine(connector: Connector): Promise<void>;
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
		snapshots: [],
	});

	const apply = (mutate: (draft: ConfigOverlay) => void): void => {
		const next = structuredClone(overlay);
		mutate(next);
		overlay = prune(next) ?? {};
		setConfig(reconcile(effective(overlay)));
		setMeta("dirty", true);
		// Cache on EVERY mutation, marked unsaved. This is the one path every
		// edit — import, delete, card authoring, a role change — flows through,
		// so caching here is what makes any of them survive a reload.
		writeCache(overlay, true);
	};

	const store: ConfigStore = {
		config,
		get dirty() { return meta.dirty; },
		get snapshots() { return meta.snapshots; },

		setAxisRole(letter, role) {
			apply(draft => { (draft.axisRoles ??= {})[letter] = role; });
		},
		clearAxisRole(letter) {
			apply(draft => { delete draft.axisRoles?.[letter]; });
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
		updateScreenCards(id, cards) {
			apply(draft => {
				const custom = isUserScreenId(id) ? draft.screens?.custom?.[id] : undefined;
				if (custom !== undefined) custom.cards = cards;
				else ((draft.screens ??= {}).layouts ??= {})[id] = cards;
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

		snapshot(label) {
			setMeta("snapshots", snapshots => {
				const next = [...snapshots, { takenAt: Date.now(), label, overlay: structuredClone(overlay) }];
				return next.slice(-MAX_SNAPSHOTS);
			});
		},
		revert(index) {
			const snap = meta.snapshots[index];
			if (snap === undefined) return;
			// unwrap first: snapshots live in a Solid store, so snap.overlay is a
			// proxy and structuredClone throws DataCloneError on it. (Node's
			// server build of Solid hands back plain objects, which hid this —
			// the tests now run with --conditions=browser so they can't again.)
			overlay = structuredClone(unwrap(snap.overlay));
			setConfig(reconcile(effective(overlay)));
			setMeta("dirty", true);
		},

		async saveToMachine(connector) {
			store.snapshot("saved");
			const payload = JSON.stringify({ version: CONFIG_VERSION, overlay }, null, "\t");
			await connector.upload(CONFIG_FILE, payload);
			writeCache(overlay, false);
			setMeta("dirty", false);
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
			overlay = loaded ?? overlay;
			setConfig(reconcile(effective(overlay)));
			writeCache(overlay, false);
			setMeta("dirty", false);
		},
	};

	return store;
}

/**
 * The ONE id mint. The prefix IS the namespace guarantee: "u-" ids can never
 * collide with built-in screen ids or the lab route, "c-" ids can never
 * collide with registry CardIds — and the return type carries the proof, so
 * consumers hold a branded id without casting.
 */
function mintId<P extends "u-" | "c-">(prefix: P): `${P}${string}` {
	return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
function loadCache(): { overlay: ConfigOverlay; dirty: boolean } | null {
	if (typeof localStorage === "undefined") return null;
	const raw = localStorage.getItem(CONFIG_CACHE_KEY);
	if (raw === null) return null;
	// The real parse boundary (config/parse.ts): mis-typed leaves are dropped,
	// so a bad cached overlay can no longer crash every boot.
	const overlay = parseOverlayPayload(raw) ?? {};
	// dirty is a hint, not safety-critical — a garbled flag defaults to clean,
	// which at worst lets SD win, never destroys unsaved work silently.
	let dirty = false;
	try {
		dirty = (JSON.parse(raw) as { dirty?: unknown }).dirty === true;
	} catch {
		// keep dirty false
	}
	return { overlay, dirty };
}

function writeCache(overlay: ConfigOverlay, dirty: boolean): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ version: CONFIG_VERSION, overlay, dirty }));
}
