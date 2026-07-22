import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import { Card } from "../shell/Card.tsx";
import type { Board } from "../om/types.ts";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

/**
 * Firmware update (M997). Lists every board the object model reports and lets
 * the operator pick which to flash. The command differs by the board's POSITION
 * on the CAN bus, read from `canAddress`: the main board (0) takes a bare
 * `M997`, an expansion/tool board takes `M997 B<canAddress>` (see
 * control/commands.ts, sourced from reference/duet-gcode.md M997).
 *
 * This does NOT decide whether an update is safe — firmware is the authority;
 * the card only builds the codes. The two-step confirm is friction on a
 * destructive action (a bad flash can brick a board), not a machine verdict.
 */
export function FirmwareUpdateCard(props: { canvas: PanelCanvasController }) {
	const app = useApp();
	const boards = createMemo<Board[]>(() => app.om.om.boards.filter((b): b is Board => b !== null));
	const canAddrOf = (b: Board): number => b.canAddress ?? 0;

	// Selected boards keyed by canAddress (unique on the bus).
	const [selected, setSelected] = createSignal<Set<number>>(new Set());
	const [armed, setArmed] = createSignal(false);

	const toggle = (addr: number): void => {
		setArmed(false);
		setSelected(prev => {
			const next = new Set(prev);
			if (next.has(addr)) next.delete(addr);
			else next.add(addr);
			return next;
		});
	};

	const selectedBoards = createMemo(() => boards().filter(b => selected().has(canAddrOf(b))));

	const submit = (): void => {
		const targets = selectedBoards();
		if (targets.length === 0) return;
		if (!armed()) { setArmed(true); return; } // two-step confirm
		setArmed(false);
		// Expansion/tool boards first, main board LAST: flashing the main board
		// resets it and drops this session, after which the others are
		// unreachable. (Behavioural — the M997 entry prescribes no board order.)
		const ordered = [...targets].sort((a, b) => canAddrOf(b) - canAddrOf(a));
		for (const board of ordered) {
			void app.connector.sendCode(cmd.updateFirmware(canAddrOf(board))).catch(() => undefined);
		}
		setSelected(new Set<number>());
	};

	const count = (): number => selectedBoards().length;

	return (
		<Card id="firmware" canvas={props.canvas} ariaLabel="Firmware update" title="Firmware update" tip="M997 · boards">
			{/* Prerequisites/caveats taken from reference/duet-gcode.md M997. */}
			<div class="fw-warn">
				<p><b>Before flashing</b></p>
				<ul>
					<li>The board's <b>IAP</b> binary and the <b>firmware .bin</b> must already be uploaded to <code>0:/firmware/</code>, or M997 can't install.</li>
					<li>Updating the <b>main board resets it and drops this session</b>. This form flashes expansion/tool boards first and the main board last for that reason.</li>
					<li>The M997 reference prescribes no further board order — see the linked <i>Installing and Updating Firmware</i> page for the full procedure.</li>
				</ul>
			</div>

			<Show when={boards().length} fallback={<p class="job-empty">No boards reported.</p>}>
				<table class="fw-table">
					<thead>
						<tr>
							<th aria-label="Select" />
							<th>Board</th>
							<th>CAN</th>
							<th>Current</th>
							<th>New firmware</th>
						</tr>
					</thead>
					<tbody>
						<For each={boards()}>
							{board => {
								const addr = canAddrOf(board);
								return (
									<tr classList={{ "fw-sel": selected().has(addr) }}>
										<td>
											<input
												type="checkbox"
												class="fw-check"
												checked={selected().has(addr)}
												onChange={() => toggle(addr)}
												aria-label={`Select ${board.shortName || board.name}`}
											/>
										</td>
										<td>
											<span class="fw-board">{board.shortName || board.name}</span>
											<Show when={addr === 0}><span class="des">main</span></Show>
										</td>
										<td class="fw-num">{addr}</td>
										<td class="fw-num">{board.firmwareVersion ?? "—"}</td>
										<td class="fw-file">{board.firmwareFileName ?? "—"}</td>
									</tr>
								);
							}}
						</For>
					</tbody>
				</table>

				<div class="btn-row fw-actions">
					<button
						class="btn btn-danger"
						classList={{ armed: armed() }}
						disabled={count() === 0}
						onClick={submit}
					>
						{armed() ? `Confirm — flash ${count()} board${count() === 1 ? "" : "s"}` : "Update firmware"}
					</button>
					<Show when={armed()}>
						<button class="btn" onClick={() => setArmed(false)}>Cancel</button>
					</Show>
				</div>
			</Show>
		</Card>
	);
}
