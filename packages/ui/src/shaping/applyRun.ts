/**
 * What installing a shaper is doing right now.
 *
 * Its own module beside `sweepRun.ts` and for the same layering reason:
 * `shaping/copy.ts` writes this union's sentences with a `never` arm, and a
 * copy table that imported a compose/ module would invert the direction every
 * other shaping type runs in.
 *
 * `how` rides on every arm that has one, because the two acts are not
 * interchangeable and the sentence has to say which happened. "Applied" is not
 * an answer to "will the machine still be shaped after the next toolchange".
 */
import type { ShaperSpec } from "./engine/shapers.ts";

/** Which of the two acts. Sent lasts until a reset; written lasts. */
export type ApplyHow = "send" | "macro";

export type ApplyState =
	| { readonly kind: "idle" }
	| { readonly kind: "working"; readonly how: ApplyHow }
	| { readonly kind: "done"; readonly how: ApplyHow; readonly line: string }
	| { readonly kind: "failed"; readonly why: string };

/** The spec a card is about to install, for the confirm sentence. */
export type ApplyIntent = { readonly how: ApplyHow; readonly tool: number; readonly spec: ShaperSpec };
