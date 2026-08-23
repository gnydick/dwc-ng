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
import { createEffect, createResource, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js";
import { createFileBrowser } from "../files/browser.ts";
import { loadBrowserMemory, saveBrowserFile } from "../files/browserMemory.ts";
import { fileUnderRoot } from "../files/path.ts";
import { forcedJobInfoErrorNow } from "../dev/forcedJobInfoError.ts";
import { createHeightMapStore } from "../heightmap/store.ts";
import { cellPosition } from "../heightmap/parse.ts";
import { createShapingStore } from "../shaping/store.ts";
import { emptyResults, type ToolResults } from "../shaping/results.ts";
import type { AppServices } from "../shell/context.ts";

/** What a service factory gets: the app services plus the uniform gate. */
export interface ServiceBaseCtx extends AppServices {
	connected: () => boolean;
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
	const [captureIndex, setCaptureIndex] = createSignal(0);
	const [candidateIndex, setCandidateIndex] = createSignal(0);

	/** Changing tool changes what the row indices MEAN, so they reset with it —
	 *  a stale index would select a different capture, not no capture. */
	const setTool = (next: number): void => {
		setToolNow(next);
		setCaptureIndex(0);
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

	/** Re-read every tool's file from the card. The results live in files the
	 *  operator can also edit or copy in, exactly like the height map. */
	const reload = (): void => {
		setRevision(r => r + 1);
	};

	return {
		store, tool, setTool, resultsFor, reload,
		results: (): ToolResults => resultsFor(tool()),
		captureIndex, setCaptureIndex, candidateIndex, setCandidateIndex,
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
