/**
 * The rail's tool section — a mount point the current screen fills, rather than
 * a place the Shell keeps its own controls.
 *
 * The controls that belong here (compose, reset layout) act on ONE screen's
 * canvas, and that canvas is owned by ComposedScreen: it holds the
 * PanelCanvasController, the composition and the config overlay wiring. Hoisting
 * all of that into the Shell so the rail could own the buttons would move a lot
 * of state up to serve a piece of chrome.
 *
 * So the ownership stays put and the DOM moves instead: ComposedScreen renders
 * its own controls through a <Portal> into this element. That buys the property
 * outright — the tools exist EXACTLY when a composed screen is mounted. The Card
 * Lab, the file editor and any future non-composed route cannot show a control
 * that has nothing to act on, because nothing is portalling into the slot.
 *
 * A module-level signal rather than context, matching navState.ts and
 * density.ts: this is shell chrome, not an app service, and there is exactly one
 * rail.
 */
import { createSignal } from "solid-js";

const [railSlot, setRailSlot] = createSignal<HTMLElement | null>(null);

export { railSlot, setRailSlot };
