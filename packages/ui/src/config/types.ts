/**
 * User-truth configuration: everything the person customizes about THIS
 * machine's UI. Strictly separate from the OM store (machine truth).
 *
 * Design rules (design/README.md, "Modify without fear"):
 * - defaults are code (this file) and immutable;
 * - user customization is a deep-partial OVERLAY on those defaults;
 * - reset = delete from the overlay, so it cannot fail and new defaults
 *   arrive automatically wherever the user hasn't customized;
 * - only the overlay is ever persisted.
 */

export interface DockSensorRef {
	/** Index into sensors.gpIn reporting "tool is in its dock". */
	gpIn: number;
	/** Set when the switch reads 0 for docked. */
	inverted?: boolean;
}

export interface CameraConfig {
	/** MJPEG/stream URL; "" = no camera configured. */
	streamUrl: string;
	/** Show the camera panel — each view places/sizes it independently. */
	pinned: boolean;
}

export interface MacrosConfig {
	/**
	 * Run a macro on the first click instead of arming a confirm step.
	 *
	 * Deliberately persisted, unlike the dev write-arming flag: the checkbox is
	 * visible on the Macros view whenever the list is, so its state can always
	 * be read off the screen. The danger with write-arming was a belief that
	 * outlived the tab and could not be seen; that does not apply here.
	 */
	autoConfirmRun: boolean;
}

export interface BedConfig {
	/**
	 * Command sent to re-probe one height-map point. {x}/{y} are replaced with
	 * the cell's bed coordinates.
	 *
	 * A macro by default: the motion — and the preconditions this machine's
	 * mesh.g already enforces, like refusing to probe with a tool undocked —
	 * belongs in the operator's own config, not in this UI. A default that is
	 * wrong for a machine is fixed here rather than in a release.
	 */
	probePointCommand: string;
}

/** One card slot's grid rect (mirrors shell/panelCanvas PanelRect — inlined
 *  so config stays dependency-free; compose's parseComposition guards reads). */
export interface SlotRect {
	col: number;
	row: number;
	colSpan: number;
	rowSpan: number;
}

/** A user-created screen: display name + its card slots. */
export interface CustomScreen {
	name: string;
	cards: Record<string, SlotRect>;
}

/**
 * Screens as user truth (design phase A7b). Built-in screens are immutable
 * code; everything the user does to them — rename, hide, change membership
 * or layout — is overlay data here, and reset drops it. Custom screens live
 * entirely here under minted "u-"-prefixed ids (the prefix keeps them out of
 * the built-in/lab route namespace by construction).
 */
export interface ScreensConfig {
	custom: Record<string, CustomScreen>;
	/** Built-in id → display-name override. A rename never touches identity. */
	renames: Record<string, string>;
	/** Built-in ids removed from the nav (still recoverable — it's overlay). */
	hidden: string[];
	/** Built-in id → full composition override (membership + geometry). */
	layouts: Record<string, Record<string, SlotRect>>;
}

export interface UiConfig {
	/** Axis letter → human role label ("U" → "Z motor 1"). RRF has no
	 * notion of axis roles; this is per-machine UI metadata. */
	axisRoles: Record<string, string>;
	/** Tool number (as string key) → dock presence sensor. The sensor knows
	 * docked/away, never "mounted" — label accordingly. */
	dockSensors: Record<string, DockSensorRef>;
	camera: CameraConfig;
	/** Sensor slot key (endstopKey/filamentKey/probeKey from
	 * om/sensorRows.ts, e.g. "probe:0") → human name. RRF only knows
	 * indices; this replaces the auto-generated label on the Machine view's
	 * Sensors card wherever set. */
	sensorNames: Record<string, string>;
	macros: MacrosConfig;
	bed: BedConfig;
	screens: ScreensConfig;
}

export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type ConfigOverlay = DeepPartial<UiConfig>;

export interface ConfigSnapshot {
	takenAt: number;
	label: string;
	overlay: ConfigOverlay;
}

export const DEFAULT_CONFIG: UiConfig = {
	axisRoles: {},
	dockSensors: {},
	camera: { streamUrl: "", pinned: false },
	sensorNames: {},
	// Off by default: a fresh install asks before firing a macro at the machine.
	macros: { autoConfirmRun: false },
	bed: { probePointCommand: 'M98 P"0:/macros/dwc-ng/reprobe.g" X{x} Y{y}' },
	screens: { custom: {}, renames: {}, hidden: [], layouts: {} },
};

/** Where the overlay lives on the machine's SD card. */
export const CONFIG_FILE = "0:/sys/dwc-ng-config.json";
/** localStorage cache key (fast boot before the SD read lands). */
export const CONFIG_CACHE_KEY = "dwc-ng.config";
/** Bump when the overlay schema changes incompatibly. */
export const CONFIG_VERSION = 1;
export const MAX_SNAPSHOTS = 10;
