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

/**
 * Minted id namespaces, as types. A custom card id ALWAYS starts "c-", a
 * user screen id ALWAYS starts "u-" — which keeps both out of the registry
 * CardId and built-in/lab route namespaces by construction. The mint
 * (config/store.ts mintId) is the only producer; the overlay parser
 * (config/parse.ts) drops foreign keys that don't match, so a hand-edited
 * SD file cannot smuggle an id into someone else's namespace either.
 */
export type CustomCardId = `c-${string}`;
export type UserScreenId = `u-${string}`;

export const isCustomCardId = (id: string): id is CustomCardId => id.startsWith("c-");
export const isUserScreenId = (id: string): id is UserScreenId => id.startsWith("u-");

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
	/**
	 * Content layout direction for cards that offer the toggle. Part of the
	 * SLOT, deliberately: it used to live only in localStorage under
	 * "<canvasKey>.orientation", which meant it was in no persistence tier at
	 * all — it never exported, never imported, never rode to SD, and never
	 * seeded a new browser. Carrying it here puts it on the same single route
	 * as geometry.
	 */
	orientation?: "vertical" | "horizontal";
}

/** A user-created screen: display name + its card slots. */
export interface CustomScreen {
	name: string;
	cards: Record<string, SlotRect>;
}

/**
 * A user-authored card: a name and a control spec. The spec is stored as
 * OPAQUE JSON TEXT, deliberately: the overlay's prune() strips empty objects
 * recursively and mergeInto() deep-merges — either would corrupt spec data
 * it recursed into. A string passes both untouched and round-trips the
 * author's own formatting. It is parsed and compiled at the use site
 * (compose/controls/parse.ts), where a broken spec costs that card an error
 * body, never the screen.
 */
export interface CustomCardDef {
	name: string;
	/** JSON text of a compose/controls ControlSpec. */
	spec: string;
}

/**
 * A command the app RE-SENDS on an interval to override what a running job
 * asks for — a fan speed held against the slicer, a max acceleration pinned
 * to a value, and so on.
 *
 * This is a deliberate, user-requested EXCEPTION to the project's
 * controls-are-1:1-with-gcode rule: while a pin is enabled the app, not the
 * firmware, is the author of that value. Each pin is still a plain G-code
 * string — no encoded logic beyond "keep sending this" — and all enabled
 * pins are batched into ONE request per tick, so the re-assert loop costs the
 * weak embedded server a fixed ~2 requests/sec however many pins exist.
 */
export interface PinnedCommand {
	/** Stable id (minted "p-…"). */
	id: string;
	/** The G-code re-sent while enabled, e.g. "M204 P6000" or "M106 P0 S0.50". */
	command: string;
	/** Off by default: adding a row must not immediately start hitting the machine. */
	enabled: boolean;
	/**
	 * A stable key for UI-owned pins so their card can find and toggle its own
	 * pin — fan speed pins are keyed "fan:<n>". User-added arbitrary pins have
	 * no key.
	 */
	key?: string;
}

/**
 * Screens as user truth (design phase A7b). Built-in screens are immutable
 * code; everything the user does to them — rename, hide, change membership
 * or layout — is overlay data here, and reset drops it. Custom screens live
 * entirely here under minted "u-"-prefixed ids (the prefix keeps them out of
 * the built-in/lab route namespace by construction).
 */
export interface ScreensConfig {
	custom: Record<UserScreenId, CustomScreen>;
	/** Built-in id → display-name override. A rename never touches identity. */
	renames: Record<string, string>;
	/** Built-in ids removed from the nav (still recoverable — it's overlay). */
	hidden: string[];
	/** Built-in id → full composition override (membership + geometry). */
	layouts: Record<string, Record<string, SlotRect>>;
}

/** The three colours a heater reading takes as it warms. */
export interface ThermalColors {
	cold: string;
	warm: string;
	hot: string;
}

/**
 * Shipped thermal ramp — steel blue → amber → glowing orange. These are the
 * same values index.css declares for --t-cold/--t-warm/--t-hot; the overlay
 * overwrites those custom properties at runtime, so this object and the
 * stylesheet must agree. index.css cites this constant for that reason.
 */
export const DEFAULT_THERMAL_COLORS: ThermalColors = {
	cold: "#6e8ca8",
	warm: "#e0a458",
	hot: "#ef7b45",
};

export interface UiConfig {
	/** Axis letter → human role label ("U" → "Z motor 1"). RRF has no
	 * notion of axis roles; this is per-machine UI metadata. */
	axisRoles: Record<string, string>;
	/** Heater index (as string key) → chart line colour override. Absent =
	 * the derived palette colour from om/heaterSeries.ts, which guarantees no
	 * two SHIPPED lines are confusable. A user override is warned about at
	 * ΔE < 25 but never blocked — see util/colorDistance.ts. */
	heaterColors: Record<string, string>;
	/** Colours for the cold/warm/hot temperature readings. */
	thermalColors: ThermalColors;
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
	/** User-authored cards, keyed by minted "c-" ids (the prefix keeps them
	 *  out of the registry CardId namespace by construction). */
	cards: Record<CustomCardId, CustomCardDef>;
	/** Commands re-sent on an interval to override a running job — fan speed
	 *  pins (keyed "fan:<n>") and arbitrary user rows. See PinnedCommand. */
	pins: PinnedCommand[];
}

export type DeepPartial<T> = {
	// Arrays stay arrays: mapping string[] through the object arm would admit
	// { 0: "x" }-shaped non-arrays (the audit's screens.hidden white-screen).
	[K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type ConfigOverlay = DeepPartial<UiConfig>;

export interface ConfigSnapshot {
	takenAt: number;
	label: string;
	overlay: ConfigOverlay;
}

export const DEFAULT_CONFIG: UiConfig = {
	axisRoles: {},
	heaterColors: {},
	thermalColors: DEFAULT_THERMAL_COLORS,
	dockSensors: {},
	camera: { streamUrl: "", pinned: false },
	sensorNames: {},
	// Off by default: a fresh install asks before firing a macro at the machine.
	macros: { autoConfirmRun: false },
	bed: { probePointCommand: 'M98 P"0:/macros/dwc-ng/reprobe.g" X{x} Y{y}' },
	screens: { custom: {}, renames: {}, hidden: [], layouts: {} },
	cards: {},
	pins: [],
};

/** Where the overlay lives on the machine's SD card. */
export const CONFIG_FILE = "0:/sys/dwc-ng-config.json";
/** localStorage cache key (fast boot before the SD read lands). */
export const CONFIG_CACHE_KEY = "dwc-ng.config";
/** Bump when the overlay schema changes incompatibly. */
export const CONFIG_VERSION = 2;
export const MAX_SNAPSHOTS = 10;
/**
 * Longest a backup label may be. Labels reach localStorage (persistCache) and
 * render into a fixed-width list, so an unbounded one bloats the cache and
 * breaks the card's layout. Enforced in snapshot(), the sole place a snapshot
 * is created — no call site can introduce a label the list cannot render.
 */
export const MAX_LABEL_LEN = 60;
/** What an unnamed backup is called. A blank name must never block a save, and
 *  the row still carries its timestamp. */
export const DEFAULT_SNAPSHOT_LABEL = "saved";
