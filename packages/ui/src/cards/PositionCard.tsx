import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { speedRow } from "../om/speeds.ts";
import { speedFlowMode, toggleSpeedFlowMode } from "../shell/speedFlowMode.ts";
import type { Orientation } from "../shell/panelOrientation.ts";

/**
 * The 7-axis DRO — content-only body; chrome comes from the compose registry
 * (compose/defs.ts "position") or, temporarily, the legacy wrapper below.
 */
export function PositionBody(props: { orientation: () => Orientation }) {
	const app = useApp();
	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	/**
	 * The cell layout reads in rows of four, so the ROW BREAK has to fall
	 * somewhere meaningful rather than wherever the count lands. X Y Z are the
	 * machine's cardinal axes and C is the coupler — the four you look at as a
	 * set — and U V W are the individual Z motors, which belong together on
	 * their own line. In object-model order C trails the motors and lands alone
	 * on a second row, splitting the group it belongs to.
	 *
	 * Cardinal-plus-coupler first, everything else after, each keeping its own
	 * relative order. A machine without a C, or with axes we have not seen,
	 * still renders every axis exactly once — nothing is filtered, only sorted.
	 */
	const cellAxes = createMemo(() => {
		const FIRST_ROW = ["X", "Y", "Z", "C"];
		const rank = (letter: string): number => {
			const i = FIRST_ROW.indexOf(letter);
			return i === -1 ? FIRST_ROW.length : i;
		};
		return visibleAxes()
			.map((axis, i) => ({ axis, i }))
			.sort((a, b) => rank(a.axis.letter) - rank(b.axis.letter) || a.i - b.i)
			.map(entry => entry.axis);
	});
	const speeds = createMemo(() => speedRow(app.om.om, speedFlowMode()));

	return (
		<Show when={visibleAxes().length} fallback={<p class="job-empty">Waiting…</p>}>
			<Show
				when={props.orientation() === "horizontal"}
				fallback={
					/* ONE grid for all axes, rows as subgrids (see .dro-list in
					   app.css). Each row used to be its own grid, so the axis track
					   measured whatever THAT row's letter and role happened to need
					   — 34px for "X", 76px for "W Z motor 3" — seven different track
					   lists that only looked aligned because the value was
					   right-aligned against a fixed-width tag. Sharing one track list
					   makes the alignment true by construction. */
					<div class="dro-list">
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
					</div>
				}
			>
				<div class="dro-h-row">
					<For each={cellAxes()}>
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
			{/* Machine-wide, not per-axis, so it sits outside the orientation
			    split and reads identically in both layouts. */}
			<div class="speed-foot">
				<span class="speed-foot-tag">Speed</span>
				<For each={speeds()}>
					{cell => (
						<div class="speed-cell">
							<Show
								when={cell.key === "flow"}
								fallback={<span class="speed-label">{cell.label}</span>}
							>
								<button
									type="button"
									class="speed-label speed-toggle"
									onClick={toggleSpeedFlowMode}
									title="Switch between extrusion rate (mm/s of filament) and volumetric flow (mm³/s)"
								>
									{cell.label}
								</button>
							</Show>
							<span class="speed-val" title={cell.source}>
								{cell.value}<small>{cell.unit}</small>
							</span>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}
