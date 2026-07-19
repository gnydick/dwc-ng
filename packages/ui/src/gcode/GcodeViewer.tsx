import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";
import { findSegmentIndex } from "./findSegmentIndex.ts";
import { computeSegmentColors, type RenderMode } from "./renderModes.ts";
import type { ParsedToolpath } from "./parseGcode.ts";
import type { SceneHandle } from "./scene.ts";
import type { WorkerResponse } from "./parseGcode.worker.ts";

type Status = "empty" | "loading" | "ready" | "error";

const MODES: readonly RenderMode[] = ["progressive", "static", "layer-focus"];
const MODE_LABEL: Record<RenderMode, string> = {
	progressive: "Progressive",
	static: "Static",
	"layer-focus": "Layer",
};

/** Live 3D toolpath of the active job — downloaded and parsed once per
 *  file, then only recolored (never re-fetched or re-parsed) as
 *  job.filePosition advances. See docs/superpowers/specs/
 *  2026-07-18-activity-view-gcode-viewer-design.md. */
export function GcodeViewer(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	let canvasEl!: HTMLCanvasElement;
	let hostEl!: HTMLDivElement;
	let scene: SceneHandle | null = null;
	let worker: Worker | null = null;
	let toolpath: ParsedToolpath | null = null;
	let generation = 0;

	const [status, setStatus] = createSignal<Status>("empty");
	const [message, setMessage] = createSignal("");
	const [mode, setMode] = createSignal<RenderMode>("progressive");
	const [lastPath, setLastPath] = createSignal<string | null>(null);

	const activeFileName = (): string | null => {
		const f = app.om.om.job.file;
		return f !== null && typeof f.fileName === "string" && f.fileName.length > 0 ? f.fileName : null;
	};

	const recolor = (): void => {
		if (toolpath === null || scene === null) return;
		const fp = app.om.om.job.filePosition;
		const liveIndex = fp === null ? -1 : findSegmentIndex(toolpath.byteOffset, fp);
		scene.updateColors(computeSegmentColors(toolpath.segmentCount, toolpath.layerIndex, liveIndex, mode()));
	};

	const load = async (path: string): Promise<void> => {
		const gen = ++generation;
		setStatus("loading");
		setMessage("");
		toolpath = null;
		try {
			const [text, sceneMod] = await Promise.all([app.connector.download(path), import("./scene.ts")]);
			if (gen !== generation) return;
			scene ??= sceneMod.createScene(canvasEl, hostEl.clientWidth, hostEl.clientHeight);

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
				scene!.setGeometry(toolpath.positions, computeSegmentColors(toolpath.segmentCount, toolpath.layerIndex, -1, mode()));
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
		mode();
		recolor();
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
		<Card id="gcode-viewer" canvas={props.canvas} ariaLabel="G-code toolpath" title="Toolpath" tip="job.file · job.filePosition">
			<div class="gcode-viewer" ref={hostEl}>
				<div class="gcode-viewer-modes" role="group" aria-label="Render mode">
					<For each={MODES}>
						{m => (
							<button
								type="button"
								class="mode-btn"
								classList={{ active: mode() === m }}
								onClick={() => setMode(m)}
							>
								{MODE_LABEL[m]}
							</button>
						)}
					</For>
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
		</Card>
	);
}
