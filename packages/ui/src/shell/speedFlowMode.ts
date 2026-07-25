/**
 * Whether the Position card's third speed cell shows extrusion rate (mm/s of
 * filament) or volumetric flow (mm³/s). Global across every Position card
 * instance and persisted across reloads.
 *
 * localStorage, not the config overlay: that overlay uploads to the machine's
 * SD card and drives the dirty/"Save to machine" cycle (config/types.ts:149),
 * and a display-unit preference is neither machine configuration nor worth
 * marking config unsaved. Same reasoning as shell/cameraViewState.ts.
 */

import { createSignal } from "solid-js";
import type { FlowMode } from "../om/speeds.ts";

export const DEFAULT_SPEED_FLOW_MODE: FlowMode = "linear";

const STORAGE_KEY = "dwc-ng.speed-flow-mode";

/** Tolerant parse: anything unexpected yields the default, never a throw. */
export function parseSpeedFlowMode(raw: string | null): FlowMode {
	return raw === "volumetric" || raw === "linear" ? raw : DEFAULT_SPEED_FLOW_MODE;
}

function loadStored(): FlowMode {
	if (typeof localStorage === "undefined") return DEFAULT_SPEED_FLOW_MODE;
	try {
		return parseSpeedFlowMode(localStorage.getItem(STORAGE_KEY));
	} catch {
		return DEFAULT_SPEED_FLOW_MODE;
	}
}

function writeStored(mode: FlowMode): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// Private mode / quota exceeded: the choice just won't survive a reload.
	}
}

const [speedFlowMode, setSpeedFlowModeSignal] = createSignal<FlowMode>(loadStored());
export { speedFlowMode };

export function toggleSpeedFlowMode(): void {
	const next: FlowMode = speedFlowMode() === "linear" ? "volumetric" : "linear";
	setSpeedFlowModeSignal(next);
	writeStored(next);
}
