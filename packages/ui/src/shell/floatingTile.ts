import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

/** Pixel placement + size of a `position: fixed` panel. */
export interface TileGeometry {
	left: number;
	top: number;
	width: number;
	height: number;
}

function loadGeometry(key: string): TileGeometry | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return null;
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" || parsed === null
			|| typeof (parsed as TileGeometry).left !== "number"
			|| typeof (parsed as TileGeometry).top !== "number"
			|| typeof (parsed as TileGeometry).width !== "number"
			|| typeof (parsed as TileGeometry).height !== "number"
		) return null;
		return parsed as TileGeometry;
	} catch {
		return null;
	}
}

function saveGeometry(key: string, geometry: TileGeometry): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(key, JSON.stringify(geometry));
	} catch {
		// Private mode / quota: the placement just won't survive a reload.
	}
}

/**
 * Wires drag-to-move (from a handle element) and native CSS resize
 * (`resize: both` on the panel) for a `position: fixed` panel, persisting the
 * result to localStorage under `storageKey` so both survive a reload.
 *
 * Usage: call once per panel instance, pass the returned `setEl` to the
 * panel's `ref`, spread `style()` onto it, and wire `startDrag` to a handle's
 * `onPointerDown`. No geometry saved yet (first run) means `style()` is
 * `undefined` — the panel falls back to its CSS default position/size.
 */
export function createFloatingTile(storageKey: string): {
	setEl: (el: HTMLElement) => void;
	startDrag: (event: PointerEvent) => void;
	style: Accessor<Record<string, string> | undefined>;
} {
	const [geometry, setGeometry] = createSignal(loadGeometry(storageKey));
	const [el, setEl] = createSignal<HTMLElement>();

	const startDrag = (event: PointerEvent): void => {
		const node = el();
		if (!node) return;
		// Don't hijack clicks on header buttons (dock, hide, etc.).
		if (event.target instanceof HTMLElement && event.target.closest("button")) return;
		event.preventDefault();
		const rect = node.getBoundingClientRect();
		const originX = event.clientX;
		const originY = event.clientY;

		const onMove = (moveEvent: PointerEvent): void => {
			const maxLeft = Math.max(0, window.innerWidth - rect.width);
			const maxTop = Math.max(0, window.innerHeight - rect.height);
			setGeometry({
				left: Math.min(Math.max(0, rect.left + (moveEvent.clientX - originX)), maxLeft),
				top: Math.min(Math.max(0, rect.top + (moveEvent.clientY - originY)), maxTop),
				width: rect.width,
				height: rect.height,
			});
		};
		const onUp = (): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			const g = geometry();
			if (g) saveGeometry(storageKey, g);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	// The native resize handle mutates the element's own inline size directly
	// — watch for that so a manual resize sticks too, not just drags.
	createEffect(() => {
		const node = el();
		if (!node) return;
		const observer = new ResizeObserver(() => {
			const rect = node.getBoundingClientRect();
			const g = geometry();
			setGeometry({ left: g?.left ?? rect.left, top: g?.top ?? rect.top, width: rect.width, height: rect.height });
		});
		observer.observe(node);
		onCleanup(() => observer.disconnect());
	});

	const style = createMemo<Record<string, string> | undefined>(() => {
		const g = geometry();
		if (!g) return undefined;
		return { left: `${g.left}px`, top: `${g.top}px`, right: "auto", bottom: "auto", width: `${g.width}px`, height: `${g.height}px` };
	});

	return { setEl, startDrag, style };
}
