/**
 * A user-authored card (phase B2): its spec is JSON text in the config
 * overlay, parsed and compiled through the untrusted boundary HERE — a
 * broken spec costs this card an error body naming the problem, never the
 * screen. The title is the author's name for it; the tip declares its
 * provenance so a shared card can't masquerade as a built-in.
 *
 * Rendered by BOTH ComposedScreen and the Card Lab — one component, so a
 * custom card cannot look different on the two surfaces.
 */
import { Show, createMemo } from "solid-js";
import { useApp } from "../shell/context.ts";
import { Card } from "../shell/Card.tsx";
import { ControlList } from "./controls/ControlList.tsx";
import { parseControlSpecText } from "./controls/parse.ts";
import type { CustomCardId } from "./composition.ts";
import type { CardCtx } from "./ctx.ts";
import type { PanelCanvasController } from "../shell/panelCanvas.ts";

export function CustomCard(props: { id: CustomCardId; canvas: PanelCanvasController; ctx: CardCtx }) {
	const app = useApp();
	const def = createMemo(() => app.config.config.cards[props.id]);
	const parsed = createMemo(() => {
		const d = def();
		return d === undefined ? null : parseControlSpecText(d.spec);
	});
	return (
		<Show when={def()}>
			{d => (
				<Card id={props.id} canvas={props.canvas} ariaLabel={d().name} title={d().name} tip="custom card">
					<Show
						when={(() => { const p = parsed(); return p !== null && p.ok ? p.spec : null; })()}
						fallback={
							<p class="job-empty">
								Card error: {(() => { const p = parsed(); return p !== null && !p.ok ? p.error : ""; })()}
							</p>
						}
						keyed
					>
						{spec => <ControlList spec={spec} ctx={props.ctx} />}
					</Show>
				</Card>
			)}
		</Show>
	);
}
