// Branded physical units for the shaping engine.
//
// @invariant shaping-units-are-types
// @rung 7  sole-constructor type — each unit has exactly one minting function
//          here; a bare number is not assignable to Hz/Seconds/G/..., so a
//          frequency cannot be passed where a duration is expected, and the
//          mint refuses non-finite values so NaN never enters a fit
// @why the decay fit, the shaper model and the G-code builders all mix
//      seconds, hertz, g and mm; the 2026-08-22 prototype mixed them freely in
//      Python and relied on the author remembering which was which

type Brand<U extends string> = number & { readonly __unit: U };

export type Hz = Brand<"Hz">;
export type Seconds = Brand<"s">;
export type G = Brand<"g">;
export type MmPerS = Brand<"mm/s">;
export type MmPerS2 = Brand<"mm/s2">;
export type Mm = Brand<"mm">;

function mint<U extends string>(n: number, unit: U): Brand<U> {
	if (!Number.isFinite(n)) throw new RangeError(`${unit}: value is not finite (${String(n)})`);
	return n as Brand<U>;
}

export const hz = (n: number): Hz => mint(n, "Hz");
export const seconds = (n: number): Seconds => mint(n, "s");
export const g = (n: number): G => mint(n, "g");
export const mmPerS = (n: number): MmPerS => mint(n, "mm/s");
export const mmPerS2 = (n: number): MmPerS2 => mint(n, "mm/s2");
export const mm = (n: number): Mm => mint(n, "mm");
