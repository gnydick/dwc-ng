import { For, Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { PIN_INTERVAL_MS } from "../control/pinSender.ts";

/**
 * Pinned commands: arbitrary G-code the app re-sends every ~0.5s to override
 * what a running job asks for — e.g. `M204 P6000` to hold a max acceleration
 * against a slicer that keeps changing it.
 *
 * A deliberate, operator-owned exception to the controls-are-1:1 rule: while a
 * row is enabled the app, not the firmware, is the author of that value. Each
 * row is still a plain command, shown verbatim; there is no encoded logic
 * beyond "keep sending this". All enabled rows go out in ONE batched request
 * per tick (pinSender.ts), so the cost is fixed regardless of how many.
 *
 * Fan speed pins are the same mechanism but keyed and managed on the Fans
 * card, so they are filtered out here — this card owns the keyless rows.
 */
export function PinnedCommandsBody() {
	const app = useApp();

	/** Arbitrary rows only — keyed pins (fans) belong to their own card. */
	const rows = createMemo(() => app.config.config.pins.filter(p => p.key === undefined));
	const activeCount = createMemo(() => rows().filter(p => p.enabled && p.command.trim() !== "").length);

	return (
		<div class="pins">
			<div class="pins-head">
				<button class="fb-tool" onClick={() => app.config.addPin("")}>+ Add</button>
				{/* Always present so the count changing can't reflow the rows. */}
				<span class="pins-status" classList={{ live: activeCount() > 0 }}>
					<Show when={activeCount() > 0} fallback="nothing pinned">
						re-sending {activeCount()} every {(PIN_INTERVAL_MS / 1000).toFixed(1)}s
					</Show>
				</span>
			</div>

			<Show when={rows().length > 0} fallback={<p class="job-empty">No pinned commands</p>}>
				<ul class="pin-list">
					<For each={rows()}>
						{pin => (
							<li class="pin-row" classList={{ on: pin.enabled }}>
								{/* Enabling is what starts hitting the machine, so it is the
								    deliberate act — a fresh row lands disabled. */}
								<label class="pin-toggle" title={pin.enabled ? "Pinned — click to release" : "Release — click to pin"}>
									<input
										type="checkbox"
										checked={pin.enabled}
										onChange={e => app.config.updatePin(pin.id, { enabled: e.currentTarget.checked })}
									/>
									<span class="pin-dot" />
								</label>
								<input
									class="pin-cmd"
									type="text"
									spellcheck={false}
									placeholder="G-code, e.g. M204 P6000"
									value={pin.command}
									aria-label="Pinned command"
									onInput={e => app.config.updatePin(pin.id, { command: e.currentTarget.value })}
								/>
								<button class="fb-act danger" title="Remove this pin" onClick={() => app.config.removePin(pin.id)}>✕</button>
							</li>
						)}
					</For>
				</ul>
			</Show>
		</div>
	);
}
