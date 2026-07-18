/**
 * Camera zoom (fit vs native resolution) + scroll position — global across
 * every view's CameraPanel instance and persisted across reloads. Kept in
 * localStorage, not the config overlay: a scroll offset has no business being
 * uploaded to the machine's SD card, and this should update immediately
 * without waiting on "Save to machine".
 */

import { createSignal } from "solid-js";

export interface CameraViewState {
	native: boolean;
	scrollLeft: number;
	scrollTop: number;
}

export const DEFAULT_CAMERA_VIEW_STATE: CameraViewState = { native: false, scrollLeft: 0, scrollTop: 0 };

const STORAGE_KEY = "dwc-ng.camera-view";

function isFiniteNumber(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

/** Tolerant parse: anything unexpected yields the default state, never a throw. */
export function parseCameraViewState(raw: string | null): CameraViewState {
	if (raw === null || raw === "") return DEFAULT_CAMERA_VIEW_STATE;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return DEFAULT_CAMERA_VIEW_STATE;
	}
	if (typeof parsed !== "object" || parsed === null) return DEFAULT_CAMERA_VIEW_STATE;
	const p = parsed as Partial<CameraViewState>;
	return {
		native: p.native === true,
		scrollLeft: isFiniteNumber(p.scrollLeft) ? p.scrollLeft : 0,
		scrollTop: isFiniteNumber(p.scrollTop) ? p.scrollTop : 0,
	};
}

export function serializeCameraViewState(state: CameraViewState): string {
	return JSON.stringify(state);
}

function loadStored(): CameraViewState {
	if (typeof localStorage === "undefined") return DEFAULT_CAMERA_VIEW_STATE;
	try {
		return parseCameraViewState(localStorage.getItem(STORAGE_KEY));
	} catch {
		return DEFAULT_CAMERA_VIEW_STATE;
	}
}

function writeStored(state: CameraViewState): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, serializeCameraViewState(state));
	} catch {
		// Private mode / quota exceeded: state just won't survive a reload.
	}
}

const [cameraViewState, setCameraViewStateSignal] = createSignal<CameraViewState>(loadStored());
export { cameraViewState };

/**
 * Patch and persist. This is one shared signal, not per-view — updating it
 * from whichever view's CameraPanel is mounted is immediately reflected the
 * next time any view's CameraPanel mounts, including after a reload.
 */
export function setCameraViewState(patch: Partial<CameraViewState>): void {
	const next = { ...cameraViewState(), ...patch };
	setCameraViewStateSignal(next);
	writeStored(next);
}
