import { Show, createEffect, onCleanup } from "solid-js";
import { useApp } from "./context.ts";
import { cameraViewState, setCameraViewState } from "./cameraViewState.ts";

const SCROLL_SAVE_DEBOUNCE_MS = 150;

/**
 * A 1x1 transparent GIF. Pointing the element at this is what actually ABORTS
 * an MJPEG connection — and it costs no request, unlike `src = ""`, which some
 * browsers resolve against the document URL and re-fetch the page.
 */
const BLANK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * The camera stream, and the teardown that stops it — in ONE component, so a
 * stream cannot be mounted without the thing that aborts it.
 *
 * Removing an `<img>` from the DOM does NOT close a `multipart/x-mixed-replace`
 * connection. Solid unmounted the element correctly and the stream kept
 * running: measured on the real board 2026-07-24, pin → unpin → pin toggled the
 * element in and out of the DOM while `performance.getEntriesByType("resource")`
 * still showed exactly ONE entry with `responseEnd === 0` — re-showing the
 * camera never opened a new request, because the old one had never ended. A
 * hidden camera streamed continuously for as long as the tab was open.
 *
 * Pointing src at a data URI before the element goes away is what ends it.
 */
function StreamImage(props: {
	src: string;
	native: boolean;
	onToggleZoom: () => void;
	onLoaded: () => void;
}) {
	let el!: HTMLImageElement;
	// Tied to THIS element's lifetime, not the panel's: the stream also has to
	// stop when the URL is cleared in Settings while the panel stays mounted.
	onCleanup(() => { el.src = BLANK_PIXEL; });
	return (
		<img
			ref={el}
			src={props.src}
			alt="Machine camera stream"
			title={props.native ? "Click to fit panel" : "Click for native resolution"}
			onClick={() => props.onToggleZoom()}
			onLoad={() => props.onLoaded()}
		/>
	);
}

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
				<StreamImage
					src={app.config.config.camera.streamUrl}
					native={cameraViewState().native}
					onToggleZoom={() => setCameraViewState({ native: !cameraViewState().native })}
					onLoaded={() => { if (cameraViewState().native) restoreScroll(); }}
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
