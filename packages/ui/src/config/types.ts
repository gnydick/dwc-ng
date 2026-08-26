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
}

/**
 * Whether the camera panel is shown. Split out of CameraConfig: the stream
 * URL is a fact about this machine's wiring, but pinning it is a viewing
 * habit — the same person pins it on every machine they run.
 */
export interface CameraPrefsConfig {
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
 *
 * Wholly PERSON-scoped (Ruling 12, Gabe): layout geometry — like custom
 * screens, renames and hidden state — is an operator's own arrangement
 * preference, not a fact about the machine. The machine-shaped provisioning
 * this might look like it should encode instead (how many tool cards, how
 * many axis rows) is a first-time-load survey's job, not something layout
 * geometry should be made to carry. This section does not span the split.
 */
export type ScreenLayouts = Record<string, Record<string, SlotRect>>;

export interface ScreensConfig {
	custom: Record<UserScreenId, CustomScreen>;
	/** Built-in id → display-name override. A rename never touches identity. */
	renames: Record<string, string>;
	/** Built-in ids removed from the nav (still recoverable — it's overlay). */
	hidden: string[];
	/** Built-in id → full composition override (membership + geometry). */
	layouts: ScreenLayouts;
}

/** The three colours a heater reading takes as it warms. */
export interface ThermalColors {
	cold: string;
	warm: string;
	hot: string;
}

/**
 * Shipped thermal ramp, mixed for the vellum ground — slate blue → burnt amber
 * → brick. These are the
 * same values index.css declares for --t-cold/--t-warm/--t-hot; the overlay
 * overwrites those custom properties at runtime, so this object and the
 * stylesheet must agree. index.css cites this constant for that reason.
 */
export const DEFAULT_THERMAL_COLORS: ThermalColors = {
	cold: "#3f6485",
	warm: "#9a5f0a",
	hot: "#c2380f",
};

/**
 * An inclusive `[lo, hi]` bound with `lo < hi`, so it always denotes a
 * NON-EMPTY span. Minted only by `asRange` (config/parse.ts) — the type
 * cannot say "ordered", so the one gate that checks it is the only producer.
 */
export type Range = readonly [number, number];

/**
 * The rectangle of bed the shaping lab is allowed to move the carriage in.
 *
 * It is deliberately WHOLE: there is no half-envelope, because a box missing
 * an axis cannot answer "is this point inside?" and anything that cannot
 * answer that must not gate motion. `asEnvelope` returns one or `null`.
 */
export interface Envelope {
	readonly x: Range;
	readonly y: Range;
}

/**
 * Motion parameters a capture run starts from; every one is user-editable.
 *
 * MOTION ONLY. There is deliberately no accelerometer sample count here: how
 * many samples a capture needs is a consequence of how long the move takes and
 * how long the ring-down lasts, and `shaping/procedure.ts captureTiming`
 * derives it per pass. It used to be a field, and a single value cannot serve a
 * speed ladder — on 2026-08-23 the slowest pass of a sweep needed 8× the
 * recording of the fastest and got the same 1,500 samples, so it recorded 1.09 s
 * of a 4.0 s move. A key of this name in a stored overlay is simply dropped by
 * `parseShapingDefaults`, which is what makes older configs harmless.
 */
export interface ShapingDefaults {
	/** Length of the excitation move, mm. */
	readonly distMm: number;
	/** Feed for that move, mm/s. */
	readonly speedMmS: number;
	/** Captures per axis per direction. */
	readonly repeats: number;
}

/**
 * Input-shaping lab configuration.
 *
 * @invariant envelope-is-config-not-default
 * @rung 6  choke-point — `envelope` ships as `null` and the ONLY producer of a
 *          non-null one is `asEnvelope` (config/parse.ts), which both the
 *          untrusted-overlay boundary and the store's `setShaping` call. There
 *          is no code path that derives a box from the object model's axis
 *          limits, and no literal reaches `overlay.shaping.envelope` without
 *          passing that gate. PARTIALITY is already rung 7 and needs no gate:
 *          `Envelope | null` is a union, so DeepPartial does not descend into
 *          it and `{ x: [...] }` alone is a compile error in ConfigOverlay.
 *          What the type cannot say is `lo < hi`; that is what asRange checks
 * @why a shaping run drives the carriage the full length of the envelope at
 *      high speed. A guessed extent — axis limits, a shipped default, a
 *      half-entered box — is a crash into the frame. Refusing to move until a
 *      human has stated the box makes the machine's safe region a fact someone
 *      asserted, never one this UI inferred
 * @debt promote to rung 7 by branding `Envelope` so a hand-written object
 *       literal is not assignable and a future writer physically cannot skip
 *       `asEnvelope`. Blocked on the brand having to survive JSON round-trips
 *       to the SD card; today the guarantee is "one gate, two callers".
 */
export interface ShapingConfig {
	/** The permitted XY box. `null` = unset; motion is refused (spec I8). */
	readonly envelope: Envelope | null;
	readonly defaults: ShapingDefaults;
	/** Tool number → accelerometer address "board.slot" (M955/M956 P). */
	readonly accelByTool: Readonly<Record<number, string>>;
}

/**
 * Everything a config section describes about THIS MACHINE — meaningless, or
 * actively dangerous, carried to a different printer. Task 7 stores this half
 * keyed by machine identity so it can never be inherited across machines.
 */
export interface MachineConfig {
	/** Axis letter → human role label ("U" → "Z motor 1"). RRF has no
	 * notion of axis roles; this is per-machine UI metadata. */
	axisRoles: Record<string, string>;
	/** Heater index (as string key) → chart line colour override. Absent =
	 * the derived palette colour from om/heaterSeries.ts, which guarantees no
	 * two SHIPPED lines are confusable. A user override is warned about at
	 * ΔE < 25 but never blocked — see util/colorDistance.ts. */
	heaterColors: Record<string, string>;
	/** Tool number (as string key) → dock presence sensor. The sensor knows
	 * docked/away, never "mounted" — label accordingly. */
	dockSensors: Record<string, DockSensorRef>;
	camera: CameraConfig;
	/** Sensor slot key (endstopKey/filamentKey/probeKey from
	 * om/sensorRows.ts, e.g. "probe:0") → human name. RRF only knows
	 * indices; this replaces the auto-generated label on the Machine view's
	 * Sensors card wherever set. */
	sensorNames: Record<string, string>;
	bed: BedConfig;
	/** Commands re-sent on an interval to override a running job — fan speed
	 *  pins (keyed "fan:<n>") and arbitrary user rows. See PinnedCommand. */
	pins: PinnedCommand[];
	/** Input-shaping lab: the motion envelope (unset by default — see
	 *  ShapingConfig), the capture-run defaults, and the per-tool
	 *  accelerometer address. */
	shaping: ShapingConfig;
}

/**
 * Everything a config section describes about the PERSON operating the UI —
 * the same on every machine they use. Task 7 stores this half unkeyed, so it
 * follows the operator rather than the printer.
 */
export interface PersonConfig {
	/** Colours for the cold/warm/hot temperature readings. */
	thermalColors: ThermalColors;
	/** Whether the camera panel is pinned — a viewing habit, not a fact about
	 *  the camera itself (see CameraPrefsConfig). */
	cameraPrefs: CameraPrefsConfig;
	macros: MacrosConfig;
	/** Screens as user truth: custom screens, renames, hidden state, AND
	 *  layout geometry (Ruling 12) — see ScreensConfig. */
	screens: ScreensConfig;
	/** User-authored cards, keyed by minted "c-" ids (the prefix keeps them
	 *  out of the registry CardId namespace by construction). */
	cards: Record<CustomCardId, CustomCardDef>;
}

/**
 * Effective config = machine half + person half. Unchanged for readers: every
 * existing `config().axisRoles`, `config().thermalColors`, etc. still resolves
 * — the split lives in how the two halves are produced and stored, not in how
 * they're read.
 */
export type UiConfig = MachineConfig & PersonConfig;

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

/**
 * @invariant config-section-scope
 * @rung 6  choke-point — MACHINE_SECTIONS and PERSON_SECTIONS partition
 *          keyof UiConfig, and test/config-scope.test.ts fails if their
 *          union is not exactly Object.keys(DEFAULT_CONFIG). A new section
 *          cannot be added without being given a scope
 * @why an unscoped section defaults to whichever half the code happens to
 *      write, and the half it must not default into is the machine one: that
 *      is how an envelope crosses machines
 */
// Widened to `readonly (keyof X)[]` rather than left as the `as const` tuple
// TS would otherwise infer: a fixed-length readonly tuple concatenates with
// another tuple (via spread) into a wider fixed-length tuple, which cannot be
// cast to `string[]` (TS2352 — readonly tuple, not overlapping a mutable
// array). Widening here is what lets callers spread-and-cast freely.
export const MACHINE_SECTIONS: readonly (keyof MachineConfig)[] = [
	"axisRoles", "heaterColors", "dockSensors", "camera", "sensorNames", "bed", "pins", "shaping",
] as const satisfies readonly (keyof MachineConfig)[];
export const PERSON_SECTIONS: readonly (keyof PersonConfig)[] = [
	"thermalColors", "cameraPrefs", "macros", "cards", "screens",
] as const satisfies readonly (keyof PersonConfig)[];

/**
 * Divide an overlay along the machine/person line (spec §4, Ruling 12). A
 * clean whole-section partition — no section spans both halves, so a section
 * present in the overlay goes entirely to whichever list names it.
 */
export function splitOverlay(o: ConfigOverlay): { machine: DeepPartial<MachineConfig>; person: DeepPartial<PersonConfig> } {
	const machine: Record<string, unknown> = {};
	const person: Record<string, unknown> = {};
	for (const k of MACHINE_SECTIONS) if (k in o) machine[k] = o[k];
	for (const k of PERSON_SECTIONS) if (k in o) person[k] = o[k];
	return { machine: machine as DeepPartial<MachineConfig>, person: person as DeepPartial<PersonConfig> };
}

/** Recombine the two halves into one overlay. The inverse of `splitOverlay`. */
export function joinOverlay(machine: DeepPartial<MachineConfig>, person: DeepPartial<PersonConfig>): ConfigOverlay {
	return { ...machine, ...person } as ConfigOverlay;
}

export const DEFAULT_MACHINE_CONFIG: MachineConfig = {
	axisRoles: {},
	heaterColors: {},
	dockSensors: {},
	camera: { streamUrl: "" },
	sensorNames: {},
	bed: { probePointCommand: 'M98 P"0:/macros/dwc-ng/reprobe.g" X{x} Y{y}' },
	pins: [],
	// envelope: null is the invariant, not an omission — see ShapingConfig.
	shaping: {
		envelope: null,
		defaults: { distMm: 60, speedMmS: 200, repeats: 3 },
		accelByTool: {},
	},
};

export const DEFAULT_PERSON_CONFIG: PersonConfig = {
	thermalColors: DEFAULT_THERMAL_COLORS,
	cameraPrefs: { pinned: false },
	// Off by default: a fresh install asks before firing a macro at the machine.
	macros: { autoConfirmRun: false },
	screens: { custom: {}, renames: {}, hidden: [], layouts: {} },
	cards: {},
};

export const DEFAULT_CONFIG: UiConfig = {
	...DEFAULT_MACHINE_CONFIG,
	...DEFAULT_PERSON_CONFIG,
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
