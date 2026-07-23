/**
 * The one renderer (I8): composition in, screen out. Everything the eight
 * bespoke view files each hand-rolled lives here exactly once —
 *
 *  - the canvas (storage key + defaults derived from the composition's slots,
 *    I4: sizes came from the defs when the slot was placed);
 *  - the isActive predicate, derived from each card's ONE visibleWhen (I3:
 *    the mount gate below uses the same expression, so a hidden card always
 *    releases its cells and a visible one always holds them);
 *  - the layout toolbar;
 *  - the single <Card> wrapper per slot (bodies are content-only, so chrome
 *    cannot be re-declared per view).
 */
import { For, Show } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import { PanelCanvas } from "../shell/PanelCanvas.tsx";
import { createPanelCanvas, type PanelDefault } from "../shell/panelCanvas.ts";
import { CARD_DEFS, parseCardId, type CardId } from "./defs.ts";
import { CARD_RENDER } from "./cards.tsx";
import { slotsOf, type Composition } from "./composition.ts";
import type { CardCtx } from "./ctx.ts";

export function ComposedScreen(props: {
	/** Layout persistence identity (stable — never a display name, I10). */
	storageKey: string;
	composition: Composition;
	class?: string;
}) {
	const app = useApp();
	const connected = (): boolean => app.om.connection.status === "connected";

	// Slot geometry → the canvas's defaults. Hidden-but-placed holds by
	// construction: every slot has a rect whether or not visibleWhen passes.
	const defaults: PanelDefault[] = slotsOf(props.composition).map(([id, slot]) => ({ id, ...slot }));

	// Deferred: bodies/predicates run only after `canvas` exists below.
	const ctxFor = (id: CardId): CardCtx => ({
		...app,
		connected,
		orientation: () => canvas.orientationFor(id),
	});
	const visibleFor = (id: CardId): boolean => {
		const visibleWhen = CARD_DEFS[id].visibleWhen;
		return visibleWhen ? visibleWhen(ctxFor(id)) : true;
	};

	// I3, release half: the collision filter is the same predicate as the
	// mount. An id not in the registry (stale storage) counts as active so it
	// can never silently reserve cells under a typo.
	const canvas = createPanelCanvas(props.storageKey, defaults, rawId => {
		const id = parseCardId(rawId);
		return id === null ? true : visibleFor(id);
	});

	return (
		<>
			<div class="layout-toolbar">
				<button class="layout-reset" onClick={() => canvas.reset()}>↺ Reset layout</button>
			</div>
			<PanelCanvas class={props.class}>
				<For each={slotsOf(props.composition)}>
					{([id]) => {
						const def = CARD_DEFS[id];
						const render = CARD_RENDER[id];
						const ctx = ctxFor(id);
						return (
							// I3, mount half — same predicate the canvas filter uses.
							<Show when={visibleFor(id)}>
								<Card
									id={id}
									canvas={canvas}
									ariaLabel={def.ariaLabel}
									title={def.title}
									tip={def.tip}
									class={def.class}
									orientationToggle={def.orientationToggle}
									actions={render.actions?.(ctx)}
								>
									{render.body(ctx)}
								</Card>
							</Show>
						);
					}}
				</For>
			</PanelCanvas>
		</>
	);
}
