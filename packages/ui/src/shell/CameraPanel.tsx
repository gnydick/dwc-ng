import { Show, createEffect, onCleanup } from "solid-js";
import { useApp } from "./context.ts";
import { cameraViewState, setCameraViewState } from "./cameraViewState.ts";

const SCROLL_SAVE_DEBOUNCE_MS = 150;

/**
 * Camera stream body. Zoom (fit/native) and scroll position are global state
 * (cameraViewState), not per-instance — switching views or reloading lands on
 * the same view.
 *
 * Content-only; the pinned gate lives in the compose registry's visibleWhen
 * (compose/defs.ts "camera") — the composed path has ONE encoding of the
 * condition. The legacy wrapper below keeps its own Show for un-converted
 * views.
 */
export function CameraBody() {
	const app = useApp();
	let bodyEl!: HTMLDivElement;
	let scrollSaveTimer = 0;

	const restoreScroll = (): void => {
		if (!bodyEl) return;
		const s = cameraViewState();
		bodyEl.scrollLeft = s.scrollLeft;
		bodyEl.scrollTop = s.scrollTop;
	};

	const onScroll = (): void => {
		window.clearTimeout(scrollSaveTimer);
		scrollSaveTimer = window.setTimeout(() => {
			setCameraViewState({ scrollLeft: bodyEl.scrollLeft, scrollTop: bodyEl.scrollTop });
		}, SCROLL_SAVE_DEBOUNCE_MS);
	};
	onCleanup(() => window.clearTimeout(scrollSaveTimer));

	// Re-apply the saved scroll position whenever this instance mounts already
	// zoomed in, and whenever some other view's panel toggles zoom on while
	// this one is the one currently showing.
	createEffect(() => {
		if (cameraViewState().native) restoreScroll();
	});

	return (
		<div class="cam-body" classList={{ native: cameraViewState().native }} ref={bodyEl} onScroll={onScroll}>
			<Show
				when={app.config.config.camera.streamUrl !== ""}
				fallback={<span>Set a stream URL in <a href="#/settings">Settings</a></span>}
			>
				<img
					src={app.config.config.camera.streamUrl}
					alt="Machine camera stream"
					title={cameraViewState().native ? "Click to fit panel" : "Click for native resolution"}
					onClick={() => setCameraViewState({ native: !cameraViewState().native })}
					onLoad={() => { if (cameraViewState().native) restoreScroll(); }}
				/>
			</Show>
		</div>
	);
}

/** The header ✕ that unpins the camera everywhere (shared by both paths). */
export function CameraHideAction() {
	const app = useApp();
	return (
		<button class="card-act" title="Hide camera" aria-label="Hide camera" onClick={() => app.config.setCamera({ pinned: false })}>✕</button>
	);
}
