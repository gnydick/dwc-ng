import { For, Show, createMemo, createSignal } from "solid-js";
import { useApp } from "../shell/context.ts";
import { cmd } from "../control/commands.ts";
import type { BuildObject } from "../om/types.ts";

/**
 * The objects in the running job (M486), with per-object cancel.
 *
 * Cancelling is addressed by INDEX, not by "the current object": the one the
 * operator picked is not necessarily the one printing by the time the command
 * lands. Un-cancelling is the same button in reverse — RRF keeps printing the
 * rest of the plate either way, which is the whole point of M486.
 *
 * Two-step like every other machine action here: the first click arms, the
 * second fires. Abandoning a part mid-print is not something to do on one
 * click, and un-cancelling is armed too — resuming an object whose earlier
 * layers were skipped prints it onto nothing.
 */
export function BuildObjects() {
	const app = useApp();
	const [armed, setArmed] = createSignal<number | null>(null);

	const objects = createMemo(() => app.om.om.job.build?.objects ?? []);
	const currentObject = createMemo(() => app.om.om.job.build?.currentObject ?? -1);

	const label = (object: BuildObject, index: number): string =>
		object.name !== null && object.name !== "" ? object.name : `Object ${index}`;

	const act = (index: number, object: BuildObject): void => {
		if (armed() !== index) {
			setArmed(index);
			return;
		}
		setArmed(null);
		const code = object.cancelled ? cmd.resumeObject(index) : cmd.cancelObject(index);
		void app.connector.sendCode(code).catch(() => undefined);
	};

	return (
		<Show
			when={objects().length > 0}
			fallback={
				<p class="job-empty">
					No object information. The slicer must emit M486 markers for the job.
				</p>
			}
		>
			<ul class="obj-list">
				<For each={objects()}>
					{(object, index) => (
						<Show when={object}>
							{obj => (
								<li
									class="obj-row"
									classList={{
										cancelled: obj().cancelled,
										current: currentObject() === index(),
									}}
								>
									{/* Fixed-width marker: it appears and disappears as printing
									    moves between objects and must not shift the name. */}
									<span class="obj-mark" aria-hidden="true">
										{currentObject() === index() ? "▶" : ""}
									</span>
									<span class="obj-name">{label(obj(), index())}</span>
									<Show when={obj().cancelled}>
										<span class="obj-state">cancelled</span>
									</Show>
									<button
										class="fb-act"
										classList={{
											danger: !obj().cancelled,
											armed: armed() === index(),
										}}
										title={obj().cancelled ? cmd.resumeObject(index()) : cmd.cancelObject(index())}
										onClick={() => act(index(), obj())}
									>
										{armed() === index() ? "Confirm" : obj().cancelled ? "Resume" : "Cancel"}
									</button>
								</li>
							)}
						</Show>
					)}
				</For>
			</ul>
		</Show>
	);
}
