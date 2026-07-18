import { Show, createEffect, onCleanup } from "solid-js";
import { useApp } from "./context.ts";
import { Panel } from "./Panel.tsx";
import type { PanelCanvasController } from "./panelCanvas.ts";
import { cameraViewState, setCameraViewState } from "./cameraViewState.ts";

const SCROLL_SAVE_DEBOUNCE_MS = 150;

/**
 * Camera as a regular panel, gated on the same pinned flag Settings edits.
 * Zoom (fit/native) and scroll position are global state (cameraViewState),
 * not per-instance — switching views or reloading lands on the same view.
 */
export function CameraPanel(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	let bodyEl!: HTMLDivElement;
	let scrollSaveTimer = 0;

	// bodyEl is only assigned while this Show branch is actually mounted
	// (camera.pinned); the effect below runs on every instance regardless of
	// that flag, since it reacts to the *global* view state, not this view's
	// own pinned setting — guard against calling this before/without a mount.
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
		<Show when={app.config.config.camera.pinned}>
			<Panel id="camera" canvas={props.canvas} ariaLabel="Camera" class="cam-panel">
				<div class="card-head">
					<h2 class="card-title">Camera</h2>
					<button title="Hide camera" onClick={() => app.config.setCamera({ pinned: false })}>✕</button>
				</div>
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
			</Panel>
		</Show>
	);
}
