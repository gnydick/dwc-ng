import type { JSX } from "solid-js";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type { PanelCanvasController } from "./panelCanvas.ts";

const SCROLL_EDGE_EPSILON_PX = 1;
const HOLD_SCROLL_PX_PER_FRAME = 10;

/**
 * Wraps a view's card section so it sits on that view's grid canvas at an
 * explicit (col, row, colSpan, rowSpan). The move/resize grips are small
 * tabs straddling the card's border, independent of whatever a view puts
 * inside — some cards (e.g. System's Editor) don't always render their
 * own card-head.
 */
export function Panel(props: {
	id: string;
	canvas: PanelCanvasController;
	ariaLabel: string;
	class?: string;
	/** Shows a small header toggle for this card's own content layout
	 *  direction (canvas.orientationFor/toggleOrientation) — opt-in per
	 *  card, since not every card's content can meaningfully flip. */
	orientationToggle?: boolean;
	children: JSX.Element;
}) {
	let bodyEl!: HTMLDivElement;
	const [canScrollUp, setCanScrollUp] = createSignal(false);
	const [canScrollDown, setCanScrollDown] = createSignal(false);

	const recomputeScrollState = (): void => {
		setCanScrollUp(bodyEl.scrollTop > SCROLL_EDGE_EPSILON_PX);
		setCanScrollDown(bodyEl.scrollTop < bodyEl.scrollHeight - bodyEl.clientHeight - SCROLL_EDGE_EPSILON_PX);
	};

	onMount(() => {
		recomputeScrollState();
		const resizeObserver = new ResizeObserver(recomputeScrollState);
		resizeObserver.observe(bodyEl);
		// Panel content is a live-polling mirror of the object model (e.g. a
		// growing console/file list) — its scrollHeight can change with no
		// resize of bodyEl itself, so content mutations need their own watch.
		const mutationObserver = new MutationObserver(recomputeScrollState);
		mutationObserver.observe(bodyEl, { childList: true, subtree: true, characterData: true });
		bodyEl.addEventListener("scroll", recomputeScrollState, { passive: true });
		onCleanup(() => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			bodyEl.removeEventListener("scroll", recomputeScrollState);
		});
	});

	const startHoldScroll = (direction: 1 | -1, event: PointerEvent): void => {
		event.preventDefault();
		let raf = 0;
		const tick = (): void => {
			bodyEl.scrollBy({ top: direction * HOLD_SCROLL_PX_PER_FRAME, behavior: "instant" });
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		const stop = (): void => {
			cancelAnimationFrame(raf);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
		};
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	};

	return (
		<section
			class={props.class ? `card panel ${props.class}` : "card panel"}
			aria-label={props.ariaLabel}
			data-panel-id={props.id}
			style={props.canvas.styleFor(props.id)}
		>
			{/* One cluster, so the toggle sits a fixed gap from the grab handle
			    instead of carrying its own corner offset. The toggle used to live
			    at top-LEFT, on top of the card title. */}
			<div class="panel-tools">
				<Show when={props.orientationToggle}>
					<button
						type="button"
						class="panel-orientation-toggle"
						title={props.canvas.orientationFor(props.id) === "vertical" ? "Switch to horizontal layout" : "Switch to vertical layout"}
						aria-label={`Toggle ${props.ariaLabel} layout direction`}
						onClick={() => props.canvas.toggleOrientation(props.id)}
					>
						{props.canvas.orientationFor(props.id) === "vertical" ? "⇄" : "⇅"}
					</button>
				</Show>
				<button
					type="button"
					class="panel-grip"
					title="Drag to move"
					aria-label={`Move ${props.ariaLabel}`}
					onPointerDown={event => props.canvas.startMove(props.id, event)}
				>
					⠿
				</button>
			</div>
			<Show when={canScrollUp()}>
				<button
					type="button"
					class="panel-scroll-nub up"
					aria-label={`Scroll ${props.ariaLabel} up`}
					onPointerDown={event => startHoldScroll(-1, event)}
				/>
			</Show>
			<div class="panel-body" ref={bodyEl}>{props.children}</div>
			<Show when={canScrollDown()}>
				<button
					type="button"
					class="panel-scroll-nub down"
					aria-label={`Scroll ${props.ariaLabel} down`}
					onPointerDown={event => startHoldScroll(1, event)}
				/>
			</Show>
			<div
				class="panel-resize-grip"
				title="Drag to resize"
				aria-label={`Resize ${props.ariaLabel}`}
				onPointerDown={event => props.canvas.startResize(props.id, event)}
			/>
		</section>
	);
}
