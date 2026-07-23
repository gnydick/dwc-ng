import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import type { Orientation } from "../shell/panelOrientation.ts";

/**
 * The 7-axis DRO — content-only body; chrome comes from the compose registry
 * (compose/defs.ts "position") or, temporarily, the legacy wrapper below.
 */
export function PositionBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));

	return (
		<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting for the machine…</p>}>
			<Show
				when={props.orientation() === "horizontal"}
				fallback={
					<For each={visibleAxes()}>
						{axis => (
							<div class="dro-row" classList={{ unhomed: !axis.homed }}>
								<span class="dro-axis">
									{axis.letter}
									<Show when={app.config.config.axisRoles[axis.letter]}>
										{role => <span class="dro-role">{role()}</span>}
									</Show>
								</span>
								<span class="dro-val">
									{(axis.machinePosition ?? 0).toFixed(2)}<small>mm</small>
								</span>
								<span class="homed-tag" classList={{ yes: axis.homed, no: !axis.homed }}>
									{axis.homed ? "homed" : "unhomed"}
								</span>
							</div>
						)}
					</For>
				}
			>
				<div class="dro-h-row">
					<For each={visibleAxes()}>
						{axis => (
							<div class="dro-h-cell" classList={{ unhomed: !axis.homed }}>
								<span class="dro-h-axis">
									{axis.letter}
									<Show when={app.config.config.axisRoles[axis.letter]}>
										{role => <span class="dro-role">{role()}</span>}
									</Show>
								</span>
								<span class="dro-h-val">
									{(axis.machinePosition ?? 0).toFixed(2)}<small>mm</small>
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</Show>
	);
}
