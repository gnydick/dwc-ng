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
	/**
	 * Drop every cached download.
	 *
	 * For the one gesture that means "the card is not what I last read": the
	 * Shaping screen's Reload. A capture re-run under a name that already
	 * exists is the ordinary way these files change — `importRef` says so about
	 * the imported half — so a reload that kept the old bytes would re-fit
	 * yesterday's move and label it with today's file name. Imports are
	 * unaffected: their text is IN the ref, so there is nothing here to forget.
	 */
	forget(): void;
};

export function createCaptureLoader(conn: Pick<ConnectorReads, "download">): CaptureLoader {
	const cache = new Map<string, string>();
	return {
		forget: (): void => {
			cache.clear();
		},
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

/* ------------------------------------------------ browsing what the board has */

/**
 * The board's capture directory, as rows a person can find something in.
 *
 * Gabe's machine holds 276 CSVs going back to May, 9.4 MB of them. That is not
 * a list, it is an archive, and the three operations below are what turns it
 * back into a list: newest first, filtered by a substring, and — because
 * nobody remembers what they called a run in May — a handful of name families
 * derived from the listing itself.
 *
 * All three are pure and live here rather than in the card, both so they can
 * be tested against a realistic listing and because the card must not be the
 * place that decides what "newest" means.
 */

/** Only the CSVs: `M956` writes those, and the directory has other things in it. */
export const isCaptureFile = (entry: { type: "d" | "f"; name: string }): boolean =>
	entry.type === "f" && entry.name.toLowerCase().endsWith(".csv");

/**
 * Newest first.
 *
 * `FileListEntry.date` is the transport's own `YYYY-MM-DDTHH:mm:ss`, which
 * sorts lexicographically — that IS the contract the field carries
 * (connector/types.ts). An entry with no date sorts last rather than first: a
 * transport that omits the field must not be able to push unknown-age files to
 * the top of a list whose whole promise is "most recent".
 */
export function byNewest<T extends { name: string; date?: string }>(entries: readonly T[]): T[] {
	return [...entries].sort((a, b) => {
		const da = a.date ?? "";
		const db = b.date ?? "";
		if (da !== db) return da === "" ? 1 : db === "" ? -1 : (da < db ? 1 : -1);
		// Same second, or both undated: by name, so the order is at least stable
		// and a re-listing does not reshuffle the rows under the operator.
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
}

/** Case-insensitive substring match on the file name. An empty query matches
 *  everything, so "no filter" and "filter that matches all" are one path. */
export function matchesQuery(name: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	return q === "" || name.toLowerCase().includes(q);
}

/**
 * One chip in the family row: a slice of the listing, and EXACTLY the rows
 * clicking it shows.
 *
 * `rows` is the whole point. It is not a count beside a rule for recomputing
 * the same set later — it IS the set, and the number on the chip is its
 * length, so the two cannot be made to disagree by editing one of them.
 */
export type CaptureFamily<T> = {
	/** What the lit-chip signal holds: a name prefix, or REST_FAMILY. */
	readonly key: string;
	/** What the chip reads. */
	readonly label: string;
	/** The rows clicking this chip shows, in the order they were given. */
	readonly rows: readonly T[];
};

/**
 * The residual bucket's key: everything the named families did not take.
 *
 * A NUL, so it cannot collide with a family key however the operator names a
 * run — every named key is a prefix of a real file name, and no file name on
 * any filesystem this code will meet contains one.
 */
export const REST_FAMILY = "\u0000rest";

/** What the chip row shows and what the table shows, from one call. */
export type FamilyView<T> = {
	/** The named families, biggest first. */
	readonly families: readonly CaptureFamily<T>[];
	/** Everything no named family took, or null when they took everything. */
	readonly rest: CaptureFamily<T> | null;
	/** Which chip is lit — null when none is, or when the lit one is gone. */
	readonly lit: string | null;
	/** The rows to render: the lit chip's own array, or all of them. */
	readonly shown: readonly T[];
};

/**
 * How deep a name family may go: `ring1_` and `ring1_v_`, never
 * `ring1_v_zvdd_52_`. Two levels is what separates a run from its verify pass;
 * past that the chips stop being families and become individual runs, which is
 * what the text filter is for.
 */
const MAX_FAMILY_DEPTH = 2;

/**
 * The name prefixes worth offering, most files first.
 *
 * DERIVED from the names rather than hard-coded, because the families are the
 * operator's own naming from months ago and no list written here could know
 * them. Every prefix ending at one of the first two underscores is a
 * candidate; a candidate is kept if at least two files share it and no SHORTER
 * candidate covers exactly the same files — the shorter name for the same set
 * is the one worth a chip.
 *
 * Depth is capped rather than left to the counts, and the reason is Gabe's
 * board. Ranking purely by count put `ring1_v_zv_52_` and `ring1_v_ei2_52_`
 * (12 each) at the top, which pushed everything else out AND made the
 * `ring1_v_` chip beside them mean "the verify runs except those two".
 *
 * Ranked by the RAW tally, which is deliberately not the number the chip will
 * end up showing: the `ring1_` bucket loses its 48 `ring1_v_` files to the
 * longer chip beside it and ends up holding twelve. Ranking on the raw tally
 * is what keeps the parent offered at all — on the count it ends up with,
 * `ring1_` places sixth and the twelve captures nothing else can name go into
 * the residual.
 */
function familyCandidates(names: readonly string[]): string[] {
	const counts = new Map<string, number>();
	for (const name of names) {
		let depth = 0;
		for (let i = 0; i < name.length && depth < MAX_FAMILY_DEPTH; i++) {
			if (name[i] !== "_") continue;
			depth++;
			const prefix = name.slice(0, i + 1);
			counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
		}
	}
	const kept = [...counts].filter(([prefix, count]) => {
		if (count < 2) return false;
		for (const [other, otherCount] of counts) {
			if (other.length < prefix.length && prefix.startsWith(other) && otherCount === count) return false;
		}
		return true;
	});
	kept.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
	return kept.map(([prefix]) => prefix);
}

/**
 * The chip row and the rows under it, from ONE call over ONE definition of
 * "belongs to this family".
 *
 * A PARTITION, and everything this function is for follows from that word.
 * Every row lands in exactly one bucket — the longest named family whose
 * prefix it starts with, or the residual — so:
 *
 *  - a chip's number is the length of the list clicking it produces, because
 *    it IS that list;
 *  - the buckets' lengths sum to the input, so an operator reading the row can
 *    see that nothing is hidden from it;
 *  - no name is unreachable, because `rest` holds whatever the named families
 *    did not take.
 *
 * "Longest wins" is what makes a chip mean its own name. Gabe's board holds 60
 * files starting `ring1_`: twelve baseline ring captures and 48 `ring1_v_`
 * verify captures from the same morning. A plain prefix match on `ring1_`
 * returns all 60, and NO substring expresses "the twelve" — they are
 * `ring1_Xp0` … `ring1_Ym2`, sharing nothing the verify files lack. So a
 * family means what a person means by it: this prefix, minus the sub-families
 * offered beside it.
 *
 * `lit` comes back as well as going in, and is null when the lit key names no
 * bucket — a family the current listing no longer holds. The card renders
 * `aria-pressed` from the answer rather than from what it asked, so a chip
 * cannot read as lit while the table shows everything.
 *
 * @invariant family-count-is-the-family
 * @rung 6  choke-point — the sole producer of the chips AND of the rows they
 *          filter to. `shown` is one of the very arrays in `families`/`rest`
 *          (same reference, not an equal copy) and a chip's number is that
 *          array's `length`, so there is no second expression that could count
 *          differently — no count is stored anywhere for one to drift from.
 *          The buckets are built by assigning each row exactly once, so their
 *          lengths sum to the input by construction rather than by agreement
 * @why reported by Gabe, 2026-08-23, driving the deployed build against his
 *      board: the `ring1_` chip said 60 files and produced 12. The label came
 *      from a raw prefix tally and the click came from a filter that
 *      subtracted the sub-families shown beside it — two expressions for one
 *      claim, the same shape `step-readiness-has-one-answer` exists to
 *      prevent. The same row also covered 141 of his 259 files, leaving 118 in
 *      no bucket at all
 * @limit nothing stops a caller filtering the listing by prefix itself instead
 *        of asking; what is gone is the SECOND ANSWER, not the ability to
 *        write a third. Promote by making a row unrenderable except through a
 *        bucket
 */
export function familyView<T extends { readonly file: string }>(
	rows: readonly T[],
	slots: number,
	lit: string | null,
): FamilyView<T> {
	const chosen = familyCandidates(rows.map(r => r.file)).slice(0, Math.max(0, slots));
	const buckets = new Map<string, T[]>(chosen.map(prefix => [prefix, []]));
	const restRows: T[] = [];
	for (const row of rows) {
		let best = "";
		for (const prefix of chosen) {
			if (prefix.length > best.length && row.file.startsWith(prefix)) best = prefix;
		}
		if (best === "") restRows.push(row);
		else buckets.get(best)!.push(row);
	}
	const families = [...buckets]
		.filter(([, held]) => held.length > 0)
		.map(([prefix, held]): CaptureFamily<T> => ({ key: prefix, label: prefix, rows: held }))
		// Biggest first, by the count the chip SHOWS rather than the raw tally
		// the candidates were ranked on — the row reads as a size order or it
		// reads as nothing.
		.sort((a, b) => (b.rows.length - a.rows.length) || (a.key < b.key ? -1 : 1));
	const rest: CaptureFamily<T> | null = restRows.length === 0
		? null
		: { key: REST_FAMILY, label: "other", rows: restRows };
	const active = (rest !== null && rest.key === lit ? rest : families.find(f => f.key === lit)) ?? null;
	return { families, rest, lit: active?.key ?? null, shown: active === null ? rows : active.rows };
}

/**
 * The captures a tick list names, in the order the table shows them.
 *
 * ORIGIN IS NOT CONSULTED, and that is the fix rather than an oversight. Where
 * a capture's bytes come from is `CaptureRef`'s business and the loader
 * answers it for all three origins — a board file and a tool's own capture
 * name the same file in ACCEL_DIR and download identically, and an imported
 * CSV is already in memory. Selectability was gated on `origin === "board"`,
 * which conflated "can supply bytes" with a different question — whether the
 * fit may be WRITTEN against a tool — and left twelve visible tool rows with
 * no checkbox beside a button reading "Fit 0" (Gabe, 2026-08-23). The second
 * question is answered by `importedCount`, where it belongs.
 *
 * Keyed by `key` rather than by file name, because two imports can be called
 * `ring1_Xp0.csv` and a tick on one must not fit the other.
 */
export function chosenCaptures<T extends { readonly key: string; readonly ref: CaptureRef }>(
	rows: readonly T[],
	ticked: ReadonlySet<string>,
): readonly CaptureRef[] {
	return rows.filter(r => ticked.has(r.key)).map(r => r.ref);
}

/**
 * How many of these captures came off the operator's own computer.
 *
 * The one question that DOES turn on origin: an imported CSV is not this
 * machine's capture. It may be from another machine, another day or another
 * printer entirely, so a fingerprint containing one cannot be written to a
 * tool's results file as that tool's measurement — while it can be fitted,
 * drawn and read like anything else. Zero means the batch is the machine's own.
 */
export function importedCount(refs: readonly CaptureRef[]): number {
	return refs.reduce((n, ref) => n + (ref.kind === "import" ? 1 : 0), 0);
}

/**
 * The most captures one fingerprint run will download and fit.
 *
 * A guard on the BOARD, not a taste. `0:/sys/accelerometer` holds 276 files on
 * Gabe's machine and the Select button offers whatever the list is showing, so
 * one unfiltered click would be 276 downloads and 9.4 MB out of an embedded
 * HTTP server this project exists to be gentle with — several minutes, with no
 * way to call it back.
 *
 * 48 because that is the largest thing a single measurement legitimately is:
 * this morning's verify pass was four shapers over twelve moves. Anything above
 * it is more than one run, and a fingerprint aggregated across runs is a median
 * of two different machines' worth of state — so the cap refuses the case that
 * was never meaningful anyway, which is why it can be a cap rather than a
 * warning.
 */
export const MAX_BATCH = 48;

/* --------------------------------------------------- speed sweeps in the names */

/**
 * One capture of a sweep: the file, and the speed its name declares.
 */
export type SweepMember = { readonly file: string; readonly speed: number };

/**
 * A set of captures of the SAME move at different speeds, which is what a
 * sweep is.
 *
 * `id` is `<prefix>_<axis>` exactly as the files spell it (`lowspeed_stock_X`,
 * `base_x`), because that is what the operator named the run and it is the
 * only handle they have on it months later.
 */
export type SweepFamily = {
	readonly id: string;
	/** The axis the run drove, read from the name's own letter. */
	readonly axis: Axis;
	/** Ascending by speed, one entry per distinct speed. */
	readonly members: readonly SweepMember[];
};

/**
 * The most captures one sweep will download and transform.
 *
 * A cap for the same reason MAX_BATCH is one: every row is a download out of
 * RRF's embedded server plus an FFT. Sixteen because the largest real family on
 * Gabe's board is nine (`lowspeed_stock_X`, 10–60 mm/s) and the next is four —
 * so the cap refuses nothing anybody has actually run, while a name pattern
 * that accidentally collected fifty files cannot become fifty requests.
 */
export const MAX_SWEEP = 16;

/** `lowspeed_stock_X_30.csv` → prefix `lowspeed_stock`, axis `X`, speed 30. */
const SPEED_NAME = /^(.+)_([XYxy])_(\d+)\.csv$/;

/**
 * The speed-sweep families present in a listing, biggest first.
 *
 * DERIVED from the names, like `familyView` and for the same reason: the
 * naming is the operator's own, from months ago, and no list written here could
 * know it. `<prefix>_<axis>_<speed>.csv` is the shape the capture runs
 * themselves write, and 184 of the 259 CSVs on Gabe's board follow it.
 *
 * A family needs at least `min` DISTINCT speeds — two points already answer
 * "does this peak move when I go faster", which is the only question the chart
 * asks. Duplicates of one speed are not a second point, so they are collapsed:
 * a repeat run under the same speed would otherwise draw two identical rows and
 * make the picture look twice as resolved as it is.
 *
 * Sorted by member count descending, then by id, so the run that is actually a
 * sweep comes first in a picker holding eighty two-point families.
 */
export function speedFamilies(names: readonly string[], min = 2): SweepFamily[] {
	const byId = new Map<string, { axis: Axis; bySpeed: Map<number, string> }>();
	for (const name of names) {
		const m = SPEED_NAME.exec(name);
		if (m === null) continue;
		const speed = Number(m[3]);
		if (!Number.isFinite(speed) || speed <= 0) continue;
		const id = `${m[1]!}_${m[2]!}`;
		const axis: Axis = m[2]!.toUpperCase() === "Y" ? "Y" : "X";
		let entry = byId.get(id);
		if (entry === undefined) {
			entry = { axis, bySpeed: new Map<number, string>() };
			byId.set(id, entry);
		}
		// First name wins for a repeated speed, and the listing reaches this
		// newest-first, so the surviving row is the most recent capture at that
		// speed rather than whichever the directory happened to hold longest.
		if (!entry.bySpeed.has(speed)) entry.bySpeed.set(speed, name);
	}
	const out: SweepFamily[] = [];
	for (const [id, entry] of byId) {
		if (entry.bySpeed.size < min) continue;
		const members = [...entry.bySpeed]
			.sort((a, b) => a[0] - b[0])
			.map(([speed, file]): SweepMember => ({ speed, file }));
		out.push({ id, axis: entry.axis, members });
	}
	out.sort((a, b) => (b.members.length - a.members.length) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return out;
}

/* ------------------------------------------------ what a filtered list shows */

/**
 * The row a selection names, and whether the filter is currently hiding it.
 *
 * ONE function returning BOTH, and that is the whole point. The two answers
 * have to come from the same pair of lists: a card that resolved the pick
 * against the shown rows and the hidden-ness against the full ones would
 * report a state that cannot exist, and a card that resolved the pick against
 * the SHOWN rows loses the pick the moment a filter excludes it.
 *
 * @invariant a-filter-finds-rows-it-does-not-choose-them
 * @rung 6  choke-point — the pick is resolved here and nowhere else, against
 *          `all`. A caller cannot accidentally resolve it against the filtered
 *          list, because the filtered list is only ever used to answer the
 *          SECOND question. `hidden` is true only when there is a pick, so
 *          "nothing picked" and "the pick is hidden" stay distinguishable
 * @why reported by Gabe, 2026-08-23: pick a capture on the Decay card, click a
 *      name-family chip that excludes it, and the chart plus every fitted
 *      number beside it blanked — even though the selection itself was intact.
 *      The filter exists to FIND rows; what is on screen is what the operator
 *      deliberately chose, and it stays until they choose another
 */
export function resolvePick<T extends { readonly key: string }>(
	all: readonly T[],
	shown: readonly T[],
	key: string | null,
): { readonly picked: T | null; readonly hidden: boolean } {
	if (key === null) return { picked: null, hidden: false };
	const picked = all.find(r => r.key === key) ?? null;
	return { picked, hidden: picked !== null && !shown.some(r => r.key === key) };
}
