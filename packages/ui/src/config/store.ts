import { createStore, reconcile, unwrap } from "solid-js/store";
import type { Connector } from "../connector/types.ts";
import { FileNotFoundError } from "../connector/types.ts";
import {
	CONFIG_CACHE_KEY, CONFIG_FILE, CONFIG_VERSION, DEFAULT_CONFIG, MAX_SNAPSHOTS,
	type CameraConfig, type ConfigOverlay, type ConfigSnapshot, type DockSensorRef,
	type BedConfig, type MacrosConfig, type UiConfig,
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

	/** Drop one section's overlay — that section returns to defaults. */
	resetSection(section: keyof UiConfig): void;
	/** Drop the whole overlay — everything returns to defaults. */
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
	let overlay: ConfigOverlay = loadCache() ?? {};
	const [config, setConfig] = createStore<UiConfig>(effective(overlay));
	const [meta, setMeta] = createStore<{ dirty: boolean; snapshots: ConfigSnapshot[] }>({
		dirty: false,
		snapshots: [],
	});

	const apply = (mutate: (draft: ConfigOverlay) => void): void => {
		const next = structuredClone(overlay);
		mutate(next);
		overlay = prune(next) ?? {};
		setConfig(reconcile(effective(overlay)));
		setMeta("dirty", true);
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

		resetSection(section) {
			apply(draft => { delete draft[section]; });
		},
		resetAll() {
			apply(draft => { for (const key of Object.keys(draft)) delete draft[key as keyof ConfigOverlay]; });
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
			writeCache(overlay);
			setMeta("dirty", false);
		},

		async loadFromMachine(connector) {
			let loaded: ConfigOverlay | null = null;
			try {
				loaded = parsePayload(await connector.download(CONFIG_FILE));
			} catch (err) {
				// No config on the SD card yet — a fresh machine, not an error
				if (!(err instanceof FileNotFoundError)) throw err;
			}
			overlay = loaded ?? loadCache() ?? {};
			setConfig(reconcile(effective(overlay)));
			writeCache(overlay);
			setMeta("dirty", false);
		},
	};

	return store;
}

/** defaults + overlay → the effective config (pure). */
function effective(overlay: ConfigOverlay): UiConfig {
	return mergeInto(structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>, overlay as Record<string, unknown>) as unknown as UiConfig;
}

function mergeInto(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
	for (const [key, value] of Object.entries(patch)) {
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
	for (const [key, entry] of Object.entries(value)) {
		if (isPlainObject(entry)) {
			const pruned = prune(entry as ConfigOverlay);
			if (pruned !== undefined) out[key] = pruned;
		} else if (entry !== undefined) {
			out[key] = entry;
		}
	}
	return Object.keys(out).length > 0 ? (out as ConfigOverlay) : undefined;
}

function parsePayload(text: string): ConfigOverlay | null {
	try {
		const parsed = JSON.parse(text) as { version?: number; overlay?: ConfigOverlay };
		if (!isPlainObject(parsed) || !isPlainObject(parsed.overlay)) return null;
		// Future schema migrations hook in here, keyed on parsed.version
		return parsed.overlay;
	} catch {
		return null; // corrupt file → defaults, never a boot failure
	}
}

function loadCache(): ConfigOverlay | null {
	if (typeof localStorage === "undefined") return null;
	const raw = localStorage.getItem(CONFIG_CACHE_KEY);
	return raw === null ? null : parsePayload(raw);
}

function writeCache(overlay: ConfigOverlay): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ version: CONFIG_VERSION, overlay }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
