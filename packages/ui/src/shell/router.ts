import { createSignal, onCleanup } from "solid-js";

/**
 * Hash router, hand-rolled (decision 2026-07-12): hash mode is forced by the
 * embedded server anyway (RRF can't rewrite unknown paths to index.html).
 *
 * Since the A7 conversion the router carries NO screen list — it only reads
 * the hash's first segment. What that segment MEANS (which screen, or the
 * dev-only Card Lab) is resolved by the consumer against the one screen
 * registry (compose/screens.ts), so the router cannot disagree with the nav
 * or the renderer about what exists (I9).
 */

/** The dev-only Card Lab's reserved route — the one non-screen destination. */
export const LAB_ROUTE = "cards";

function parse(hash: string): string {
	return hash.replace(/^#\/?/, "").split("/")[0] ?? "";
}

/** Reactive current route segment. Call inside a component (registers cleanup). */
export function createRouter(): () => string {
	const [route, setRoute] = createSignal(parse(window.location.hash));
	const onChange = (): void => { setRoute(parse(window.location.hash)); };
	window.addEventListener("hashchange", onChange);
	onCleanup(() => window.removeEventListener("hashchange", onChange));
	return route;
}
