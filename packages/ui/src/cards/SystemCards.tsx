/**
 * The System card that answers "which machine is this?" — the one place an
 * operator can SEE the identity every machine-scoped byte in the app is now
 * keyed by (docs/superpowers/specs/2026-08-24-machine-profile-design.md §3).
 * Everything upstream of this card (Tasks 1-10) is invisible plumbing; a
 * wrong identity is only discoverable, not just theoretically preventable,
 * because this card says what it resolved to.
 *
 * Text is produced by ./machineIdentityText.ts, kept apart from this JSX so
 * it stays node-testable under type stripping (see compose/cards.tsx's own
 * header comment for why a file with real JSX in it cannot be).
 */
import { Show } from "solid-js";
import { useApp } from "../shell/context.ts";
import { describeMachineId, isIdentified } from "../config/machineId.ts";
import {
	claimedProfileText, droppedSectionsText, identityKey, identitySourceNote, type ClaimedProfile,
} from "./machineIdentityText.ts";

/**
 * `claimed`/`onAdopt`/`onClear` are NOT wired to a live store: `ConfigStore`
 * has no `meta.claimedProfile` until Task 9 lands ("claimed, not adopted" on
 * the SD load path — docs/superpowers/sdd/2026-08-25-machine-identity-phase-1/
 * plan, Task 9). This body always receives `undefined` from the registry
 * today, so the row never renders — the correct state while there is
 * genuinely nothing claimed to report. The prop shape already matches what
 * Task 9's brief commits to (`{ writtenFor: string | null; sections: string[]
 * } | null`, `adoptClaimedProfile()`/`clearClaimedProfile()`), so wiring it
 * in is a one-line change at the CARD_RENDER call site below, not a
 * redesign.
 */
export function MachineIdentityBody(props: {
	claimed?: ClaimedProfile | null;
	onAdopt?: () => void;
	onClear?: () => void;
}) {
	const app = useApp();
	const id = () => app.machineId();
	return (
		<>
			<p class="field-label">{describeMachineId(id())}</p>
			<Show when={isIdentified(id())}>
				<p class="hint">Storage key: {identityKey(id())}</p>
			</Show>
			<Show when={identitySourceNote(id())}>
				{note => <p class="hint">{note()}</p>}
			</Show>
			<Show when={claimedProfileText(props.claimed ?? null)}>
				{text => (
					<p class="hint unsaved">
						{text()}{" "}
						<button class="link-btn" onClick={() => props.onAdopt?.()}>Adopt</button>{" "}
						<button class="link-btn" onClick={() => props.onClear?.()}>Clear</button>
					</p>
				)}
			</Show>
			<Show when={droppedSectionsText(app.config.droppedMachineSections)}>
				{text => <p class="hint unsaved">{text()}</p>}
			</Show>
		</>
	);
}
