/**
 * The import review (phase B3): everything a shared file can do, on screen,
 * BEFORE anything lands in the config. Because the vocabulary is closed the
 * inventory is complete — every G-code template, every input, every OM read,
 * every enumeration — so accepting an import means having seen every command
 * it can ever emit. Nothing is written until the operator clicks Import.
 */
import { For, Show } from "solid-js";
import type { ShareImport, SpecReview } from "./share.ts";

function ReviewBlock(props: { review: SpecReview }) {
	return (
		<div class="import-review">
			<Show when={props.review.buttons.length > 0}>
				<div class="import-sect">
					<span class="lab-cap">Sends</span>
					<For each={props.review.buttons}>
						{b => (
							<div class="import-code">
								<span class="import-label">{b.label}</span>
								<code>{b.template}</code>
							</div>
						)}
					</For>
				</div>
			</Show>
			<Show when={props.review.motion.length > 0}>
				<div class="import-sect">
					<span class="lab-cap">Motion</span>
					<For each={props.review.motion}>{m => <div class="import-code"><code>{m}</code></div>}</For>
				</div>
			</Show>
			<Show when={props.review.omReads.length > 0}>
				<div class="import-sect">
					<span class="lab-cap">Reads</span>
					<For each={props.review.omReads}>{r => <div class="import-code"><code>{r}</code></div>}</For>
				</div>
			</Show>
			<Show when={props.review.loops.length > 0}>
				<div class="import-sect">
					<span class="lab-cap">Repeats per</span>
					<For each={props.review.loops}>{l => <div class="import-code"><code>{l}</code></div>}</For>
				</div>
			</Show>
			<Show when={props.review.inputs.length > 0}>
				<div class="import-sect">
					<span class="lab-cap">Inputs</span>
					<div class="import-code"><code>{props.review.inputs.join(", ")}</code></div>
				</div>
			</Show>
		</div>
	);
}

export function ImportReview(props: {
	parsed: ShareImport;
	onImport: () => void;
	onClose: () => void;
}) {
	return (
		<div class="studio-backdrop" onClick={e => { if (e.target === e.currentTarget) props.onClose(); }}>
			<div class="studio import-dialog" role="dialog" aria-label="Import review">
				<Show
					when={props.parsed.kind !== "error" ? props.parsed : null}
					fallback={
						<>
							<p class="fb-msg show">{props.parsed.kind === "error" ? props.parsed.error : ""}</p>
							<div class="compose-row"><button class="fb-act" onClick={props.onClose}>Close</button></div>
						</>
					}
				>
					{ok => (
						<>
							<div class="studio-head">
								<span class="import-title">
									Import {ok().kind === "card" ? "card" : "screen"}: <b>{(ok() as { name: string }).name}</b>
								</span>
							</div>
							<p class="hint">
								This is everything the file can do — review the commands before
								they become controls. Imported items get fresh ids and land as
								unsaved config (Save to machine to keep them).
							</p>
							<Show when={ok().kind === "card" ? ok() as Extract<ShareImport, { kind: "card" }> : null}>
								{card => <ReviewBlock review={card().review} />}
							</Show>
							<Show when={ok().kind === "screen" ? ok() as Extract<ShareImport, { kind: "screen" }> : null}>
								{screen => (
									<>
										<Show when={screen().registryCards.length > 0}>
											<div class="import-sect">
												<span class="lab-cap">Built-in cards</span>
												<div class="import-code"><code>{screen().registryCards.join(" · ")}</code></div>
											</div>
										</Show>
										<For each={screen().customCards}>
											{card => (
												<div class="import-embedded">
													<span class="import-title">{card.name}</span>
													<ReviewBlock review={card.review} />
												</div>
											)}
										</For>
										<Show when={screen().dangling.length > 0}>
											<p class="hint">Ignored unknown slots: {screen().dangling.join(", ")}</p>
										</Show>
									</>
								)}
							</Show>
							<div class="compose-row">
								<button class="fb-act ok" onClick={props.onImport}>Import</button>
								<button class="fb-act" onClick={props.onClose}>Cancel</button>
							</div>
						</>
					)}
				</Show>
			</div>
		</div>
	);
}
