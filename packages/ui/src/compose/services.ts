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
 *    screen's reactive owner, so resources/effects dispose on unmount —
 *    selection resets on navigation exactly as the bespoke views did).
 *
 * Factories may use signals/resources/effects: they run under the screen's
 * owner via runWithOwner.
 */
import { createEffect, createResource, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js";
import { createFileBrowser } from "../files/browser.ts";
import { createHeightMapStore } from "../heightmap/store.ts";
import { cellPosition } from "../heightmap/parse.ts";
import type { AppServices } from "../shell/context.ts";

/** What a service factory gets: the app services plus the uniform gate. */
export interface ServiceBaseCtx extends AppServices {
	connected: () => boolean;
}

/** Browser + selection for a file domain — the shape Jobs/Macros/System share. */
function domainBrowser(base: ServiceBaseCtx, root: string, sort?: "recent") {
	const browser = createFileBrowser(root, base.connected, base.connector, sort);
	const [selected, setSelected] = createSignal<string | null>(null);
	return { browser, selected, setSelected };
}

function jobsBrowserService(base: ServiceBaseCtx) {
	const domain = domainBrowser(base, "0:/gcodes", "recent");
	// One transfer at a time on the weak RRF server.
	const [downloading, setDownloading] = createSignal<string | null>(null);
	// The details card's data, chained: fileinfo keyed on the selection, then
	// the first thumbnail keyed on the fileinfo.
	const [info] = createResource(domain.selected, path => base.connector.getFileInfo(path));
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

	return { ...domain, downloading, download, info, thumb };
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
 * The registry. `keyof typeof SERVICES` IS the ServiceId type — an unknown
 * service is a compile error at every use site.
 */
export const SERVICES = {
	jobsBrowser: (base: ServiceBaseCtx) => jobsBrowserService(base),
	macrosBrowser: (base: ServiceBaseCtx) => domainBrowser(base, "0:/macros"),
	/** Same directory, SEPARATE navigation and selection: the inventory card and
	 *  the Macros card can sit on one screen without moving each other. */
	macrosInventoryBrowser: (base: ServiceBaseCtx) => domainBrowser(base, "0:/macros"),
	sysBrowser: (base: ServiceBaseCtx) => domainBrowser(base, "0:/sys"),
	heightmap: (base: ServiceBaseCtx) => heightmapService(base),
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
