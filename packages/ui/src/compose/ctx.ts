/**
 * The context a composed card receives — its ENTIRE external contract.
 *
 * Proven by the Card Lab: a card depends on exactly the four AppServices plus
 * per-slot chrome state; anything supplying this shape can render any card
 * (design doc §renderer). Cards never receive the raw PanelCanvasController
 * or their own id string — orientation arrives pre-bound to the slot, so the
 * id literals that were repeated inside card bodies (orientationFor("…"))
 * have no reason to exist.
 *
 * Widened in phase A5 with the provisioned services of `needs` (typed per
 * card via the service registry); a card that declares no needs sees none.
 */
import type { AppServices } from "../shell/context.ts";
import type { Orientation } from "../shell/panelOrientation.ts";
import type { ServiceAccessor } from "./services.ts";

export interface CardCtx extends AppServices {
	/** Uniform connection gate (replaces five per-view ad-hoc encodings). */
	connected: () => boolean;
	/** This slot's content-layout direction (only meaningful for cards that
	 *  declare orientationToggle). */
	orientation: () => Orientation;
	/** Whether this slot shows its label column/row (only meaningful for cards
	 *  that declare labelsToggle). Cards read it; they never own it. */
	labels: () => boolean;
	/**
	 * Reach a shared service (compose/services.ts). First access provisions it
	 * for this screen; every later access — from any card — returns the same
	 * instance, so two cards cannot disagree about shared state.
	 */
	service: ServiceAccessor;
}
