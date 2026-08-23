/**
 * Accelerometer (M955/M956) and input shaping (M593) emulation.
 *
 * The mock synthesises what an LIS3DH on a tool board would have recorded
 * during a move: the two acceleration pulses, whatever forced vibration the
 * cruise carries, and then the free ring-down of the axis mode — attenuated
 * by whatever shaper M593 has active. That is enough for the Shaping Lab's
 * whole loop (capture, fingerprint, rank, verify, apply) to run with no
 * machine attached.
 *
 * Deliberately NOT sharing code with `packages/ui/src/shaping/engine`: the
 * engine analyses captures and this models the machine that produced them.
 * The synthesis, the residual and the ring-down here are written from the
 * standard input-shaping expressions, so "the engine recovers the mode the
 * mock was told to ring at" exercises parse, stop detection, spectrum and
 * decay fit against a signal none of them produced.
 *
 * The one thing the two DO share is the shaper coefficients themselves: the
 * MZV amplitudes and the EI2/EI3 cubics in the damping ratio below are the
 * same published constants as `engine/shapers.ts` uses, because both are
 * modelling the same firmware and there is no second correct value for them.
 * So the cross-check proves the analysis pipeline, NOT the coefficients — a
 * transcription error in a cubic would agree with itself across both files.
 * Those are pinned instead by the residual tests in the engine's own suite
 * (a mistyped coefficient stops cancelling the mode it is tuned to).
 */

import type { Machine } from "./machine.ts";
import type { Om } from "./snapshot.ts";
import type { Params } from "./gcodeParams.ts";

/** LIS3DH in normal mode, the rate RRF reports on a tool board. */
export const SAMPLE_RATE_HZ = 1344;
/** Rates the mock will snap an M955 S parameter to. */
const RATES = [50, 100, 200, 400, 1344] as const;
/** Resolutions the mock will snap an M955 R parameter down to. */
const RESOLUTIONS = [8, 10, 12] as const;
const DEFAULT_RESOLUTION = 10;
const DEFAULT_ORIENTATION = 20;
const CAPTURE_DIR = "0:/sys/accelerometer";
/** 1 g in mm/s², so a pulse of a mm/s² reads a/G g on the moving axis. */
const G_MM_S2 = 9806.65;
/** Sensor noise, 1 sigma, on every axis of every sample. */
const NOISE_G = 0.01;
/** Ceiling on M956's S — a 16-bit sample count, as the wire format allows. */
const MAX_SAMPLES = 65535;

// --- the machine's mechanical fingerprint ----------------------------------

export type MockMode = {
	/** Undamped natural frequency, Hz. */
	readonly f: number;
	/** Damping ratio. */
	readonly zeta: number;
	/** Ring amplitude immediately after the stop, g. */
	readonly g: number;
};

export type MockModes = {
	readonly X: MockMode;
	readonly Y: MockMode;
	/**
	 * A driven vibration carried by the cruise rather than a free mode: fixed
	 * in frequency, with an amplitude that grows with speed. `gAt100` is that
	 * amplitude at 100 mm/s. It is what a speed sweep exists to separate from
	 * a resonance, and what makes the sweep matrix show anything at all.
	 */
	readonly forced?: { readonly hz: number; readonly gAt100: number };
};

/**
 * Gabe's toolchanger, measured 2026-08-22 by the prototype:
 * `tools/accel/runs/ring/ring1/fingerprint.json` gives X 18.13 Hz ζ0.127
 * 0.050 g and Y 51.59 Hz ζ0.075 0.103 g; the 250 Hz component is the one
 * `tools/accel/report.py:156` records as tracked to ±5 Hz across speeds.
 * Read for the numbers, never for code.
 */
export const DEFAULT_MODES: MockModes = {
	X: { f: 18.13, zeta: 0.127, g: 0.05 },
	Y: { f: 51.59, zeta: 0.075, g: 0.103 },
	forced: { hz: 250, gAt100: 0.08 },
};

// --- shapers ---------------------------------------------------------------

export type Impulse = { readonly amplitude: number; readonly delayS: number };

export type ShaperType = "none" | "zvd" | "zvdd" | "zvddd" | "mzv" | "ei2" | "ei3" | "custom";

export const SHAPER_TYPES: readonly ShaperType[] = [
	"none", "zvd", "zvdd", "zvddd", "mzv", "ei2", "ei3", "custom",
];

export type ShaperRequest =
	| { readonly type: "none" }
	| { readonly type: "zvd" | "zvdd" | "zvddd" | "mzv" | "ei2" | "ei3"; readonly f: number; readonly zeta: number }
	| { readonly type: "custom"; readonly H: readonly number[]; readonly T: readonly number[] };

/**
 * The impulse train RRF would compute for a request.
 *
 * @invariant every-shaper-is-modelled
 * @rung 8  illegal state unrepresentable — ShaperRequest is a discriminated
 *          union and this is one exhaustive switch with a `never` arm, so a
 *          shaper type added to the union stops compilation until its train
 *          exists. There is no default arm that could return an unshaped
 *          train for a type nobody wrote, and the named form carries F/S
 *          while the custom form carries H/T, so the parameters cannot be
 *          paired with the wrong type
 * @why a shaper the mock silently failed to model would leave the ring at
 *      full height, and the Verify step would report a real shaper as having
 *      done nothing — a wrong verdict about the machine, produced by the test
 *      rig rather than measured
 */
export function impulseTrain(req: ShaperRequest): Impulse[] {
	switch (req.type) {
		// A single unit impulse: no shaping, and no special case downstream —
		// its residual against any mode is exactly 1.
		case "none":
			return [{ amplitude: 1, delayS: 0 }];
		case "zvd":
			return binomial(2, req.f, req.zeta);
		case "zvdd":
			return binomial(3, req.f, req.zeta);
		case "zvddd":
			return binomial(4, req.f, req.zeta);
		case "mzv":
			return mzv(req.f, req.zeta);
		case "ei2":
			return ei(EI2, req.f, req.zeta);
		case "ei3":
			return ei(EI3, req.f, req.zeta);
		case "custom": {
			const sum = req.H.reduce((a, b) => a + b, 0);
			const amplitudes = [...req.H, 1 - sum];
			return amplitudes.map((amplitude, i) => ({ amplitude, delayS: i === 0 ? 0 : req.T[i - 1]! }));
		}
		default: {
			const unhandled: never = req;
			throw new Error(`unmodelled shaper: ${JSON.stringify(unhandled)}`);
		}
	}
}

/** Damped period: every ZV-family impulse sits on a multiple of half of it. */
function dampedPeriod(f: number, zeta: number): number {
	return 1 / (f * Math.sqrt(1 - zeta * zeta));
}

/**
 * The ZV family (ZVD, ZVDD, ZVDDD) is one shape: amplitudes proportional to
 * the binomial coefficients times K^i, spaced half a damped period apart.
 * Order n gives n+1 impulses.
 */
function binomial(n: number, f: number, zeta: number): Impulse[] {
	const root = Math.sqrt(1 - zeta * zeta);
	const td = dampedPeriod(f, zeta);
	const k = Math.exp((-zeta * Math.PI) / root);
	const raw: number[] = [];
	let coefficient = 1;
	for (let i = 0; i <= n; i++) {
		raw.push(coefficient * Math.pow(k, i));
		coefficient = (coefficient * (n - i)) / (i + 1);
	}
	const total = raw.reduce((a, b) => a + b, 0);
	return raw.map((amp, i) => ({ amplitude: amp / total, delayS: (i * td) / 2 }));
}

/** MZV — three impulses on eighths of the damped period. RRF orders them k² first. */
function mzv(f: number, zeta: number): Impulse[] {
	const root = Math.sqrt(1 - zeta * zeta);
	const td = dampedPeriod(f, zeta);
	const k = Math.exp((-zeta * 0.75 * Math.PI) / root);
	const a1 = 1 - Math.SQRT1_2;
	const a2 = (Math.SQRT2 - 1) * k;
	const a3 = a1 * k * k;
	const total = a1 + a2 + a3;
	return [
		{ amplitude: a3 / total, delayS: 0 },
		{ amplitude: a2 / total, delayS: (3 * td) / 8 },
		{ amplitude: a1 / total, delayS: (3 * td) / 4 },
	];
}

/**
 * EI shapers: amplitude and delay are cubics in the damping ratio, the delays
 * in units of the damped period. Two-hump (EI2) and three-hump (EI3) forms.
 */
/**
 * One row per impulse, so the amplitude and delay cubics cannot get out of
 * step with each other or with the impulse count. The LAST row carries no
 * amplitude: the published cubics only approximately sum to 1, and RRF closes
 * the train by deriving the final amplitude from the rest, which is also the
 * only way the train is guaranteed unit gain.
 */
type EiRow = { readonly amplitude: readonly number[] | null; readonly delay: readonly number[] };

const EI2: readonly EiRow[] = [
	{ amplitude: [0.16054, 0.76699, 2.2656, -1.2275], delay: [0, 0, 0, 0] },
	{ amplitude: [0.33911, 0.45081, -2.5808, 1.7365], delay: [0.4989, 0.1627, -0.54262, 6.1618] },
	{ amplitude: [0.34089, -0.61533, -0.68765, 0.42261], delay: [0.99748, 0.18382, -1.5827, 8.1712] },
	{ amplitude: null, delay: [1.4992, -0.09297, -0.28338, 1.8571] },
];

const EI3: readonly EiRow[] = [
	{ amplitude: [0.11275, 0.76632, 3.2916, -1.4438], delay: [0, 0, 0, 0] },
	{ amplitude: [0.23698, 0.61164, -2.5785, 4.8522], delay: [0.49974, 0.23834, 0.44559, 12.472] },
	{ amplitude: [0.30008, -0.19062, -2.1456, 0.13744], delay: [0.99849, 0.29808, -2.3646, 23.399] },
	{ amplitude: [0.23775, -0.73297, 0.46885, -2.0865], delay: [1.4987, 0.10306, -2.0139, 17.032] },
	{ amplitude: null, delay: [1.9996, -0.28231, 0.61536, 5.4045] },
];

function cubic(c: readonly number[], zeta: number): number {
	return c[0]! + c[1]! * zeta + c[2]! * zeta * zeta + c[3]! * zeta * zeta * zeta;
}

function ei(table: readonly EiRow[], f: number, zeta: number): Impulse[] {
	const td = dampedPeriod(f, zeta);
	let assigned = 0;
	return table.map(row => {
		const amplitude = row.amplitude === null ? 1 - assigned : cubic(row.amplitude, zeta);
		assigned += amplitude;
		return { amplitude, delayS: cubic(row.delay, zeta) * td };
	});
}

/**
 * Fraction of the unshaped vibration that survives an impulse train at a
 * damped mode — the vector sum of the impulses' contributions at the damped
 * frequency, decayed to the last impulse.
 */
export function residual(train: readonly Impulse[], mode: MockMode): number {
	if (train.length === 0) return 1;
	const wn = 2 * Math.PI * mode.f;
	const wd = wn * Math.sqrt(1 - mode.zeta * mode.zeta);
	let cos = 0;
	let sin = 0;
	let gain = 0;
	for (const impulse of train) {
		const growth = Math.exp(mode.zeta * wn * impulse.delayS);
		cos += impulse.amplitude * growth * Math.cos(wd * impulse.delayS);
		sin += impulse.amplitude * growth * Math.sin(wd * impulse.delayS);
		gain += impulse.amplitude;
	}
	const last = train[train.length - 1]!.delayS;
	return (Math.exp(-mode.zeta * wn * last) * Math.hypot(cos, sin)) / (gain === 0 ? 1 : gain);
}

// --- the synthetic capture -------------------------------------------------

export interface SynthOptions {
	/** Sample rate, Hz. */
	readonly rate: number;
	readonly samples: number;
	/** Which machine axis moved; the other in-plane axis reads only noise. */
	readonly axis: "X" | "Y";
	/** Commanded speed, mm/s. */
	readonly speed: number;
	/** Signed move length, mm — the sign is the direction of both pulses. */
	readonly dist: number;
	/** Acceleration, mm/s². */
	readonly accel: number;
	readonly modes: MockModes;
	/** The active shaper's train; absent means unshaped. */
	readonly shaper?: readonly Impulse[];
}

/**
 * The CSV an M956 capture would contain, trailer included.
 *
 * @invariant captures-are-reproducible
 * @rung 6  choke-point — this is the only producer of capture text, and it is
 *          a pure function of `SynthOptions`: the noise comes from a PRNG
 *          seeded by hashing those options, and the module imports no clock
 *          and no global entropy, so nothing inside it can differ between two
 *          runs. The seed deliberately excludes `shaper`, which makes a
 *          shaped/unshaped pair a controlled experiment on one noise
 *          realisation rather than two draws. Purity is the mechanism; the
 *          `Math.random`/`Date` source scan in test/accelerometer.test.ts is
 *          support, not the enforcement
 * @why a mock whose output moved between runs would turn every tolerance in
 *      the shaping tests into a flake, and a verdict about a machine that
 *      changes on a re-run is worse than no verdict
 * @debt promotion to 7 is a branded `CaptureCsv` string type minted only
 *       here, so a hand-built CSV cannot reach the SD write in `onMove`. It
 *       is worth doing at the same time as the `CaptureFile` promotion filed
 *       under capture-files-come-only-from-the-synth, not before.
 */
export function synthCapture(o: SynthOptions): string {
	const direction = o.dist < 0 ? -1 : 1;
	const dist = Math.abs(o.dist);
	const accel = Math.max(1, o.accel);
	// A move too short to reach the commanded speed is triangular: the peak
	// velocity is whatever the ramp reaches by the midpoint. Deriving it here
	// is what keeps the cruise duration from going negative.
	const speed = Math.max(1e-6, Math.min(Math.abs(o.speed), Math.sqrt(dist * accel)));
	const tAccel = speed / accel;
	const tCruise = Math.max(0, dist / speed - 2 * tAccel);
	const tStop = 2 * tAccel + tCruise;

	const mode = o.modes[o.axis];
	const surviving = o.shaper === undefined ? 1 : residual(o.shaper, mode);
	const wn = 2 * Math.PI * mode.f;
	const wd = wn * Math.sqrt(1 - mode.zeta * mode.zeta);
	const pulseG = (accel / G_MM_S2) * direction;
	const forced = o.modes.forced;
	const forcedG = forced === undefined ? 0 : forced.gAt100 * (speed / 100);

	const noise = gaussian(seedOf(o));
	const rows: string[] = ["Sample,X,Y,Z"];
	for (let i = 0; i < o.samples; i++) {
		const t = i / o.rate;
		let moving: number;
		if (t < tAccel) {
			moving = pulseG;
		} else if (t < tAccel + tCruise) {
			moving = forced === undefined ? 0 : forcedG * Math.sin(2 * Math.PI * forced.hz * (t - tAccel));
		} else if (t < tStop) {
			moving = -pulseG;
		} else {
			const u = t - tStop;
			moving = direction * mode.g * surviving * Math.exp(-mode.zeta * wn * u) * Math.cos(wd * u);
		}
		// Three draws per sample in a fixed order, whatever the moving axis is,
		// so the noise realisation depends on the motion and nothing else.
		const nx = noise();
		const ny = noise();
		const nz = noise();
		const x = (o.axis === "X" ? moving : 0) + nx;
		const y = (o.axis === "Y" ? moving : 0) + ny;
		const z = 1 + nz;
		rows.push(`${i},${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`);
	}
	rows.push(`Rate ${o.rate}, overflows 0`);
	return rows.join("\n") + "\n";
}

/** FNV-1a over the motion, so identical motion gives identical noise. */
function seedOf(o: SynthOptions): number {
	const key = [
		o.rate, o.samples, o.axis, o.speed, o.dist, o.accel,
		o.modes.X.f, o.modes.X.zeta, o.modes.X.g,
		o.modes.Y.f, o.modes.Y.zeta, o.modes.Y.g,
		o.modes.forced?.hz ?? 0, o.modes.forced?.gAt100 ?? 0,
	].join("|");
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** mulberry32 — small, fast, and reproducible from a 32-bit seed. */
function uniform(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Box–Muller over `uniform`, scaled to the sensor's noise floor. */
function gaussian(seed: number): () => number {
	const next = uniform(seed);
	let spare: number | null = null;
	return () => {
		if (spare !== null) {
			const value = spare;
			spare = null;
			return value * NOISE_G;
		}
		const u = Math.max(1e-12, next());
		const v = next();
		const r = Math.sqrt(-2 * Math.log(u));
		spare = r * Math.sin(2 * Math.PI * v);
		return r * Math.cos(2 * Math.PI * v) * NOISE_G;
	};
}

// --- hardware state --------------------------------------------------------

type UnitConfig = { rate: number; resolution: number };
type Armed = { readonly board: number; readonly samples: number; readonly path: string };

/**
 * Per-board accelerometer configuration and the pending M956.
 *
 * Presence and orientation are NOT stored here — they live in
 * `boards[n].accelerometer` in the object model, which is what a client reads.
 * This holds only what the object model has no field for (rate, resolution)
 * and the armed capture.
 */
export class AccelBank {
	/** The mechanical fingerprint the synth rings at. Scenarios set it. */
	modes: MockModes = DEFAULT_MODES;
	private readonly units = new Map<number, UnitConfig>();
	private armed: Armed | null = null;

	config(board: number): UnitConfig {
		let unit = this.units.get(board);
		if (unit === undefined) {
			unit = { rate: SAMPLE_RATE_HZ, resolution: DEFAULT_RESOLUTION };
			this.units.set(board, unit);
		}
		return unit;
	}

	arm(pending: Armed): void {
		this.armed = pending;
	}

	/** Consumes the pending capture; a second move finds nothing. */
	take(): Armed | null {
		const pending = this.armed;
		this.armed = null;
		return pending;
	}

	/** M999: firmware config goes, the machine's resonances do not. */
	reset(): void {
		this.units.clear();
		this.armed = null;
	}
}

/** `P20.0` -> board 20, device 0. `P0` -> board 0, device 0. */
function parseAddress(raw: string | null): { board: number; device: number; text: string } | null {
	if (raw === null) return null;
	const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
	if (match === null) return null;
	const board = parseInt(match[1]!, 10);
	const device = match[2] === undefined ? 0 : parseInt(match[2], 10);
	return { board, device, text: `${board}:${device}` };
}

function boardAt(om: Om, canAddress: number): Om | undefined {
	return (om.boards as Om[]).find(b => b !== null && b.canAddress === canAddress);
}

/** The OM's accelerometer object for an address, or null when there is none. */
function accelAt(om: Om, addr: { board: number; device: number }): Om | null {
	if (addr.device !== 0) return null;
	return boardAt(om, addr.board)?.accelerometer ?? null;
}

/**
 * Give the model an accelerometer if it has none — the synthetic base model
 * ships without one, and a scenario about shaping needs something to talk to.
 * Returns the address that now answers.
 */
export function ensureAccelerometer(machine: Machine, orientation = 41): string {
	const boards = machine.om.boards as Om[];
	for (const board of boards) {
		if (board !== null && board.accelerometer != null) return `${board.canAddress}.0`;
	}
	const first = boards.find(b => b !== null);
	if (first === undefined) return "";
	first.accelerometer = { orientation, points: 0, runs: 0 };
	machine.bump("boards");
	return `${first.canAddress}.0`;
}

// --- M955 ------------------------------------------------------------------

export function executeM955(machine: Machine, p: Params): string {
	const addr = parseAddress(p.raw("P"));
	if (addr === null) return "Error: M955: missing or malformed P parameter";
	const board = boardAt(machine.om, addr.board);
	const pins = p.quoted("C");
	let accel = accelAt(machine.om, addr);
	if (accel === null) {
		// C names the CS/INT pins, which is how a mainboard accelerometer is
		// declared in config.g; without it there is simply nothing at P.
		if (board === undefined || pins === null || addr.device !== 0) {
			return `Error: Accelerometer ${addr.text} not found`;
		}
		accel = { orientation: DEFAULT_ORIENTATION, points: 0, runs: 0 };
		board.accelerometer = accel;
		machine.bump("boards");
	}

	const orientation = p.num("I");
	const rate = p.num("S");
	const resolution = p.num("R");
	if (orientation === null && rate === null && resolution === null && pins === null) {
		return reportAccelerometer(machine, addr.board, accel);
	}
	if (orientation !== null) {
		accel.orientation = orientation;
		machine.bump("boards");
	}
	const unit = machine.accel.config(addr.board);
	if (rate !== null) {
		unit.rate = nearest(RATES, rate);
		// R is read only alongside S, exactly as M955 documents it.
		unit.resolution = resolution === null ? unit.resolution : atMost(RESOLUTIONS, resolution);
	}
	return "";
}

function reportAccelerometer(machine: Machine, board: number, accel: Om): string {
	const unit = machine.accel.config(board);
	return (
		`Accelerometer ${board}:0 type LIS3DH with orientation ${accel.orientation} ` +
		`samples at ${unit.rate}Hz with ${unit.resolution}-bit resolution`
	);
}

function nearest(options: readonly number[], wanted: number): number {
	return options.reduce((best, n) => (Math.abs(n - wanted) < Math.abs(best - wanted) ? n : best), options[0]!);
}

function atMost(options: readonly number[], ceiling: number): number {
	const allowed = options.filter(n => n <= ceiling);
	return allowed.length === 0 ? options[0]! : Math.max(...allowed);
}

// --- M956 ------------------------------------------------------------------

export function executeM956(machine: Machine, p: Params): string {
	const addr = parseAddress(p.raw("P"));
	if (addr === null) return "Error: M956: missing or malformed P parameter";
	if (accelAt(machine.om, addr) === null) return `Error: Accelerometer ${addr.text} not found`;
	const samples = p.num("S");
	if (samples === null || samples <= 0) return "Error: M956: missing or bad S parameter";
	// The synth materialises every sample as a CSV row, so an S the board could
	// never honour has to be refused here rather than allocated: a request for
	// ten million samples would otherwise take the mock down instead of the
	// UI's error path.
	if (samples > MAX_SAMPLES) return `Error: M956: S parameter must be at most ${MAX_SAMPLES}`;
	if (p.num("A") === null) return "Error: M956: missing A parameter";

	// Every trigger value arms for the next move. RRF 3.6.3 was observed
	// delivering the whole move for A2 as well as A1 (the prototype finding
	// recorded in packages/ui/src/shaping/engine/capture.ts), and the mock has
	// no continuous time in which an A0 capture could run on its own.
	machine.accel.arm({
		board: addr.board,
		samples: Math.round(samples),
		path: capturePath(p.quoted("F") ?? defaultCaptureName(machine)),
	});
	return "";
}

function capturePath(name: string): string {
	const clean = name.trim().replaceAll("\\", "/");
	return /^\d+:|^\//.test(clean) ? clean : `${CAPTURE_DIR}/${clean}`;
}

/** RRF composes the name from the clock when F is absent; so does this. */
function defaultCaptureName(machine: Machine): string {
	const stamp = String(machine.om.state.time ?? "").replaceAll("-", "").replaceAll(":", "");
	return `${stamp === "" ? "capture" : stamp}.csv`;
}

/**
 * The armed capture fires on the next move that has X or Y in it.
 *
 * @invariant capture-files-come-only-from-the-synth
 * @rung 6  choke-point — this is the sole route from a MOVE to a file under
 *          `0:/sys/accelerometer`, and it consumes the armed record before it
 *          writes, so one M956 can produce at most one file. It does not own
 *          the directory: `rr_upload` (server.ts) and the DSF `PUT
 *          /machine/file` route (dsf.ts) write arbitrary bytes to any path,
 *          exactly as a real board lets you upload a CSV there
 * @why a second route from a move would be a capture whose contents were not
 *      produced by the model the tests fit against, and the Shaping Lab's
 *      whole claim is that the numbers it shows came from the motion it
 *      commanded. An uploaded file is a different thing: the operator put it
 *      there deliberately, and the real board allows it too
 * @debt promotion to 7 is a `CaptureFile` type whose sole constructor takes
 *       the synth's output, with `VirtualSD.write` refusing plain bytes under
 *       that directory. That needs the SD store to know about capture paths,
 *       which is a bigger change to a shared type than this earns today.
 */
export function onMove(machine: Machine, dx: number, dy: number, speedMmS: number): void {
	const axis: "X" | "Y" = Math.abs(dx) >= Math.abs(dy) ? "X" : "Y";
	const dist = axis === "X" ? dx : dy;
	// A Z-only or extrude-only move is not a capture opportunity; the arm waits.
	if (Math.abs(dist) < 1e-3) return;
	const armed = machine.accel.take();
	if (armed === null) return;

	const om = machine.om;
	const accel = accelAt(om, { board: armed.board, device: 0 });
	if (accel === null) return;
	const unit = machine.accel.config(armed.board);
	const csv = synthCapture({
		rate: unit.rate,
		samples: armed.samples,
		axis,
		speed: speedMmS,
		dist,
		accel: Number(om.move.travelAcceleration) || 1000,
		modes: machine.accel.modes,
		shaper: activeShaper(om),
	});
	machine.sd.ensureDir(parentOf(armed.path), String(om.state.time ?? ""));
	machine.sd.write(armed.path, new TextEncoder().encode(csv), String(om.state.time ?? ""));
	machine.bumpVolume(0);
	accel.runs = (accel.runs ?? 0) + 1;
	accel.points = (accel.points ?? 0) + armed.samples;
	machine.bump("boards");
}

function parentOf(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut < 0 ? path : path.slice(0, cut);
}

// --- M593 ------------------------------------------------------------------

/**
 * `move.shaping` is the only home of the active shaper.
 *
 * @invariant shaping-has-one-home
 * @rung 6  choke-point — M593 writes the object model and nothing else keeps
 *          a copy: the report string is rendered from `move.shaping`, and the
 *          synth reads its impulses from the same place through
 *          `activeShaper`. A client polling the model and the console reply
 *          therefore cannot be told two different things
 * @why the mock exists to be the thing a UI is developed against; a shaper
 *      that the reply reported and the ring did not reflect would be a bug
 *      the UI could never diagnose, because both of its windows onto the
 *      machine would be equally plausible
 * @debt promotion to 7 needs the object model to be typed rather than
 *       `Record<string, any>`, which snapshot.ts holds open on purpose so the
 *       mock can replay captured responses verbatim.
 */
export function executeM593(machine: Machine, p: Params): string {
	const shaping = machine.om.move.shaping as Om;
	const requested = p.quoted("P");
	const f = p.num("F");
	const s = p.num("S");
	const H = p.numbers("H");
	const T = p.numbers("T");
	if (requested === null && f === null && s === null && H === null && T === null) {
		return reportShaping(shaping);
	}

	const type = (requested ?? String(shaping.type)).toLowerCase();
	if (!SHAPER_TYPES.includes(type as ShaperType)) {
		return `Error: M593: unsupported input shaper type "${requested ?? type}"`;
	}
	const frequency = f ?? Number(shaping.frequency);
	const damping = s ?? Number(shaping.damping);
	if (!(frequency > 0)) return "Error: M593: frequency must be positive";
	if (!(damping >= 0 && damping < 1)) return "Error: M593: damping ratio must be in [0, 1)";

	let request: ShaperRequest;
	if (type === "custom") {
		if (H === null || T === null) return 'Error: M593: P"custom" needs H and T';
		if (H.length !== T.length) return "Error: M593: H and T must have the same number of values";
		if (!(H.reduce((a, b) => a + b, 0) < 1) || H.some(h => !(h > 0))) {
			return "Error: M593: custom amplitudes must be positive and sum to less than 1";
		}
		const delays = [0, ...T];
		for (let i = 1; i < delays.length; i++) {
			if (!(delays[i]! > delays[i - 1]!)) return "Error: M593: custom delays must be strictly increasing";
		}
		request = { type: "custom", H, T };
	} else if (type === "none") {
		request = { type: "none" };
	} else {
		request = { type: type as Exclude<ShaperType, "none" | "custom">, f: frequency, zeta: damping };
	}

	const train = impulseTrain(request);
	shaping.type = type;
	shaping.frequency = frequency;
	shaping.damping = damping;
	shaping.amplitudes = train.map(i => i.amplitude);
	shaping.delays = train.map(i => i.delayS);
	// move is a rarely-changing subtree: without the bump a seqs-driven client
	// never re-fetches it and the new shaper stays invisible.
	machine.bump("move");
	return "";
}

function reportShaping(shaping: Om): string {
	if (shaping.type === "none") return "Input shaping is disabled";
	const amplitudes = (shaping.amplitudes as number[]).map(a => a.toFixed(4)).join(" ");
	const delays = (shaping.delays as number[]).map(d => (d * 1000).toFixed(2)).join(" ");
	return (
		`Input shaping "${shaping.type}" at ${Number(shaping.frequency).toFixed(1)}Hz ` +
		`damping ratio ${Number(shaping.damping).toFixed(2)}, ` +
		`impulses [${amplitudes}] with delays (ms) [${delays}]`
	);
}

/** The active train, read back out of the model M593 wrote it into. */
function activeShaper(om: Om): Impulse[] {
	const shaping = om.move?.shaping as Om | undefined;
	const amplitudes = shaping?.amplitudes as number[] | undefined;
	const delays = shaping?.delays as number[] | undefined;
	if (!Array.isArray(amplitudes) || !Array.isArray(delays) || amplitudes.length !== delays.length || amplitudes.length === 0) {
		return [{ amplitude: 1, delayS: 0 }];
	}
	return amplitudes.map((amplitude, i) => ({ amplitude, delayS: delays[i]! }));
}
