/**
 * Where a decay curve's CSV comes from, and the one route that turns it into
 * text.
 *
 * There are two origins and they are genuinely different — a file already on
 * the board's SD card, written there by a capture run, and a file the operator
 * picked off their own computer. The Decay card treats them identically once
 * they are text, which is the point: the engine has no idea which is which,
 * and a capture recorded this morning on a machine that has since been
 * reflashed analyses exactly as one downloaded a second ago.
 *
 * That second origin is not a convenience. Until the envelope editor exists
 * (GitHub #31) this UI cannot run a measurement at all, so importing a CSV is
 * the only way an operator sees their own machine's ring-down here — and it is
 * the one path through this feature that needs no envelope, no homing and no
 * motion.
 *
 * @invariant capture-text-has-one-loader
 * @rung 6  choke-point — `CaptureLoader.text` is the only function that turns
 *          a CaptureRef into CSV, and a CaptureRef is the only thing it takes.
 *          A board file is downloaded at most once per session and answered
 *          from the cache after that, so no second call site can decide for
 *          itself whether to re-fetch
 * @why the board's HTTP server tolerates very few requests, and clicking down
 *      a list of twelve captures is exactly the gesture that would issue
 *      twelve downloads per click without a single owner of the cache
 */
import type { ConnectorReads } from "@dwc-ng/connector";
import type { Axis, Mode, NoFit } from "./engine/fit.ts";

/** Where RRF's `M956` writes its captures, and where a run leaves them. */
export const ACCEL_DIR = "0:/sys/accelerometer";

export const accelPath = (file: string): string => `${ACCEL_DIR}/${file}`;

/**
 * One pickable capture. `key` is what a selection holds: it is unique across
 * both origins and stable for the life of the screen, so a selection cannot
 * be shifted onto a different capture by a list that grew underneath it — the
 * defect a bare array index has.
 */
export type CaptureRef =
	| { readonly kind: "board"; readonly key: string; readonly file: string }
	| { readonly kind: "import"; readonly key: string; readonly file: string; readonly text: string };

/** A capture the board holds, named as its file in ACCEL_DIR. */
export const boardRef = (file: string): CaptureRef => ({ kind: "board", key: `board:${file}`, file });

/**
 * A capture the operator supplied. The sequence number, not the name, makes
 * the key: two different files can be called `ring1_Xp0.csv` (a re-run, a
 * second machine), and importing the second must not silently replace the
 * first on screen.
 */
export const importRef = (seq: number, file: string, text: string): Extract<CaptureRef, { kind: "import" }> => ({
	kind: "import",
	key: `import:${seq}:${file}`,
	file,
	text,
});

/**
 * A capture's axis, direction and repeat as the capture runs spell them —
 * `ring1_Xp1.csv` is X, `+`, repeat 1.
 *
 * Total: a name that does not follow the convention (any CSV the operator
 * drags in) reads as X `+` 0 and says so through `matched`, because a file
 * picker cannot be made to offer only files this project named. `matched` is
 * what the card uses to decide whether the axis it chose is a reading of the
 * name or merely a default the operator should check.
 */
export function captureNameParts(file: string): { axis: Axis; dir: "+" | "-"; rep: number; matched: boolean } {
	const m = /_([XY])([pm])(\d+)\b/.exec(file);
	if (m === null) return { axis: "X", dir: "+", rep: 0, matched: false };
	return { axis: m[1] as Axis, dir: m[2] === "p" ? "+" : "-", rep: Number(m[3]), matched: true };
}

/**
 * A CSV the operator imported, with whatever the engine made of it.
 *
 * `fit` is null only while the engine is still working; `problem` is non-empty
 * only when the file could not be turned into a capture at all, and carries
 * the engine's OWN words for the ParseError (worker.ts `describe`) rather than
 * a generic failure. Those two states are separate because they mean opposite
 * things to an operator: "still thinking" and "this file has 47 accelerometer
 * overflows, run it again".
 */
export type ImportedCapture = {
	readonly ref: Extract<CaptureRef, { kind: "import" }>;
	readonly axis: Axis;
	readonly dir: "+" | "-";
	readonly rep: number;
	readonly fit: Mode | NoFit | null;
	readonly problem: string;
};

export type CaptureLoader = {
	/** The CSV, downloaded once per board file and cached thereafter. */
	text(ref: CaptureRef): Promise<string>;
};

export function createCaptureLoader(conn: Pick<ConnectorReads, "download">): CaptureLoader {
	const cache = new Map<string, string>();
	return {
		text: async (ref: CaptureRef): Promise<string> => {
			if (ref.kind === "import") return ref.text;
			const hit = cache.get(ref.key);
			if (hit !== undefined) return hit;
			const text = await conn.download(accelPath(ref.file));
			cache.set(ref.key, text);
			return text;
		},
	};
}
