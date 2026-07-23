import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useApp } from "../shell/context.ts";
import { findSegmentIndex } from "./findSegmentIndex.ts";
import { computeOpaqueRange, computeGhostRanges, type RenderMode, type GhostMode } from "./renderModes.ts";
import { computeHueColors, colorModeAvailable, type ColorMode } from "./hueColors.ts";
import { computeSegmentWidths } from "./segmentWidth.ts";
import type { ParsedToolpath } from "./parseGcode.ts";
import type { SceneHandle } from "./scene.ts";
import type { WorkerResponse } from "./parseGcode.worker.ts";

type Status = "empty" | "loading" | "ready" | "error";

const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;

const REVEAL_MODES: readonly RenderMode[] = ["progressive", "static", "layer-focus"];
const REVEAL_MODE_LABEL: Record<RenderMode, string> = {
	progressive: "Progressive",
	static: "Static",
	"layer-focus": "Layer",
};

const COLOR_MODES: readonly ColorMode[] = ["feature-type", "speed", "layer-time"];
const COLOR_MODE_LABEL: Record<ColorMode, string> = {
	"feature-type": "Feature",
	speed: "Speed",
	"layer-time": "Layer time",
};

const GHOST_MODES: readonly GhostMode[] = ["show", "hidden"];
const GHOST_MODE_LABEL: Record<GhostMode, string> = {
	show: "Preview",
	hidden: "Hide",
};

/** Travel (non-extruding) moves are hidden by default and, when shown, use
 *  their own fixed color rather than the active color mode's hue (see scene.ts). */
const DEFAULT_SHOW_TRAVEL = false;

/** Default to Hide: only the opaque layer is built (see scene.ts), so the view
 *  opens showing just what has actually printed, with no ghost geometry. */
const DEFAULT_GHOST_MODE: GhostMode = "hidden";

/** Live 3D toolpath of the active job — downloaded and parsed once per
 *  file, then only recolored (never re-fetched or re-parsed) as
 *  job.filePosition advances. Color mode (feature-type/speed/layer-time)
 *  picks each segment's hue; reveal mode (progressive/static/layer-focus)
 *  picks which contiguous range is opaque vs. a translucent ghost preview
 *  (see renderModes.ts) — the two are independent axes, recombined every
 *  tick. Rendered as real instanced 3D tube geometry with Three.js's own
 *  lighting (see scene.ts), not a custom shader.
 *  See docs/superpowers/specs/2026-07-19-gcode-viewer-colorize-thick-lines-design.md.
 *
 *  Content-only body; chrome comes from the compose registry
 *  (compose/defs.ts "gcode-viewer") or the legacy wrapper below. */
export function GcodeViewerBody() {
	const app = useApp();
	let canvasEl!: HTMLCanvasElement;
	let hostEl!: HTMLDivElement;
	let scene: SceneHandle | null = null;
	let worker: Worker | null = null;
	let toolpath: ParsedToolpath | null = null;
	let generation = 0;
	// Cached per-segment hue: recomputed and re-uploaded only when the color MODE
	// changes, so a live position tick stays on the cheap build-once split path
	// (updatePosition) instead of rebuilding colors every poll.
	let cachedHue: Float32Array | null = null;
	let cachedColorMode: ColorMode | null = null;

	const [status, setStatus] = createSignal<Status>("empty");
	const [message, setMessage] = createSignal("");
	const [revealMode, setRevealMode] = createSignal<RenderMode>("progressive");
	const [colorMode, setColorMode] = createSignal<ColorMode>("feature-type");
	const [ghostMode, setGhostMode] = createSignal<GhostMode>(DEFAULT_GHOST_MODE);
	const [showTravel, setShowTravel] = createSignal(DEFAULT_SHOW_TRAVEL);
	const [lastPath, setLastPath] = createSignal<string | null>(null);

	const bedCenter = (): { x: number; y: number } => {
		const axes = app.om.om.move.axes;
		const x = axes[0];
		const y = axes[1];
		return {
			x: x ? (x.min + x.max) / 2 : 150,
			y: y ? (y.min + y.max) / 2 : 150,
		};
	};

	/** Farthest any real geometry can be from bedCenter (at build height 0):
	 *  half the bed's XY diagonal, plus the full Z axis travel — a real
	 *  upper bound from the machine's own reported limits, not a guess. */
	const bedExtent = (): number => {
		const axes = app.om.om.move.axes;
		const x = axes[0], y = axes[1], z = axes[2];
		const halfDiagonal = x && y ? Math.hypot((x.max - x.min) / 2, (y.max - y.min) / 2) : 150;
		const zTravel = z ? z.max - z.min : 300;
		return halfDiagonal + zTravel;
	};

	/** The machine's actual XY bed footprint (mm), for the reference/shadow plane. */
	const bedSize = (): { x: number; y: number } => {
		const axes = app.om.om.move.axes;
		const x = axes[0], y = axes[1];
		return {
			x: x ? x.max - x.min : 300,
			y: y ? y.max - y.min : 300,
		};
	};

	const activeFileName = (): string | null => {
		const f = app.om.om.job.file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f.fileName : null;
	};

	const filamentDiameter = (): number => app.om.om.move.extruders[0]?.filamentDiameter || DEFAULT_FILAMENT_DIAMETER_MM;

	const recolor = (): void => {
		if (toolpath === null || scene === null) return;
		const fp = app.om.om.job.filePosition;
		const liveIndex = fp === null ? -1 : findSegmentIndex(toolpath.byteOffset, fp);
		const opaqueRange = computeOpaqueRange(toolpath.segmentCount, toolpath.layerIndex, liveIndex, revealMode());
		const ghostRanges = computeGhostRanges(toolpath.segmentCount, opaqueRange, ghostMode());

		// Colors only change with the color MODE. On a mode change recompute + let
		// the scene re-upload; otherwise this is a plain position/reveal/ghost tick,
		// which just moves the split (two thinInstanceCount updates — no upload).
		const mode = colorMode();
		if (cachedHue === null || cachedColorMode !== mode) {
			cachedHue = computeHueColors(toolpath, mode);
			cachedColorMode = mode;
			scene.updateColors(cachedHue, opaqueRange, ghostRanges);
		} else {
			scene.updatePosition(opaqueRange, ghostRanges);
		}

		// The marker tracks the actual head position independent of reveal
		// mode (progressive/static/layer-focus only affect which segments
		// look opaque, not where the tool physically is right now).
		if (liveIndex >= 0 && liveIndex < toolpath.segmentCount) {
			const base = liveIndex * 6;
			scene.setToolPosition([toolpath.positions[base + 3]!, toolpath.positions[base + 4]!, toolpath.positions[base + 5]!]);
		} else {
			scene.setToolPosition(null);
		}
	};

	const load = async (path: string): Promise<void> => {
		const gen = ++generation;
		setStatus("loading");
		setMessage("");
		toolpath = null;
		cachedHue = null; // new file → force a fresh hue computation on first color
		try {
			const [text, sceneMod] = await Promise.all([app.connector.download(path), import("./scene.ts")]);
			if (gen !== generation) return;
			scene ??= sceneMod.createScene(canvasEl, hostEl.clientWidth, hostEl.clientHeight, bedCenter(), bedExtent(), bedSize());

			worker?.terminate();
			worker = new Worker(new URL("./parseGcode.worker.ts", import.meta.url), { type: "module" });
			worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
				if (gen !== generation) return;
				const res = event.data;
				if (!res.ok) {
					setMessage(res.error);
					setStatus("error");
					return;
				}
				toolpath = res.toolpath;
				const widths = computeSegmentWidths(
					toolpath.positions, toolpath.deltaE, toolpath.extruding,
					toolpath.layerIndex, toolpath.layerHeights, filamentDiameter(),
				);
				const opaqueRange = computeOpaqueRange(toolpath.segmentCount, toolpath.layerIndex, -1, revealMode());
				const ghostRanges = computeGhostRanges(toolpath.segmentCount, opaqueRange, ghostMode());
				const hue = computeHueColors(toolpath, colorMode());
				scene!.setGeometry(toolpath.positions, hue, widths, toolpath.extruding, toolpath.layerIndex, toolpath.layerHeights, opaqueRange, ghostRanges);
				// Prime the cache so the recolor() below takes the cheap position path
				// (setGeometry already uploaded this hue).
				cachedHue = hue;
				cachedColorMode = colorMode();
				scene!.setTravelVisible(showTravel());
				setStatus("ready");
				recolor();
			};
			worker.postMessage(text);
		} catch (err) {
			if (gen !== generation) return;
			setMessage(err instanceof Error ? err.message : String(err));
			setStatus("error");
		}
	};

	const retry = (): void => {
		const p = lastPath();
		if (p !== null) void load(p);
	};

	createEffect(() => {
		const name = activeFileName();
		if (name === null) {
			setStatus("empty");
			setLastPath(null);
			return;
		}
		if (name !== lastPath()) {
			setLastPath(name);
			void load(name);
		}
	});

	// Live sync: recolor (never re-parse) on every filePosition/mode change.
	createEffect(() => {
		app.om.om.job.filePosition;
		revealMode();
		colorMode();
		ghostMode();
		recolor();
	});

	// Travel visibility is a pure show/hide on an already-built mesh — no
	// recolor/rebuild needed (see scene.ts's setTravelVisible).
	createEffect(() => {
		scene?.setTravelVisible(showTravel());
	});

	// Panels are user-resizable (drag grip, see Panel.tsx) with no resize
	// event of their own — watch the host element directly, same pattern
	// Panel.tsx uses for its own scroll-nub-state tracking.
	onMount(() => {
		const resizeObserver = new ResizeObserver(() => {
			scene?.resize(hostEl.clientWidth, hostEl.clientHeight);
		});
		resizeObserver.observe(hostEl);
		onCleanup(() => resizeObserver.disconnect());
	});

	onCleanup(() => {
		worker?.terminate();
		scene?.destroy();
	});

	return (
		<div class="gcode-viewer" ref={hostEl}>
				<div class="gcode-viewer-modes gcode-viewer-modes-color" role="group" aria-label="Color mode">
					<For each={COLOR_MODES}>
						{m => (
							<button
								type="button"
								class="mode-btn"
								classList={{ active: colorMode() === m }}
								disabled={status() === "ready" && !colorModeAvailable(toolpath!, m)}
								onClick={() => setColorMode(m)}
							>
								{COLOR_MODE_LABEL[m]}
							</button>
						)}
					</For>
				</div>
				<div class="gcode-viewer-modes gcode-viewer-modes-reveal" role="group" aria-label="Reveal mode">
					<For each={REVEAL_MODES}>
						{m => (
							<button
								type="button"
								class="mode-btn"
								classList={{ active: revealMode() === m }}
								onClick={() => setRevealMode(m)}
							>
								{REVEAL_MODE_LABEL[m]}
							</button>
						)}
					</For>
				</div>
				<div class="gcode-viewer-modes gcode-viewer-modes-ghost" role="group" aria-label="Not-yet-printed preview">
					<For each={GHOST_MODES}>
						{m => (
							<button
								type="button"
								class="mode-btn"
								classList={{ active: ghostMode() === m }}
								onClick={() => setGhostMode(m)}
							>
								{GHOST_MODE_LABEL[m]}
							</button>
						)}
					</For>
				</div>
				<div class="gcode-viewer-modes gcode-viewer-modes-travel" role="group" aria-label="Travel moves">
					<button
						type="button"
						class="mode-btn"
						classList={{ active: showTravel() }}
						onClick={() => setShowTravel(v => !v)}
					>
						Travel
					</button>
				</div>
				<canvas ref={canvasEl} class="gcode-canvas" />
				<Show when={status() === "empty"}><div class="gcode-overlay">No active job</div></Show>
				<Show when={status() === "loading"}><div class="gcode-overlay">Loading toolpath…</div></Show>
				<Show when={status() === "error"}>
					<div class="gcode-overlay err">
						{message()} <button class="link-btn" onClick={retry}>Retry</button>
					</div>
				</Show>
		</div>
	);
}
