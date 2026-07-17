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
	/** Keep the floating tile visible across views. */
	pinned: boolean;
}

export interface ConsoleConfig {
	/** Undocked into a floating tile that survives navigation. */
	floating: boolean;
}

export interface UiConfig {
	/** Axis letter → human role label ("U" → "Z motor 1"). RRF has no
	 * notion of axis roles; this is per-machine UI metadata. */
	axisRoles: Record<string, string>;
	/** Tool number (as string key) → dock presence sensor. The sensor knows
	 * docked/away, never "mounted" — label accordingly. */
	dockSensors: Record<string, DockSensorRef>;
	camera: CameraConfig;
	console: ConsoleConfig;
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
	console: { floating: false },
};

/** Where the overlay lives on the machine's SD card. */
export const CONFIG_FILE = "0:/sys/dwc-ng-config.json";
/** localStorage cache key (fast boot before the SD read lands). */
export const CONFIG_CACHE_KEY = "dwc-ng.config";
/** Bump when the overlay schema changes incompatibly. */
export const CONFIG_VERSION = 1;
export const MAX_SNAPSHOTS = 10;
