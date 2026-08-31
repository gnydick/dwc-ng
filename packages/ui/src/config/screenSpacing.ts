/**
 * Per-screen spacing tokens (GIT_194 increment 5): the between-cards gutter
 * and the default in-card body padding for ONE screen, in --u units.
 *
 * Machine-scoped overlay data riding `screens` (like `screens.layouts`):
 * how far apart THIS machine's cards draw is a fact about this machine's
 * screens, not about the operator. See
 * docs/superpowers/specs/2026-08-30-screen-spacing-tokens-design.md.
 *
 * @invariant screen-spacing-in-range-on-step
 * @rung 6  choke-point — `sanitizeScreenSpacing` is the only producer of a
 *          stored ScreenSpacing: the untrusted overlay boundary
 *          (config/parse.ts parseScreens) and the store writer
 *          (config/store.ts setScreenSpacing) both call it, and nothing else
 *          writes `screens.spacing`. Corrupt input becomes a safe value or is
 *          dropped (the clampRect precedent, shell/panelCanvas.ts) — never a
 *          throw
 * @why the gutter is subtracted from the card's drawn box (span·u − gutter),
 *      so an off-grid or absurd gutter breaks the quantum every card is sized
 *      on; the SD file is hand-editable JSON
 * @debt promote to rung 7 by branding ScreenSpacing so a hand-written literal
 *       is not assignable. Blocked on the brand surviving JSON round-trips to
 *       the SD card — the same block as ShapingConfig's Envelope @debt.
 */

/** Per-screen spacing overrides, in --u units. An absent member means the
 *  shipped default token stands (overlay-on-defaults; reset = drop). */
export interface ScreenSpacing {
	/**
	 * Between-cards gutter, in WHOLE cells (integer 0..GUTTER_MAX_U).
	 *
	 * Integer because the card's drawn box is span·u − gutter (the gutter
	 * lives on the card, not the grid — shell/panelCanvas.ts GAP_PX): only a
	 * whole number of cells keeps the box on the quantum. GIT_170's ruling,
	 * recorded at app.css `.panel-canvas > *`: 1u is the smallest gutter the
	 * grid can express above zero. Zero itself is legal — the cards' inset
	 * hairlines still read as a seam (same ruling).
	 */
	gutterU?: number;
	/**
	 * Card body SIDE padding, 0..PAD_MAX_U in half-steps (padding is inside
	 * the body and touches no grid quantum; the shipped tokens already use
	 * half-steps). Bottom padding derives as half of this — the shipped
	 * --sp-card-x:--sp-card-b ratio (4u:2u), so padU 4 reproduces the shipped
	 * look exactly. Top padding is structural (the sticky header parks
	 * against it) and is never overridden.
	 */
	padU?: number;
}

/**
 * The SHIPPED defaults, in u — what an un-overridden screen draws, and the
 * value the drawer's steppers start from. These mirror index.css
 * (`--sp-card-gutter: calc(1 * var(--u))`, `--sp-card-x: calc(4 * var(--u))`);
 * the stylesheet stays the authority the browser reads, and
 * test/screen-spacing.test.ts fails the suite if the pair drifts — the same
 * pin panel-canvas uses for its source-text guards. (A generator would be
 * stronger; not worth a build step for two numbers — recorded as the mirror's
 * mechanism, rung 3.)
 */
export const DEFAULT_GUTTER_U = 1;
export const DEFAULT_PAD_U = 4;

/** The widest gutter offered: twice the pre-GIT_170 default. */
export const GUTTER_MAX_U = 4;
/** Editing step for the gutter: whole cells only (see ScreenSpacing.gutterU). */
export const GUTTER_STEP_U = 1;
/** The widest side padding offered: twice the shipped --sp-card-x. */
export const PAD_MAX_U = 8;
/** Editing step for the padding: half-cells (see ScreenSpacing.padU). */
export const PAD_STEP_U = 0.5;

/** Clamp into [0, max] and snap to the step. Finite input only. */
function quantize(n: number, step: number, max: number): number {
	return Math.min(max, Math.max(0, Math.round(n / step) * step));
}

/**
 * The sole gate from unknown input to a stored ScreenSpacing.
 *
 * Non-object → undefined. A non-finite or non-number member drops (that leaf
 * behaves as never-customized — the overlay philosophy); a finite number is
 * clamped and quantized rather than dropped (clampRect precedent: a
 * hand-edited 2.4 means "about 2", not "forget my setting"). An empty result
 * is undefined so the overlay's prune keeps no husk behind.
 */
export function sanitizeScreenSpacing(raw: unknown): ScreenSpacing | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
	const o = raw as Record<string, unknown>;
	const out: ScreenSpacing = {};
	if (typeof o.gutterU === "number" && Number.isFinite(o.gutterU)) {
		out.gutterU = quantize(o.gutterU, GUTTER_STEP_U, GUTTER_MAX_U);
	}
	if (typeof o.padU === "number" && Number.isFinite(o.padU)) {
		out.padU = quantize(o.padU, PAD_STEP_U, PAD_MAX_U);
	}
	return out.gutterU === undefined && out.padU === undefined ? undefined : out;
}

/**
 * The one producer of the CSS this feature emits: the custom-property scope
 * for a screen's panel canvas. Custom properties inherit, so setting them on
 * the canvas container re-grounds every `var(--sp-card-gutter)` /
 * `var(--sp-card-x)` / `var(--sp-card-b)` read by the cards below it — no
 * stylesheet edit, no second consumer path. A card-level override applied ON
 * a card element (increment 4's territory) sits in a nearer scope and wins by
 * construction.
 *
 * Every value is `calc(n * var(--u))` — the px lint
 * (test/unit-lengths.test.ts) scans TS too, and a literal unit here would
 * fail the suite. `gutterU: 0` emits a REAL zero-length, not absence:
 * absence means "shipped default", zero means "the operator asked for none".
 *
 * The return type says CUSTOM PROPERTIES ONLY (`--${string}` keys) — the
 * same shape PanelCanvas's `vars` prop demands (its
 * grid-metrics-unoverridable invariant), so this producer cannot emit a
 * real CSS property that would land as inline style on the canvas.
 */
export type ScreenSpacingVars = { [key: `--${string}`]: string };

export function spacingVars(spacing: ScreenSpacing | undefined): ScreenSpacingVars {
	const vars: ScreenSpacingVars = {};
	if (spacing === undefined) return vars;
	if (spacing.gutterU !== undefined) {
		vars["--sp-card-gutter"] = `calc(${spacing.gutterU} * var(--u))`;
	}
	if (spacing.padU !== undefined) {
		vars["--sp-card-x"] = `calc(${spacing.padU} * var(--u))`;
		vars["--sp-card-b"] = `calc(${spacing.padU / 2} * var(--u))`;
	}
	return vars;
}
