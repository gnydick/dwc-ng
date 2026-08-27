import type { Connector } from "./types.ts";

/**
 * Hand the board's session back while the page is not on screen, and take it
 * again when it comes back.
 *
 * Why this is transport-level and not a nicety (GIT_110 requirement 3). A
 * closed tab, a refresh, or a phone switching apps used to leave the session
 * held until the board idled it out — and the board has four of them, or
 * fewer. Nothing in the UI released it, because no `unload` handler existed at
 * all.
 *
 * Which events. `pagehide` and `visibilitychange`, never `beforeunload` alone:
 * on mobile — and this UI is mobile-first — a backgrounded tab is frequently
 * killed without `beforeunload` ever firing, and Safari/Chrome both document
 * `pagehide`/`visibilitychange` as the last points a page reliably gets. The
 * pair is deliberate rather than redundant: `visibilitychange` covers the phone
 * that is switched away from and later returned to, `pagehide` covers the tab
 * that is closed or navigated away outright (including into the bfcache, where
 * the page is frozen with its session still held).
 *
 * Releasing while merely hidden is not over-eager here: a hidden tab's timers
 * are throttled to near-nothing by every modern browser, so what it holds is a
 * slot rather than a live view — on a machine with four slots that is the
 * difference between a second device being able to connect and not.
 *
 * Neither half is fire-and-forget in the wrong direction: the connector's own
 * goodbye is best-effort (see session.ts), and the resume only runs if THIS
 * handler is what released the session, so a page that was already
 * disconnected — or one the operator disconnected deliberately — is not
 * silently reconnected behind them.
 */
export interface PageVisibility {
	readonly visibilityState: string;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

export interface PageLifecycleHost {
	readonly document: PageVisibility;
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
}

/**
 * Wire the handlers and return the unsubscribe. In a non-browser host (the
 * node test runner, SSR) there is no page to hide, so this is a no-op and the
 * caller needs no environment check of its own.
 */
export function releaseSessionWhileHidden(
	connector: Connector,
	host: PageLifecycleHost | null = defaultHost(),
): () => void {
	if (host === null) return () => undefined;

	let releasedByUs = false;
	// One chain: a fast hide/show/hide cannot interleave a connect with the
	// disconnect it is meant to follow.
	let chain: Promise<unknown> = Promise.resolve();
	const run = (op: () => Promise<unknown>): void => {
		chain = chain.then(op, op).then(() => undefined, () => undefined);
	};

	const hide = (): void => {
		if (releasedByUs || connector.status === "disconnected") return;
		releasedByUs = true;
		run(() => connector.disconnect());
	};
	const show = (): void => {
		if (!releasedByUs) return;
		releasedByUs = false;
		run(() => connector.connect());
	};
	const onVisibility = (): void => {
		if (host.document.visibilityState === "hidden") hide();
		else show();
	};

	host.addEventListener("pagehide", hide);
	host.addEventListener("pageshow", show);
	host.document.addEventListener("visibilitychange", onVisibility);

	return () => {
		host.removeEventListener("pagehide", hide);
		host.removeEventListener("pageshow", show);
		host.document.removeEventListener("visibilitychange", onVisibility);
	};
}

function defaultHost(): PageLifecycleHost | null {
	const host = globalThis as unknown as Partial<PageLifecycleHost>;
	if (typeof host.addEventListener !== "function") return null;
	const doc = host.document;
	if (doc === undefined || typeof doc.addEventListener !== "function") return null;
	return host as PageLifecycleHost;
}
