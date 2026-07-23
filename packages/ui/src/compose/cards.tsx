/**
 * Card bodies — the JSX half of the registry.
 *
 * `Record<CardId, …>` welds this to ./defs.ts in both directions: a def
 * without a body here, or a body for an unknown id, is a compile error.
 * Bodies are CONTENT-ONLY — ComposedView supplies the single <Card> wrapper
 * from the def's metadata, so panel ids and chrome cannot be re-declared (or
 * misdeclared) per body.
 */
import type { JSX } from "solid-js";
import { BuildObjects } from "../cards/BuildObjects.tsx";
import type { CardId } from "./defs.ts";
import type { CardCtx } from "./ctx.ts";

export const CARD_BODIES: Record<CardId, (ctx: CardCtx) => JSX.Element> = {
	"build-objects": () => <BuildObjects />,
};
