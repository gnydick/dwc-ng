import type { JSX } from "solid-js";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type { PanelCanvasController } from "./panelCanvas.ts";
import { CardTip } from "./CardTip.tsx";
import { PanelTools } from "./PanelTools.tsx";

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
	labelsToggle?: boolean;
	/** Header left zone. */
	title?: string;
	/** Header float-left zone: the small tag naming what powers the card. */
	tip?: JSX.Element;
	/** Header float-right zone: the card's own controls (close, save, reset…). */
	actions?: JSX.Element;
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
			// Picked up: the card says so, not just its grip. A formation of three
			// has to be readable as a formation from across the canvas, or you
			// cannot tell what a drag is about to carry.
			classList={{
					picked: props.canvas.isSelected(props.id),
					// Grids whose first track IS the label column need to drop that
					// track, not just leave it empty — an empty max-content track
					// still takes its gap and slides every row right.
					"no-labels": props.labelsToggle === true && !props.canvas.labelsFor(props.id),
				}}
			aria-label={props.ariaLabel}
			data-panel-id={props.id}
			style={props.canvas.styleFor(props.id)}
		>
			<Show when={canScrollUp()}>
				<button
					type="button"
					class="panel-scroll-nub up"
					aria-label={`Scroll ${props.ariaLabel} up`}
					onPointerDown={event => startHoldScroll(-1, event)}
				/>
			</Show>
			<div class="panel-body" ref={bodyEl}>
				{/* The header, in four zones. The grip+toggle (right, sacred) are a
				    real child here — not a floating overlay — so nothing can sit to
				    their right by construction. See CardHead's doc for the zones. */}
				<div class="card-head">
					<Show when={props.title}>{t => <h2 class="card-title">{t()}</h2>}</Show>
					<Show when={props.tip}>{tip => <CardTip>{tip()}</CardTip>}</Show>
					<div class="card-head-right">
						<Show when={props.actions}>{a => <div class="card-actions">{a()}</div>}</Show>
						<PanelTools id={props.id} canvas={props.canvas} ariaLabel={props.ariaLabel} orientationToggle={props.orientationToggle} labelsToggle={props.labelsToggle} />
					</div>
				</div>
				{props.children}
			</div>
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
