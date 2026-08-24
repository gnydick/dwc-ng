/**
 * The service registry — the sole home of inter-card state (design §services).
 *
 * A service is state shared by two or more cards on one screen: the file
 * browser + its selection (Jobs/Macros/System), the height-map store + the
 * selected cell + the shared message line (Bed). The composer creates a pool
 * per screen; a card reaches a service through ctx.service(id), which
 * provisions it ON FIRST ACCESS and memoizes — so:
 *
 *  - two cards cannot hold different instances (one pool entry, by
 *    construction — asking twice returns the same object);
 *  - "needed but not provisioned" has no representable state — access IS
 *    provisioning (I5 by elimination rather than by declaration);
 *  - services die with their screen (the pool runs factories under the
 *    screen's reactive owner, so resources/effects dispose on unmount).
 *
 * A service dying is about RESOURCES, not about what the operator was doing.
 * The file-domain selection used to die with it too, which meant navigating
 * away closed the file you had open; it is now remembered per root in
 * browserMemory (see domainBrowser) and restored when the service is rebuilt.
 * Anything else a screen should not forget belongs there for the same reason —
 * the pool's lifetime is an implementation detail of the composer.
 *
 * Factories may use signals/resources/effects: they run under the screen's
 * owner via runWithOwner.
 *
 * @invariant one-service-instance-per-screen
 * @rung 8  illegal state unrepresentable — ctx.service(id) provisions ON FIRST
 *          ACCESS and memoizes into the pool, so "asked for but not
 *          provisioned" is not a state that exists, and asking twice returns
 *          the same object. Two cards holding different instances would require
 *          a second pool, which nothing can make: the composer owns it and
 *          hands out only the accessor
 * @why a service IS the shared state — the file browser and its selection, the
 *      height-map store and the selected cell. Two instances would mean two
 *      cards on one screen disagreeing about which cell is selected or which
 *      directory is open, each correct about its own copy, with the operator
 *      acting on whichever one the click reached
 *
 * @invariant services-die-with-their-screen
 * @rung 7  RAII — factories run under the SCREEN's reactive owner via
 *          runWithOwner, so every resource, effect and cleanup a service
 *          creates is tied to that owner's lifetime. Disposal is not a step
 *          anyone performs; there is no unmount path that skips it
 * @why services hold polls, resources and effects against a board whose HTTP
 *      server tolerates very few connections. A service outliving its screen
 *      keeps fetching for a view nobody is looking at, and the cost lands on
 *      the live poll everyone IS looking at. What must NOT die with the screen
 *      is what the operator was doing — the open file and selection — which is
 *      why that lives in browserMemory instead
 */
import { createEffect, createMemo, createResource, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js";
import { createStore } from "solid-js/store";
import { createFileBrowser } from "../files/browser.ts";
import { loadBrowserMemory, saveBrowserFile } from "../files/browserMemory.ts";
import { fileUnderRoot } from "../files/path.ts";
import { forcedJobInfoErrorNow } from "../dev/forcedJobInfoError.ts";
import { createHeightMapStore } from "../heightmap/store.ts";
import { cellPosition } from "../heightmap/parse.ts";
import { createShapingStore } from "../shaping/store.ts";
import { type CaptureRecord, emptyResults, RESULTS_PATH, type ToolResults } from "../shaping/results.ts";
import { Preconditions, type Refusal } from "../shaping/preconditions.ts";
import { findShapingLine, replaceShapingLine, toolMacroPath } from "../shaping/toolMacro.ts";
import type { ShapingStep } from "../shaping/steps.ts";
import { candidateFor, shortlist } from "../shaping/engine/rank.ts";
import { verifyAnalysis } from "../shaping/store.ts";
import type { CardId } from "./defs.ts";
import { useEngine } from "../shaping/useEngine.ts";
import { ACCEL_DIR, boardRef, byNewest, captureNameParts, type CaptureRef, createCaptureLoader, type ImportedCapture, importedCount, importRef, isCaptureFile, MAX_BATCH, MAX_SWEEP, speedFamilies, type SweepFamily } from "../shaping/captures.ts";
import { parseAccelAddr } from "../control/commands.ts";
import { type FileListEntry, FileNotFoundError } from "@dwc-ng/connector";
import { aggregate, type Axis, type Fingerprint, type Mode, type NoFit } from "../shaping/engine/fit.ts";
import { type FullStep, fullStepPerMm } from "../shaping/fullStep.ts";
import { mmPerS, seconds } from "../shaping/engine/units.ts";
import { analysedRows } from "../shaping/engine/sweep.ts";
import type { ApplyState } from "../shaping/applyRun.ts";
import { type AccelReport, parseAccelReport } from "../shaping/accelReport.ts";
import type { ShaperSpec } from "../shaping/engine/shapers.ts";
import { cmd } from "../control/commands.ts";
import type { SweepState } from "../shaping/sweepRun.ts";
import { motionBusy, type MotionState } from "../shaping/motionRun.ts";
import { createFitCache } from "../shaping/fitCache.ts";
import type { AppServices } from "../shell/context.ts";

/** What a service factory gets: the app services plus the uniform gate. */
export interface ServiceBaseCtx extends AppServices {
	connected: () => boolean;
	/**
	 * Is this card in the composition the service's screen is rendering?
	 *
	 * A screen-level fact, so it belongs to the pool rather than to any card:
	 * compositions are the operator's, and a Shaping screen they removed the
	 * Capture card from genuinely cannot measure. Reactive — a card added from
	 * the compose drawer changes the answer without a remount.
	 */
	onScreen: (id: CardId) => boolean;
}

/**
 * Browser + selection for a file domain — the shape Jobs/Macros/System share.
 *
 * The selection OUTLIVES the screen. Services die on navigation (see the module
 * header), so a signal alone reset the editor to "no selection" every time you
 * stepped away — you came back to the hint text and had to find your file
 * again. It is remembered per root in browserMemory, beside the directory and
 * scroll offset that already survive for the same reason, so leaving a screen
 * mid-edit and returning puts you back on the file you were editing.
 *
 * The remembered value is UNTRUSTED (localStorage): `fileUnderRoot` re-proves
 * it as a descendant of this root and yields null for anything it cannot
 * rebuild from safe segments, so a hand-edited entry cannot point one domain's
 * editor at another domain's file.
 *
 * Writing goes through this ONE setter rather than at the call sites that
 * select, so a card cannot change the selection without the change being
 * remembered — including `setSelected(null)`, which is how Close records that
 * nothing should reopen.
 */
function domainBrowser(base: ServiceBaseCtx, root: string, sort?: "recent") {
	const browser = createFileBrowser(root, base.connected, base.connector, sort);
	const [selected, setSelectedNow] = createSignal<string | null>(
		fileUnderRoot(root, loadBrowserMemory(root).file),
	);
	const setSelected = (path: string | null): void => {
		setSelectedNow(path);
		saveBrowserFile(root, path);
	};
	return { browser, selected, setSelected };
}

function jobsBrowserService(base: ServiceBaseCtx) {
	const domain = domainBrowser(base, "0:/gcodes", "recent");
	// One transfer at a time on the weak RRF server.
	const [downloading, setDownloading] = createSignal<string | null>(null);
	// The details card's data, chained: fileinfo keyed on the selection, then
	// the first thumbnail keyed on the fileinfo.
	// refetch is kept, not discarded: without it the only way to re-read a file
	// whose metadata failed is to select something else and select it back, which
	// is not a recovery so much as a trick you have to know.
	const [info, { refetch: refetchInfo }] = createResource(
		domain.selected,
		async path => {
			// A URL flag can make this read fail on demand, so the card's failure
			// state can be looked at without owning a file the machine cannot read
			// (see dev/forcedJobInfoError.ts). Checked per fetch rather than once,
			// so Retry keeps failing while the flag is set — which is the honest
			// demonstration, and also proves Retry is wired to anything at all.
			const forced = forcedJobInfoErrorNow();
			if (forced !== null) throw forced;
			return base.connector.getFileInfo(path);
		},
	);
	const [thumb] = createResource(
		() => {
			const i = info();
			return i && i.thumbnails.length > 0 ? { path: i.fileName, t: i.thumbnails[0]! } : false;
		},
		async ({ path, t }) => ({ bytes: await base.connector.getThumbnail(path, t.offset), format: t.format }),
	);

	/**
	 * Save a job file to the operator's machine. Via the connector (not a bare
	 * <a href>) because rr_download is authenticated by a session-key HEADER a
	 * plain link can't send; it's a read, so the write guard leaves it alone.
	 */
	const download = async (path: string, name: string): Promise<void> => {
		if (downloading() !== null) return;
		setDownloading(path);
		try {
			const text = await base.connector.download(path);
			const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = name;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch {
			// A failed transfer surfaces via the connection status / console.
		} finally {
			setDownloading(null);
		}
	};

	return { ...domain, downloading, download, info, refetchInfo, thumb };
}

function heightmapService(base: ServiceBaseCtx) {
	const store = createHeightMapStore(base.connector);
	const [selected, setSelected] = createSignal<{ row: number; col: number } | null>(null);
	/** One message line, written by actions from both cards, shown in the
	 *  heightmap card's bar — shared here so it cannot fork. */
	const [message, setMessage] = createSignal("");

	/** The selected cell joined with the map's meta → machine XY. */
	const cell = () => {
		const sel = selected();
		const map = store.map();
		if (sel === null || map === null) return null;
		return { ...sel, ...cellPosition(map.meta, sel.row, sel.col) };
	};

	// Load when the connection is READY, not on mount. Mounting races
	// rr_connect: the download went out before the session existed, came back
	// 401, and the connector reported "Invalid password" for a request merely
	// sent too early. Re-loads on reconnect. Lives HERE so the lifecycle
	// exists exactly when some card on screen uses the height map.
	let loadedWhileConnected = false;
	createEffect(() => {
		if (!base.connected()) {
			loadedWhileConnected = false;
			return;
		}
		if (loadedWhileConnected) return;
		loadedWhileConnected = true;
		void store.load();
	});

	// Accepted-but-unsaved map edits live only in the overlay, so a reload or a
	// navigation drops them silently — Gabe lost two accepted probes exactly
	// that way, each of which had cost a real probing cycle on the machine.
	// The browser's own prompt is the only thing that can interrupt a reload,
	// so it is hooked for as long as there is something to lose and removed the
	// moment there is not. Guarded on `window` because this module is imported
	// by node tests.
	createEffect(() => {
		if (!store.dirty() || typeof window === "undefined") return;
		const warn = (event: BeforeUnloadEvent): void => {
			// preventDefault() IS the modern opt-in to the browser's confirm
			// dialog; the wording is the browser's own and cannot be set.
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		onCleanup(() => window.removeEventListener("beforeunload", warn));
	});

	return { store, selected, setSelected, message, setMessage, cell };
}

/**
 * What a tool's `tpost<N>.g` had to say about shaping — including the two
 * states that exist before anyone has asked.
 *
 * `absent` and `unreadable` are separate on purpose: a tool with no post-select
 * macro is an ordinary machine, and a download that failed is a transfer to
 * retry. Collapsing them would tell an operator to create a file that already
 * exists.
 */
export type MacroRead =
	| { kind: "closed" }
	| { kind: "reading" }
	| { kind: "line"; line: string }
	| { kind: "no-line" }
	| { kind: "absent" }
	| { kind: "unreadable" };

/**
 * Whether a fitted batch may be written against a tool — carrying the records
 * ONLY when it may.
 *
 * The two questions the old `origin === "board"` gate confused, separated.
 * ANY capture can supply bytes: a board file and a tool's own capture name the
 * same file in `0:/sys/accelerometer` and download identically, and an
 * imported CSV is already in memory. So anything on the card can be ticked and
 * fitted, which is what makes re-fitting a tool's stored captures possible at
 * all after the estimator changes (#33).
 *
 * ATTRIBUTION is the other question, and it is a real distinction rather than
 * a leftover: an imported CSV may be from another machine or another day, so
 * recording it as this tool's measurement would make the next fingerprint a
 * mixture of two machines. The records — the only thing `store.setMeasurement`
 * can be given — exist solely in the `machine` arm, so the writer cannot be
 * reached with imported data without the compiler objecting first.
 */
export type BatchAttribution =
	| { readonly kind: "machine"; readonly records: readonly CaptureRecord[] }
	| { readonly kind: "imported"; readonly why: string };

/**
 * A batch fingerprint run, as one value.
 *
 * A union rather than a bag of flags: "running and also saved", "fitted with no
 * fingerprint", and "saved against no tool" are states this screen must not be
 * able to reach, and the surest way to keep them unreachable is for them to
 * have no spelling. `contributed` travels WITH the fingerprint for the same
 * reason — "11 of 12" is not decoration, it is the difference between a
 * complete measurement and a partial one, and a reader who has the numbers
 * without the count cannot tell which they are holding.
 */
/**
 * What a fitted batch IS, and therefore what it may become.
 *
 * The most dangerous conflation this screen could make, made unrepresentable.
 * A verify run measures the machine WITH a shaper installed, so its fingerprint
 * is the SUPPRESSED machine — the very thing #53 shows is silent and
 * self-reinforcing when it is mistaken for a baseline. Before this existed,
 * `BatchState.fitted` carried a fingerprint and no record of which run produced
 * it, so `saveMeasurement` would have written a shaped fingerprint over the
 * tool's baseline without a word.
 *
 * The verify arm carries the baseline it is to be compared against and the spec
 * that was installed, because `verifyAnalysis` needs exactly those two and a
 * caller that had to go and find them could find the wrong ones.
 *
 * @invariant a-shaped-fingerprint-cannot-become-a-baseline
 * @rung 8  illegal state unrepresentable — `saveMeasurement` narrows on
 *          `purpose.kind === "baseline"` and `saveVerified` on `"verify"`.
 *          Neither writer can be reached with the other's fingerprint, because
 *          the payload each needs exists only in its own arm: the verify arm is
 *          the only place a baseline-to-compare-against is spelled, and the
 *          baseline arm is the only thing `setMeasurement` will take
 * @why a baseline measured through a shaper ranks against modes that are not
 *      there, applies, and re-measures — nothing downstream can detect it and
 *      the output looks clean
 */
export type BatchPurpose =
	| { readonly kind: "baseline" }
	| {
		readonly kind: "verify";
		/** The shaper that was installed while these captures were taken. */
		readonly spec: ShaperSpec;
		/** The unshaped fingerprint this run is to be measured against. */
		readonly baseline: Fingerprint;
	};

export type BatchState =
	| { readonly kind: "idle" }
	| { readonly kind: "running"; readonly done: number; readonly total: number; readonly file: string }
	| {
		readonly kind: "fitted";
		readonly fingerprint: Fingerprint;
		/** What this batch is, and therefore which writer can take it. */
		readonly purpose: BatchPurpose;
		readonly attribution: BatchAttribution;
		readonly contributed: number;
		readonly total: number;
	}
	| { readonly kind: "saving"; readonly tool: number }
	| { readonly kind: "saved"; readonly tool: number; readonly contributed: number; readonly total: number }
	| { readonly kind: "failed"; readonly why: string };

/**
 * How much of the ranking is kept.
 *
 * `rank` scores a grid — six shaper types over a frequency sweep at four
 * damping values — and hands back every point of it sorted, which for the
 * prototype's fingerprint is 2712 candidates. All of them would be kept twice
 * over: as table rows on a card the operator scrolls, and as spec objects in
 * the results file uploaded to the SD card, on a board whose HTTP server this
 * project exists to be gentle with.
 *
 * Erring small on purpose. Too few is recoverable — re-rank with different
 * options, or describe the shaper you wanted on the Custom card — while too
 * many costs a six-figure DOM and a six-figure upload every time. Forty is five
 * screenfuls of the candidates table and a few KB on the card.
 */
const RANKED_KEPT = 40;

/**
 * The Shaping screen's shared state: the per-tool results store plus the three
 * selections its eight cards navigate by.
 *
 * All eight cards are views of one measurement session, so which TOOL is being
 * tuned is the single most load-bearing piece of state on the screen — the
 * status card picks it, and the other seven are entirely about it. A per-card
 * signal would let the candidates table rank T0's fingerprint while the apply
 * card offered to write T2's macro, each internally consistent and jointly
 * wrong. One service, one answer.
 *
 * The results themselves come off the SD card through the store's single
 * reader (shaping/store.ts `results-persist-through-one-writer`), loaded for
 * every tool the machine reports rather than only the selected one: the status
 * card's whole job is the per-tool table, and a table where four of five rows
 * say "not measured" because nobody downloaded them is a lie, not a blank.
 *
 * Loading is gated on the connection being READY, for the same reason the
 * height map is: mounting races rr_connect, and a download sent before the
 * session exists comes back 401. `loaded` makes it once-per-tool-per-connection
 * so a poll that reshapes the tools array cannot re-fetch the lot.
 */
function shapingService(base: ServiceBaseCtx) {
	const store = createShapingStore(base.connector);
	const [tool, setToolNow] = createSignal(0);
	const [candidateIndex, setCandidateIndex] = createSignal(0);

	/**
	 * Which capture the Decay card is drawing, held as the source's KEY rather
	 * than a row index.
	 *
	 * A key, because the list it points into has two halves — the captures the
	 * results file records and the CSVs the operator imported this session —
	 * and an index into the concatenation of those two moves onto a different
	 * capture the moment either half grows. `null` is "nothing picked", which
	 * is the state the card opens in and the state a tool change returns it to.
	 */
	const [capturePick, setCapturePick] = createSignal<string | null>(null);

	/**
	 * CSVs the operator brought in from their own computer this session.
	 *
	 * Deliberately NOT written to the results file. An imported capture is not
	 * a measurement of this tool — it is a file, possibly from another machine
	 * or another day, that the operator wants to look at — and recording it as
	 * this tool's data would make the next fingerprint a mixture of the two.
	 * They live for as long as the screen does and no longer.
	 */
	const [imports, setImports] = createSignal<readonly ImportedCapture[]>([]);
	let importSeq = 0;

	/**
	 * Take one CSV in and put it, fitted, in the list.
	 *
	 * The row appears BEFORE the engine has an answer, with its fit null, so a
	 * dozen files dropped at once land as a dozen rows that fill in — rather
	 * than as nothing at all until the last one is done. The engine call is the
	 * ordinary one every other capture goes through: `parseCapture` →
	 * `detectStop` → `fitDecay` in the worker, never a shortcut, so the numbers
	 * on an imported row are the numbers this UI computed and no one else's.
	 *
	 * A file the parser refuses is not dropped from the list. It keeps its row
	 * and carries the engine's own reason (`worker.ts describe`), because
	 * "nothing appeared" and "this file has overflows in it" are the two
	 * outcomes an operator most needs told apart.
	 */
	const addImport = (file: string, text: string): string => {
		const ref = importRef(importSeq++, file, text);
		const parts = captureNameParts(file);
		setImports(list => [...list, { ref, axis: parts.axis, dir: parts.dir, rep: parts.rep, fit: null, problem: "" }]);
		// The row is replaced rather than patched in place: `ImportedCapture` is
		// readonly through and through, so the only way to change one is to make
		// another, and a half-updated row cannot exist.
		const settle = (change: Partial<ImportedCapture>): void => {
			setImports(list => list.map(c => (c.ref.key === ref.key ? { ...c, ...change } : c)));
		};
		void (async () => {
			try {
				settle({ fit: (await useEngine().fit(text, parts.axis)).fit });
			} catch (err) {
				settle({ problem: err instanceof Error ? err.message : String(err) });
			}
		})();
		return ref.key;
	};
	const loader = createCaptureLoader(base.connector);

	/**
	 * What the board's capture directory holds — listed ONCE per connection.
	 *
	 * Gabe's machine has 276 CSVs in `0:/sys/accelerometer`, 9.4 MB of them,
	 * and until there is a results file naming some of them the card has no
	 * other way to reach any of them. So the directory itself is the index.
	 *
	 * Listed lazily and cached: `rr_filelist` pages, so 276 entries is several
	 * requests against a server that tolerates very few, and re-listing on
	 * every render of a card the operator is scrolling would be the worst thing
	 * this screen could do to the board. `refreshBoard` is the one way to ask
	 * again, and a fresh connection clears it because the SD card may not be
	 * the same one.
	 */
	const [board, setBoard] = createSignal<readonly FileListEntry[]>([]);
	const [boardState, setBoardState] = createSignal<"unread" | "reading" | "read" | "failed">("unread");
	const [boardError, setBoardError] = createSignal("");
	let boardWanted = false;

	const readBoard = (): void => {
		if (boardState() === "reading") return;
		setBoardState("reading");
		setBoardError("");
		void (async () => {
			try {
				const entries = await base.connector.list(ACCEL_DIR);
				setBoard(byNewest(entries.filter(isCaptureFile)));
				setBoardState("read");
			} catch (err) {
				// A directory that does not exist is the ordinary state of a
				// machine that has never run a capture, and it is not the same
				// news as a transfer that failed — but the connector cannot tell
				// them apart here, so the message says what was attempted.
				setBoardError(`could not list ${ACCEL_DIR}: ${err instanceof Error ? err.message : String(err)}`);
				setBoardState("failed");
			}
		})();
	};

	/** Ask for the listing if nobody has yet. Idempotent: the card calls this
	 *  when the operator switches to the board source, not on every render. */
	const wantBoard = (): void => {
		if (boardWanted) return;
		boardWanted = true;
		readBoard();
	};

	const refreshBoard = (): void => {
		boardWanted = true;
		readBoard();
	};

	// A new connection may be a different machine, or the same one with a
	// different card in it. Neither can inherit the old listing.
	createEffect(() => {
		if (base.connected()) return;
		boardWanted = false;
		setBoard([]);
		setBoardState("unread");
		setBoardError("");
	});

	/**
	 * Every capture this session has fitted, by CaptureRef key — a browser
	 * that remembers what it has looked at.
	 *
	 * A fit is a PURE FUNCTION of a file's bytes: `parseCapture` → `detectStop`
	 * → `fitDecay`, with no clock, no machine state and no tool in it. Two runs
	 * over the same file cannot disagree, so there is no correctness reason ever
	 * to discard one — and every discarded fit costs a download out of an
	 * embedded HTTP server plus an FFT.
	 *
	 * It is deliberately NOT `runState`. That one is the CURRENT batch's
	 * progress and summary, and it is right for `clearRun` to drop it when the
	 * selection changes: "fitted 12 of 12" beside a different set of ticks is a
	 * stale claim. The numbers themselves are not a claim about the selection,
	 * so they stay. Reported by Gabe, 2026-08-23: fit the twelve `ring1_`
	 * captures, click the `ring1_v_` chip, and every fit was gone.
	 *
	 * Not written to the card, and not keyed by tool. A cached fit is not a
	 * measurement anybody asked to keep — the results file is where a
	 * measurement is kept, deliberately and against a named tool — and a file's
	 * ring-down does not depend on which head the screen is looking at.
	 *
	 * Unbounded on purpose: the whole directory is 276 files and a fit is five
	 * numbers, so the cap would cost more thought than the memory it saved.
	 */
	const [fits, setFits] = createSignal<ReadonlyMap<string, Mode | NoFit>>(new Map());
	const fitCache = createFitCache(setFits);

	const [runState, setRunState] = createSignal<BatchState>({ kind: "idle" });

	/**
	 * Fit a set of captures and aggregate them into a fingerprint, WITHOUT
	 * writing anything.
	 *
	 * Two phases on purpose. This one is the measurement: every capture reaches
	 * the engine through the same cached loader the chart uses and the same
	 * worker call (`parseCapture` → `detectStop` → `fitDecay`), so every
	 * number in the result is one this UI computed from those bytes. The second
	 * phase — writing it against a tool — is a separate, armed act, because
	 * attributing a measurement to the wrong head is the mistake a toolchanger
	 * makes easily and cannot see afterwards.
	 *
	 * Takes REFS rather than file names, which is what lets it fit anything the
	 * card can show: a tool's own recorded captures (the only way to re-fit a
	 * stale `tool<N>.json` after an estimator change, #33) and an imported CSV
	 * as readily as a board file. What an import cannot do is be SAVED against
	 * a tool, and `attribution` below is where that is settled.
	 *
	 * A file that does not fit still gets a CaptureRecord, carrying its NoFit.
	 * `aggregate` takes the median of the fits that succeeded, so a rejected
	 * capture is excluded from the numbers and still present in the file — and
	 * `contributed` says how many of how many, which is the figure that keeps a
	 * partial aggregate from reading as a complete one.
	 */
	const fitCaptures = async (refs: readonly CaptureRef[], purpose: BatchPurpose = { kind: "baseline" }): Promise<void> => {
		if (refs.length === 0 || runState().kind === "running") return;
		// The cap lives HERE rather than on the button, so the one route that
		// downloads a batch is the one that refuses an unreasonable one. A
		// disabled button is a suggestion; this is the thing that would issue
		// the requests.
		if (refs.length > MAX_BATCH) {
			setRunState({ kind: "failed", why: `${refs.length} captures is more than one measurement run — filter to at most ${MAX_BATCH} before fitting.` });
			return;
		}
		const records: CaptureRecord[] = [];
		for (const [index, ref] of refs.entries()) {
			setRunState({ kind: "running", done: index, total: refs.length, file: ref.file });
			const parts = captureNameParts(ref.file);
			try {
				// One route whatever the origin: the cached loader answers a board
				// file with a download and an import from the bytes it already
				// holds, so this loop cannot care which it was handed.
				const result = await useEngine().fit(await loader.text(ref), parts.axis);
				records.push({ file: ref.file, axis: parts.axis, dir: parts.dir, rep: parts.rep, fit: result.fit, tStop: result.tStop });
				// Remembered as it lands rather than at the end, so a batch that
				// fails on its ninth file keeps the eight it already paid for. By
				// the ref's KEY, which is what the rows are identified by — two
				// imports can share a file name and neither is the board's file.
				fitCache.remember(ref.key, result.fit);
			} catch (err) {
				setRunState({ kind: "failed", why: `${ref.file}: ${err instanceof Error ? err.message : String(err)}` });
				return;
			}
		}
		const fingerprint = aggregate(records.map(r => ({ axis: r.axis, fit: r.fit })));
		const imported = importedCount(refs);
		setRunState({
			kind: "fitted",
			fingerprint,
			purpose,
			// The records travel only when the batch is this machine's own. An
			// imported CSV is a file the operator brought, not a capture of this
			// tool, so there is nothing here for `saveMeasurement` to write.
			attribution: imported === 0
				? { kind: "machine", records }
				: {
					kind: "imported",
					why: `${imported === 1 ? "One capture was" : `${imported} captures were`} imported from this computer, so this fit cannot be written to a tool — a tool's results file records that machine's own captures.`,
				},
			contributed: fingerprint.n.X + fingerprint.n.Y,
			total: records.length,
		});
	};

	/**
	 * Write a fitted batch against a tool. The tool is an ARGUMENT and there is
	 * no default: `svc.tool()` is where the screen is looking, which is not the
	 * same as what the operator meant to attribute a measurement to, and on a
	 * four-head machine those two being confused is unrecoverable from the
	 * file afterwards.
	 */
	const saveMeasurement = async (tool: number): Promise<void> => {
		const run = runState();
		// Both halves are the type's, not a policy written here: there are no
		// records to write unless the run is `fitted` AND its captures were this
		// machine's own, so the narrowing is what makes the call below compile.
		// Three narrowings, and the middle one is the load-bearing addition:
		// a verify run's fingerprint describes the machine WITH a shaper on it
		// and must never be written as this tool's baseline. It has its own
		// writer below.
		if (run.kind !== "fitted" || run.purpose.kind !== "baseline" || run.attribution.kind !== "machine") return;
		setRunState({ kind: "saving", tool });
		try {
			store.setMeasurement(tool, run.fingerprint, run.attribution.records);
			await store.save(tool);
			setRunState({ kind: "saved", tool, contributed: run.contributed, total: run.total });
			// The screen follows the tool just measured: every other card on it
			// is about `tool()`, and leaving them on a different head after a
			// save would show the operator someone else's fingerprint.
			setToolNow(tool);
			setCapturePick(null);
		} catch (err) {
			setRunState({ kind: "failed", why: `could not write ${RESULTS_PATH(tool)}: ${err instanceof Error ? err.message : String(err)}` });
		}
	};

	const clearRun = (): void => {
		setRunState({ kind: "idle" });
	};

	/* ------------------------------------------------------------- speed sweep */

	/**
	 * The speed-sweep runs the board's own capture directory holds.
	 *
	 * Derived from the SAME listing the Decay card browses — one `rr_filelist`
	 * per connection, shared — so the two cards cannot disagree about what is on
	 * the card, and switching to the Sweep card costs no request of its own.
	 */
	const families = createMemo((): readonly SweepFamily[] => speedFamilies(board().map(e => e.name)));

	/**
	 * The full-step rate of one axis, off the object model.
	 *
	 * On the SERVICE rather than in the card because the card must not be the
	 * place that decides it: the number sets where the "forced vibration" locus
	 * is drawn, and a second derivation would eventually disagree with this one.
	 * Re-derived per read, so a `M350` sent from the console moves the line on
	 * the next poll.
	 */
	const fullStepFor = (axis: Axis): FullStep => fullStepPerMm(base.om.om.move.axes, axis);

	const [sweepState, setSweepState] = createSignal<SweepState>({ kind: "idle" });

	/**
	 * Turn one family of speed-suffixed captures into a `SweepMatrix`.
	 *
	 * Every capture reaches the transform by the same route a fitted one does —
	 * the cached loader, then the worker — so the numbers in the picture are
	 * ones this UI computed from that machine's own bytes, and a file already
	 * downloaded for the Decay card is not downloaded twice.
	 *
	 * Two inputs are NOT guessed here, and neither is negotiable:
	 *
	 *  - `fullStepsPerMm` comes from the object model or the run is refused. It
	 *    decides where the forced-vibration locus is drawn, and a plausible
	 *    default would draw a confident lie (shaping/fullStep.ts).
	 *  - the move DISTANCE comes from `shaping.defaults.distMm`, the same
	 *    setting the Capture card states and Settings edits, because `moveS` is
	 *    distance ÷ speed and nothing in a capture file records how far the
	 *    carriage went. One setting, two readers, no third opinion.
	 *
	 * The tool is `tool()` at the moment of the call — the Sweep card carries
	 * the tool picker itself, so the head this is attributed to is the one on
	 * screen beside the button. Nothing is written to the card here; `saveSweep`
	 * is the separate, explicit act, for the same reason `saveMeasurement` is.
	 */
	const buildSweep = async (family: SweepFamily): Promise<void> => {
		const state = sweepState().kind;
		if (state === "loading" || state === "computing") return;
		if (family.members.length === 0) return;
		// The cap lives here, on the one route that would issue the requests —
		// a disabled button is a suggestion, this is the thing that downloads.
		if (family.members.length > MAX_SWEEP) {
			setSweepState({ kind: "failed", why: `${family.id} has ${family.members.length} captures; a sweep is capped at ${MAX_SWEEP}.` });
			return;
		}
		const step = fullStepFor(family.axis);
		if (!step.known) {
			setSweepState({ kind: "failed", why: step.why });
			return;
		}
		const distMm = base.config.config.shaping.defaults.distMm;
		if (!(Number.isFinite(distMm) && distMm > 0)) {
			setSweepState({ kind: "failed", why: "the excitation move has no length — set one in Settings › Input shaping." });
			return;
		}
		const n = tool();
		const channel = family.axis === "Y" ? (1 as const) : (0 as const);
		const rows: Array<{ speed: ReturnType<typeof mmPerS>; csv: string; moveS: ReturnType<typeof seconds>; axis: 0 | 1 | 2 }> = [];
		try {
			for (const [index, member] of family.members.entries()) {
				setSweepState({ kind: "loading", done: index, total: family.members.length, file: member.file });
				rows.push({
					speed: mmPerS(member.speed),
					csv: await loader.text(boardRef(member.file)),
					moveS: seconds(distMm / member.speed),
					axis: channel,
				});
			}
			setSweepState({ kind: "computing", total: rows.length });
			const matrix = await useEngine().sweep(rows, step.perMm);
			store.setSweep(n, matrix);
			setSweepState({
				kind: "built",
				tool: n,
				family: family.id,
				rows: matrix.speeds.length,
				analysed: analysedRows(matrix),
			});
		} catch (err) {
			setSweepState({ kind: "failed", why: `${family.id}: ${err instanceof Error ? err.message : String(err)}` });
		}
	};

	/**
	 * Write the selected tool's results — sweep included — to the card.
	 *
	 * Explicit rather than folded into `buildSweep`, and the reason is a
	 * measurement: a nine-speed matrix serialises to 134 KiB, which is a large
	 * upload to put on RRF's embedded server without being asked. The card
	 * states the size beside the button.
	 */
	const saveSweep = async (): Promise<void> => {
		const n = tool();
		setSweepState({ kind: "saving", tool: n });
		try {
			await store.save(n);
			setSweepState({ kind: "saved", tool: n });
		} catch (err) {
			setSweepState({ kind: "failed", why: `could not write ${RESULTS_PATH(n)}: ${err instanceof Error ? err.message : String(err)}` });
		}
	};

	/** Changing tool changes which captures exist, so the selections reset with
	 *  it — a stale one would select a different capture, not no capture. */
	const setTool = (next: number): void => {
		setToolNow(next);
		setCapturePick(null);
		setCandidateIndex(0);
	};

	/**
	 * Bumped by `reload`, read by the load effect: the ONE way a re-read is
	 * asked for. A reload that called `store.load` directly would be a second
	 * loading path beside the effect, free to disagree with it about which
	 * tools exist — and it did nothing for the tools the operator was not
	 * looking at, which is most of the status card.
	 */
	const [revision, setRevision] = createSignal(0);
	const loaded = new Set<number>();
	let lastRevision = -1;
	createEffect(() => {
		// Tracked first so a bump always re-runs this, whatever else is stale.
		const rev = revision();
		if (!base.connected()) {
			loaded.clear();
			lastRevision = -1;
			return;
		}
		const numbers = base.om.om.tools.filter(t => t !== null).map(t => t.number);
		// The selected tool is loaded even on a machine reporting no tools at
		// all, so the rest of the screen has something to render against.
		const wanted = numbers.length > 0 ? numbers : [tool()];
		// A new revision re-reads everything; a re-run caused by the tools array
		// alone fetches only what it has not seen on this connection.
		const asked = rev !== lastRevision;
		lastRevision = rev;
		const missing = asked ? wanted : wanted.filter(n => !loaded.has(n));
		if (missing.length === 0) return;
		for (const n of missing) loaded.add(n);
		// Sequential: RRF's embedded server tolerates very few concurrent
		// requests, and this is a background read behind the live poll.
		void (async () => {
			for (const n of missing) await store.load(n);
		})();
	});

	const resultsFor = (n: number): ToolResults => store.results[n] ?? emptyResults(n);

	/**
	 * The last thing this screen tried and could not do — a failed rank today, a
	 * failed run tomorrow. Empty when there is nothing to report, and cleared by
	 * the next attempt rather than by a timer, so it is still on screen when the
	 * operator looks up.
	 *
	 * Separate from `store.error`, which is specifically "the results file on
	 * the card is not one this build understands". Collapsing them would make a
	 * transient worker failure look like a corrupt file.
	 */
	const [problem, setProblem] = createSignal("");

	/**
	 * The selected tool's accelerometer, as the M955/M956 builders address one,
	 * or null when config names none for it.
	 *
	 * `parseAccelAddr` and not a cast: the overlay is untrusted text, and the
	 * address brand has exactly one minting site (control/commands.ts) so that a
	 * capture cannot be aimed at a board nobody chose.
	 */
	const accelFor = (n: number): ReturnType<typeof parseAccelAddr> =>
		parseAccelAddr(base.config.config.shaping.accelByTool[n] ?? "");

	/**
	 * May the machine move for this tool right now, and if not, why?
	 *
	 * ONE reading, shared by every control on the screen. It re-derives on each
	 * object-model poll, so what a disabled button says is never older than the
	 * last poll — and, being a fresh `Preconditions.read` every time, it has no
	 * way to return `stale`. Nothing here decides anything: `read` is the
	 * authority and this is a memo over its answer.
	 *
	 * The one refusal this constructs itself is `no-accelerometer` with an EMPTY
	 * address, which is not a machine verdict but a missing setting: with no
	 * `accelByTool` entry there is no address to ask the board about. The copy
	 * table (shaping/copy.ts) answers that case in its own words.
	 */
	const gate = createMemo((): Refusal | null => {
		const addr = accelFor(tool());
		if (addr === null) return { kind: "no-accelerometer", addr: "" };
		const read = Preconditions.read(base.om.om, base.config.config.shaping, addr, Date.now());
		return read.ok ? null : read.refusal;
	});

	/**
	 * What `tpost<N>.g` has to say about shaping, read ONLY when the operator
	 * opens that tool's row.
	 *
	 * Lazily, and that is the whole design: a four-tool machine would otherwise
	 * cost four downloads on mount, on a board whose HTTP server tolerates very
	 * few requests, to fill a column most sessions never look at.
	 */
	const [macros, setMacros] = createStore<Record<number, MacroRead>>({});
	const macroFor = (n: number): MacroRead => macros[n] ?? { kind: "closed" };

/**
	 * What installing a shaper is doing right now.
	 *
	 * Its own signal rather than an arm of `BatchState`, for the reason the
	 * sweep has one: the two answer different questions and can be looked at
	 * together. A measurement's progress overwriting "the macro was written"
	 * would take away the only confirmation the operator gets that the machine
	 * will still be shaped after the next toolchange.
	 */
	const [applyState, setApplyState] = createSignal<ApplyState>({ kind: "idle" });

	/**
	 * Install a shaper, one of the two ways there are.
	 *
	 * They are separate ACTS and not a preference, which is why `how` is a
	 * closed union rather than a boolean and why each has its own confirm:
	 *
	 *  - `send` puts `M593` on the machine NOW. It lasts until the firmware is
	 *    reset or the next toolchange runs `tpost<N>.g` over the top of it, so
	 *    it is the one to use while deciding.
	 *  - `macro` rewrites the `M593` line in `tpost<N>.g`, which is what makes
	 *    the shaper the tool's own — RRF runs that file every time the carriage
	 *    is picked up. It survives a reset, and it is the one that changes what
	 *    the machine does tomorrow.
	 *
	 * An operator who meant one and got the other has either lost their setting
	 * at the next toolchange or changed their machine permanently by accident,
	 * and neither is recoverable by looking at the screen afterwards.
	 */
	const applyShaper = async (n: number, spec: ShaperSpec, how: "send" | "macro"): Promise<void> => {
		if (applyState().kind === "working") return;
		const line = cmd.inputShaping(spec);
		setApplyState({ kind: "working", how });
		try {
			if (how === "send") {
				await base.connector.sendCode(line);
			} else {
				const path = toolMacroPath(n);
				// Read-modify-write against the file that is there NOW. Never a
				// cached copy: `macroFor` may hold a line read minutes ago, and
				// writing a whole file back from a stale read would silently
				// discard anything edited in between.
				let text = "";
				try {
					text = await base.connector.download(path);
				} catch (err) {
					// A tool with no post-select macro is an ordinary machine, so
					// this creates one. Any other failure is a transfer to retry
					// and must not be turned into an overwrite of a file we could
					// not read.
					if (!(err instanceof FileNotFoundError)) throw err;
					text = `; created by dwc-ng for T${n}\n`;
				}
				await base.connector.upload(path, replaceShapingLine(text, line));
				// The card's own reading of the file is now stale by definition.
				if (macroFor(n).kind !== "closed") setMacros(n, { kind: "line", line });
			}
			store.setApplied(n, spec);
			await store.save(n);
			setApplyState({ kind: "done", how, line });
		} catch (err) {
			setApplyState({ kind: "failed", why: `${how === "send" ? "sending" : "writing"} ${line}: ${err instanceof Error ? err.message : String(err)}` });
		}
	};

/**
	 * Write what a verify run measured, as a comparison rather than as a
	 * measurement.
	 *
	 * The mirror of `saveMeasurement`, and it can only be reached with a verify
	 * batch: the baseline and the spec it needs exist ONLY in that arm of
	 * `BatchPurpose`, so there is no way to call this with a plain measurement
	 * and no way to call `saveMeasurement` with this one.
	 *
	 * `verifyAnalysis` is the sole producer of the verified brand
	 * (shaping/store.ts) — the numbers on the card are derived from the two
	 * fingerprints here and are never asserted, so a file cannot claim a shaper
	 * was verified.
	 */
	const saveVerified = async (n: number): Promise<void> => {
		const run = runState();
		if (run.kind !== "fitted" || run.purpose.kind !== "verify" || run.attribution.kind !== "machine") return;
		setRunState({ kind: "saving", tool: n });
		try {
			store.addVerified(n, verifyAnalysis(run.purpose.baseline, candidateFor(run.purpose.spec, run.purpose.baseline), run.fingerprint));
			await store.save(n);
			setRunState({ kind: "saved", tool: n, contributed: run.contributed, total: run.total });
			setToolNow(n);
		} catch (err) {
			setRunState({ kind: "failed", why: `could not write ${RESULTS_PATH(n)}: ${err instanceof Error ? err.message : String(err)}` });
		}
	};

/** What the accelerometer reported last time it was asked, per tool. */
	const [accelReports, setAccelReports] = createStore<Record<number, AccelReport>>({});
	const accelReportFor = (n: number): AccelReport | null => accelReports[n] ?? null;

	/**
	 * Ask an accelerometer what rate and resolution it is running.
	 *
	 * `M955` with P alone REPORTS; it is the only way to find out, because the
	 * object model does not carry the rate — `boards[n].accelerometer` is
	 * orientation, points and runs and nothing else.
	 */
	const readAccel = async (n: number): Promise<void> => {
		const addr = accelFor(n);
		if (addr === null) return;
		try {
			setAccelReports(n, parseAccelReport(await base.connector.sendCode(cmd.accelConfig(addr))));
		} catch (err) {
			setAccelReports(n, { known: false, raw: err instanceof Error ? err.message : String(err) });
		}
	};

	/**
	 * Set the rate and resolution, then ASK what was actually selected.
	 *
	 * The read-back is not a nicety, it is the only truthful answer. RRF
	 * adjusts the resolution to be no greater than R and then picks "a value
	 * supported at that resolution that is close to" S — so what the operator
	 * typed and what the sensor is doing are routinely different numbers. An
	 * LIS3DH asked for 5376 at 10-bit does not get it.
	 *
	 * Which is also why nothing here predicts or validates the pair against a
	 * table of sensors. The board knows; this asks it.
	 */
	const setAccelRate = async (n: number, sampleRateHz: number, bits: number): Promise<void> => {
		const addr = accelFor(n);
		if (addr === null) return;
		try {
			await base.connector.sendCode(cmd.accelRate(addr, sampleRateHz, bits));
		} catch (err) {
			setAccelReports(n, { known: false, raw: err instanceof Error ? err.message : String(err) });
			return;
		}
		await readAccel(n);
	};

	const toggleMacro = (n: number): void => {
		if (macroFor(n).kind !== "closed") {
			setMacros(n, { kind: "closed" });
			return;
		}
		setMacros(n, { kind: "reading" });
		const path = toolMacroPath(n);
		void (async () => {
			try {
				const line = findShapingLine(await base.connector.download(path));
				setMacros(n, line === null ? { kind: "no-line" } : { kind: "line", line });
			} catch (err) {
				// A tool with no post-select macro is ordinary, and is not the same
				// news as a transfer that failed — the operator can create the one
				// and can only retry the other.
				setMacros(n, err instanceof FileNotFoundError ? { kind: "absent" } : { kind: "unreadable" });
			}
		})();
	};

	/**
	 * Rank the selected tool's fingerprint through the worker.
	 *
	 * It lives on the SERVICE rather than on a card because two cards offer it —
	 * the status card's step list and (task F1) the Candidates table's own Rank
	 * button — and a ranking computed two ways is a ranking that can disagree
	 * with itself. Pure compute: no motion, so the gate does not apply; the only
	 * precondition is a fingerprint to rank.
	 */
	const [ranking, setRanking] = createSignal(false);
	const rank = async (): Promise<void> => {
		const n = tool();
		const fingerprint = resultsFor(n).fingerprint;
		if (fingerprint === null || ranking()) return;
		setRanking(true);
		setProblem("");
		try {
			// The Pareto front, not the top N by residual. A plain slice of the
			// residual order returned forty rows of ONE shaper on Gabe's
			// machine (engine/rank.ts `shortlist`), which hid that a trade
			// between ringing and smoothing existed at all.
			store.setCandidates(n, shortlist(await useEngine().rank(fingerprint), RANKED_KEPT));
		} catch (err) {
			// A worker that failed is not a machine that refused, and the
			// operator has to be able to tell them apart: a silent failure here
			// reads as "Rank does nothing", which is how the store-proxy clone
			// bug survived being written.
			setProblem(`ranking failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setRanking(false);
		}
	};

	/* ------------------------------------------------------------ the machine */

	/**
	 * The screen's ONE motion slot, and the only writer of it.
	 *
	 * A Shaping screen may have a Capture card and a Verify card on it at once,
	 * and both drive the carriage. Two runs in flight is not a state a machine
	 * can be in, so it is not a state this screen can express: `beginMotion`
	 * hands back the writer, or null when the slot is taken, and there is no
	 * setter beside it for a card to reach past it with.
	 *
	 * @invariant one-run-at-a-time-per-screen
	 * @rung 7  capability object — a card cannot report motion without a
	 *          reporter, the only producer of a reporter is `beginMotion`, and
	 *          `beginMotion` returns null while `motionBusy` holds. The signal's
	 *          setter is closed over and never handed out, so "two cards each
	 *          driving the machine and each reporting over the other" is not
	 *          expressible. A reporter also stops working once its own run has
	 *          reported a terminal state, so a late event from an abandoned run
	 *          cannot overwrite a fresh one's progress
	 * @why the run this screen starts sends a 200 mm/s G1 with nobody's hand on
	 *      the jog wheel. Two of them interleaved would each be re-checking the
	 *      carriage against ITS plan's expected position and finding the other
	 *      one's move — every step refused, the machine moving anyway, and two
	 *      restores racing at the end
	 */
	const [motion, setMotionNow] = createSignal<MotionState>({ kind: "idle" });
	let motionAbort: AbortController | null = null;

	const beginMotion = (): { readonly signal: AbortSignal; readonly report: (state: MotionState) => void } | null => {
		if (motionBusy(motion())) return null;
		const controller = new AbortController();
		motionAbort = controller;
		let live = true;
		return {
			signal: controller.signal,
			report: (state: MotionState): void => {
				if (!live) return;
				setMotionNow(state);
				// A run that has reported a terminal state is finished with the
				// slot. Freeing it here rather than in the caller means a caller
				// that forgot cannot leave the screen unable to run again.
				if (!motionBusy(state)) {
					live = false;
					if (motionAbort === controller) motionAbort = null;
				}
			},
		};
	};

	/**
	 * Stop the run. Both cancellation routes end in `Procedure.run`'s `finally`,
	 * so the shaper still goes back — the abort is checked between steps and
	 * inside the capture wait, and neither path can skip the restore.
	 */
	const cancelMotion = (): void => {
		motionAbort?.abort();
	};

	// A screen that goes away takes its run with it. Services die with their
	// screen (see the module header), and an unattended run whose progress
	// nobody can see is worse than a cancelled one — the restore is sent either
	// way, because the abort reaches the generator's `finally`.
	onCleanup(cancelMotion);

	/**
	 * Hand a finished measure run's captures to the batch state the Decay card
	 * already reports and saves from.
	 *
	 * Two states rather than one, on purpose. `MotionState` is what the MACHINE
	 * did; `BatchState` is what the MEASUREMENT came to, and it is the thing
	 * `saveMeasurement` writes against a tool through its own armed confirm. A
	 * run that lands twelve captures has not measured anything until they are
	 * fitted, and fitting them is not a motion.
	 */
	const setFitted = (records: readonly CaptureRecord[], purpose: BatchPurpose = { kind: "baseline" }): void => {
		const fingerprint = aggregate(records.map(r => ({ axis: r.axis, fit: r.fit })));
		setRunState({
			kind: "fitted",
			fingerprint,
			purpose,
			// This machine's own captures, by construction: they came off it a
			// moment ago through `Procedure.run`.
			attribution: { kind: "machine", records: [...records] },
			contributed: fingerprint.n.X + fingerprint.n.Y,
			total: records.length,
		});
	};

	/** Bytes a run already paid for, put where the Decay card looks. */
	const rememberCapture = (file: string, csv: string, fit: Mode | NoFit): void => {
		const ref = boardRef(file);
		loader.remember(ref, csv);
		fitCache.remember(ref.key, fit);
	};

	/**
	 * Which cards on THIS screen can actually carry out which step.
	 *
	 * The status card lists the workflow and reports each step's readiness, but
	 * it does not run any of them: the Capture card owns the capture run, the
	 * Sweep card the sweep, and so on, each with its own armed confirm. So the
	 * button here calls the owning card's handler or is disabled — it never
	 * grows a second implementation of a run, which on a screen with a status
	 * card and a doing card is exactly the duplication that goes wrong.
	 *
	 * It is also a real state rather than scaffolding: compositions are the
	 * operator's, and a Shaping screen they have removed the Capture card from
	 * genuinely cannot measure. Saying which card does it is the useful answer.
	 */
	const [offered, setOffered] = createSignal<readonly ShapingStep[]>([]);
	const handlers = new Map<ShapingStep, () => void>();
	const offer = (step: ShapingStep, run: () => void): (() => void) => {
		handlers.set(step, run);
		setOffered(list => (list.includes(step) ? list : [...list, step]));
		const withdraw = (): void => {
			handlers.delete(step);
			setOffered(list => list.filter(s => s !== step));
		};
		onCleanup(withdraw);
		return withdraw;
	};
	const runStep = (step: ShapingStep): void => {
		handlers.get(step)?.();
	};

	// Ranking has no card of its own to come from — it is arithmetic this
	// service performs — so the service offers it and the step list needs no
	// special case for the one step that is always available.
	offer("rank", () => void rank());

	/** Re-read every tool's file from the card. The results live in files the
	 *  operator can also edit or copy in, exactly like the height map.
	 *
	 *  This is also the one gesture that means "the card is not what I last
	 *  read", so it drops the two session caches with it: the downloaded CSV
	 *  text and the fits taken from it. Re-running a capture under a name that
	 *  already exists is the ordinary way these files change, and a reload that
	 *  kept either would show yesterday's ring-down under today's file name. */
	const reload = (): void => {
		loader.forget();
		fitCache.forget();
		setRevision(r => r + 1);
	};

	return {
		store, tool, setTool, resultsFor, reload,
		motion, beginMotion, cancelMotion, setFitted, rememberCapture,
		results: (): ToolResults => resultsFor(tool()),
		capturePick, setCapturePick, imports, addImport, loadCapture: loader.text,
		board, boardState, boardError, wantBoard, refreshBoard,
		runState, fitCaptures, saveMeasurement, clearRun,
		fits, families, fullStepFor, sweepState, buildSweep, saveSweep,
		candidateIndex, setCandidateIndex,
		accelFor, accelReportFor, readAccel, setAccelRate, gate, macroFor, toggleMacro, rank, ranking, problem, offer, runStep,
		applyShaper, applyState, saveVerified,
		offers: (step: ShapingStep): boolean => offered().includes(step),
		// Whether a step's OWNING card is on the screen at all, which is a
		// different fact from whether it has offered to run the step: the first
		// is the operator's composition, the second is whether that card has a
		// run control yet. Telling them apart is what stops an unbuilt step
		// reading as a broken one.
		onScreen: base.onScreen,
	};
}

/**
 * The registry. `keyof typeof SERVICES` IS the ServiceId type — an unknown
 * service is a compile error at every use site.
 */
export const SERVICES = {
	jobsBrowser: (base: ServiceBaseCtx) => jobsBrowserService(base),
	macrosBrowser: (base: ServiceBaseCtx) => domainBrowser(base, "0:/macros"),
	sysBrowser: (base: ServiceBaseCtx) => domainBrowser(base, "0:/sys"),
	heightmap: (base: ServiceBaseCtx) => heightmapService(base),
	shaping: (base: ServiceBaseCtx) => shapingService(base),
} as const;

export type ServiceId = keyof typeof SERVICES;
export type ServiceInstance<K extends ServiceId> = ReturnType<(typeof SERVICES)[K]>;

/** The typed accessor a card sees. */
export type ServiceAccessor = <K extends ServiceId>(id: K) => ServiceInstance<K>;

/**
 * One pool per screen. Factories run under the CALLING screen's reactive
 * owner (captured at pool creation), so their resources and effects dispose
 * with the screen.
 */
export function createServicePool(base: ServiceBaseCtx): ServiceAccessor {
	const owner = getOwner();
	const instances: Partial<Record<ServiceId, unknown>> = {};
	return <K extends ServiceId>(id: K): ServiceInstance<K> => {
		if (!(id in instances)) {
			instances[id] = runWithOwner(owner, () => SERVICES[id](base));
		}
		return instances[id] as ServiceInstance<K>;
	};
}
