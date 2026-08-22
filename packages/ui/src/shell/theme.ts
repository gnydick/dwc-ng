/**
 * UI theme — which palette the chrome is painted with.
 *
 * A per-device display preference, not machine configuration, so it persists
 * to localStorage and never touches the config overlay (same reasoning as
 * shell/scale.ts: a choice that uploads to the SD card and trips the dirty /
 * "Save to machine" cycle is a machine setting, and which ground a browser
 * draws in is not one).
 *
 * The mechanism is one attribute on <html>, data-theme. index.css holds the
 * shipped palette on :root and theme-vellum.css holds one override block per
 * non-default theme, so:
 *
 *   - the default is the ABSENCE of an override. The shipped palette is written
 *     down once, on :root, and cannot drift from the theme that claims to be it.
 *   - deleting this feature leaves the UI rendering byte-identically.
 *
 * The dev palette lab (dev/paletteLab.ts) uses a DIFFERENT attribute,
 * data-ground, for grounds that are being judged rather than shipped. A ground
 * graduates by moving its CSS block here and its id into THEMES; it must not
 * exist in both places, because the two selectors would then compete on
 * specificity for the same tokens.
 */
import { createSignal } from "solid-js";

/** Which ground the chart palette (om/heaterSeries.ts) must be solved for. A
 *  line mixed at L=76 for a dark card reads near 1.8:1 on a light one. */
export type Ground = "dark" | "light";

export interface Theme {
	id: string;
	label: string;
	title: string;
	ground: Ground;
}

/** theme-vellum.css is the authority on what a theme IS; this list is the
 *  authority on which exist. An id listed here with no CSS block renders as the
 *  default — it cannot render as something broken. */
export const THEMES: readonly Theme[] = [
	{ id: "graphite", label: "Graphite", title: "Dark — neutral graphite, cyan accent", ground: "dark" },
	{ id: "vellum", label: "Vellum", title: "Light — paper ground, ink text, copper accent", ground: "light" },
] as const;

export const DEFAULT_THEME = "graphite";

const KEY = "dwc-ng.theme";

export function parseTheme(raw: string | null): string {
	return THEMES.some(t => t.id === raw) ? raw! : DEFAULT_THEME;
}

export function groundOf(id: string): Ground {
	return THEMES.find(t => t.id === parseTheme(id))!.ground;
}

function load(): string {
	if (typeof localStorage === "undefined") return DEFAULT_THEME;
	try {
		return parseTheme(localStorage.getItem(KEY));
	} catch {
		return DEFAULT_THEME;
	}
}

const [theme, setThemeSignal] = createSignal<string>(load());
export { theme };

/** THE PREFERENCE is written from one place — attribute, signal and storage
 *  together — so the document cannot disagree with the control. Nothing else
 *  may touch `data-theme`. */
export function setTheme(id: string): void {
	const next = parseTheme(id);
	setThemeSignal(next);
	if (typeof document !== "undefined") {
		if (next === DEFAULT_THEME) document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", next);
	}
	try {
		localStorage.setItem(KEY, next);
	} catch {
		// Private mode / quota: the choice just won't survive a reload.
	}
}

/** Apply the stored theme at boot. Idempotent. */
export function applyStoredTheme(): void {
	setTheme(theme());
}
