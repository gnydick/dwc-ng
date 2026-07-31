/**
 * The one <Card> wrapper for a registry card — chrome from the def, body and
 * header actions from the render map. Both ComposedScreen and the Card Lab
 * render through THIS component, so a card's chrome cannot fork between
 * surfaces (the lab's hand-written wrapper copies died with its adoption).
 */
import { Card } from "../shell/Card.tsx";
import { CARD_DEFS, type CardId, type CardText } from "./defs.ts";
import { CARD_RENDER } from "./cards.tsx";
import type { CardCtx } from "./ctx.ts";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

export function RegistryCard(props: { id: CardId; canvas: PanelCanvasController; ctx: CardCtx }) {
	const def = CARD_DEFS[props.id];
	const render = CARD_RENDER[props.id];
	const text = (t: CardText): string => (typeof t === "function" ? t(props.ctx) : t);
	return (
		<Card
			id={props.id}
			canvas={props.canvas}
			ariaLabel={def.ariaLabel}
			title={text(def.title)}
			tip={def.tip !== undefined ? text(def.tip) : undefined}
			class={def.class}
			orientationToggle={def.orientationToggle}
			labelsToggle={def.labelsToggle}
			actions={render.actions?.(props.ctx)}
		>
			{render.body(props.ctx)}
		</Card>
	);
}

export { cardTitleOf } from "./defs.ts";
