import { Show } from "solid-js";
import { useApp } from "./context.ts";
import { Panel } from "./Panel.tsx";
import type { PanelCanvasController } from "./panelCanvas.ts";

/** Camera as a regular panel, gated on the same pinned flag Settings edits. */
export function CameraPanel(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	return (
		<Show when={app.config.config.camera.pinned}>
			<Panel id="camera" canvas={props.canvas} ariaLabel="Camera" class="cam-panel">
				<div class="card-head">
					<h2 class="card-title">Camera</h2>
					<button title="Hide camera" onClick={() => app.config.setCamera({ pinned: false })}>✕</button>
				</div>
				<div class="cam-body">
					<Show
						when={app.config.config.camera.streamUrl !== ""}
						fallback={<span>Set a stream URL in <a href="#/settings">Settings</a></span>}
					>
						<img src={app.config.config.camera.streamUrl} alt="Machine camera stream" />
					</Show>
				</div>
			</Panel>
		</Show>
	);
}
