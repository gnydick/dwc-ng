import { createSignal, onCleanup } from "solid-js";

/**
 * Hash router, hand-rolled (decision 2026-07-12): hash mode is forced by the
 * embedded server anyway (RRF can't rewrite unknown paths to index.html),
 * and five flat views don't justify a router dependency. If nested routes
 * ever matter, swapping this for @solidjs/router is an hour, not a rewrite.
 */

export const ROUTES = ["machine", "control", "jobs", "macros", "system", "settings", "activity"] as const;
export type Route = (typeof ROUTES)[number];

function parse(hash: string): Route {
	const name = hash.replace(/^#\/?/, "").split("/")[0] ?? "";
	return (ROUTES as readonly string[]).includes(name) ? (name as Route) : "machine";
}

/** Reactive current route. Call inside a component (registers cleanup). */
export function createRouter(): () => Route {
	const [route, setRoute] = createSignal<Route>(parse(window.location.hash));
	const onChange = (): void => { setRoute(parse(window.location.hash)); };
	window.addEventListener("hashchange", onChange);
	onCleanup(() => window.removeEventListener("hashchange", onChange));
	return route;
}
