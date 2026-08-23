/**
 * What building a speed sweep is doing right now.
 *
 * Its own module, and not beside `BatchState` in compose/services.ts, for a
 * layering reason: `shaping/copy.ts` writes this union's sentences with a
 * `never` arm, and a copy table that imported a compose/ module would invert
 * the direction every other shaping type runs in (`Refusal` from
 * preconditions.ts, `StepStatus` from steps.ts). The state lives with the
 * feature; the service owns the SIGNAL and the card owns the buttons.
 *
 * Separate from `BatchState` rather than a sixth arm of it, because the two
 * runs answer different questions and can be in flight together: fitting a
 * batch produces a FINGERPRINT — a frequency and a damping ratio a shaper is
 * tuned from — and a sweep produces a PICTURE of which peaks follow speed.
 * Sharing one state would let a sweep's progress overwrite a fingerprint's
 * summary on the card the operator is reading it from.
 */
export type SweepState =
	| { readonly kind: "idle" }
	| { readonly kind: "loading"; readonly done: number; readonly total: number; readonly file: string }
	/** Downloads finished, the worker is transforming. One FFT per row, so this
	 *  is where a nine-capture sweep spends its time. */
	| { readonly kind: "computing"; readonly total: number }
	| {
		readonly kind: "built";
		readonly tool: number;
		readonly family: string;
		/** Rows in the matrix, and how many of them the transform could use. A
		 *  capture whose record holds too little constant-velocity motion yields
		 *  nothing, and a sweep that quietly drew it as silence would read as
		 *  "the machine is quiet at 10 mm/s" (engine/sweep.ts `analysedRows`). */
		readonly rows: number;
		readonly analysed: number;
	}
	| { readonly kind: "saving"; readonly tool: number }
	| { readonly kind: "saved"; readonly tool: number }
	| { readonly kind: "failed"; readonly why: string };
