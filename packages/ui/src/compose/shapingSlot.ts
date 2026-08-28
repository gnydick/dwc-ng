/**
 * The seam between the EAGER service registry and the LAZY Shaping Lab.
 *
 * `compose/services.ts` is on the critical path of every cold load, so it may
 * not name `compose/shapingService.ts` in a way that survives to runtime — that
 * import is what put the whole Lab (23 modules, 21,635 B) on every board load
 * and made `uat` undeployable (#126). But `ctx.service("shaping")` is
 * SYNCHRONOUS, and must stay so: it is called inside card render, the pool is
 * the sole owner of the one-instance-per-screen guarantee, and turning it into
 * a promise would push that guarantee out to eight call sites.
 *
 * So the registry holds a slot instead of an import, and the Lab's loader fills
 * it. `typeof import(...)` is a TYPE position — erased under
 * verbatimModuleSyntax — so the factory is fully typed here with no runtime
 * edge at all.
 *
 * @invariant the-shaping-factory-is-provided-before-it-is-read
 * @rung 6  choke-point. ONE writer — `compose/cards.tsx`'s `loadShapingLab`,
 *          which fills the slot after awaiting the Lab's chunk and BEFORE
 *          returning a component — and ONE reader, `SERVICES.shaping`. Every
 *          route to the reader goes through `ctx.service("shaping")`, and every
 *          call site of that is a Lab body, which Solid cannot render until
 *          that same loader has resolved. The factory it writes comes from
 *          ShapingCards.tsx's value re-export, so a registration that stopped
 *          happening would not compile. Not rung 7: nothing in the type system
 *          stops a NEW call site being added outside the Lab's chunk, which is
 *          why test/lazy-bundle.test.ts also asserts that no module in the
 *          eager import graph calls it synchronously
 * @why the alternative shapes are worse in ways that matter. An async
 *      `service()` moves the ordering problem to every card; a second pool
 *      inside the lazy chunk duplicates the memoization that IS the
 *      one-instance guarantee; and leaving the factory eager is the defect
 *      this exists to fix
 * @debt the slot is module-scoped, so it is one factory for the whole page
 *       rather than one per screen, and the throw below is rung 2 — the
 *       fallback, not the mechanism. Promote by having the loader hand the POOL
 *       a resolved factory instead of writing a module-level slot, which needs
 *       the pool to be constructible from the loader and is a bigger change
 *       than the deploy this is unblocking can carry.
 */
/** The Lab's factory, as the lazy module exports it. Type position only. */
export type ShapingServiceFactory = (typeof import("./shapingService.ts"))["shapingService"];

/** What every Lab card sees. Named here so the eager registry can be typed. */
export type ShapingService = ReturnType<ShapingServiceFactory>;

let provided: ShapingServiceFactory | null = null;

/**
 * Sole writer. Called by `compose/cards.tsx`'s `loadShapingLab`, in the same
 * function that awaits the Lab's chunk — so there is no separate step for a
 * caller to forget and no window in which a body exists but the factory does
 * not.
 */
export function provideShapingService(factory: ShapingServiceFactory): void {
	provided = factory;
}

/**
 * Sole reader, called only by `SERVICES.shaping`.
 *
 * The throw is unreachable through any route the app has: every
 * `ctx.service("shaping")` call site is in the Lab's chunk, which cannot render
 * before `loadShapingLab` has resolved it and written the slot. It is here so that a NEW call
 * site added outside that chunk fails loudly on the spot rather than handing
 * back a half-built service — the failure a silent `undefined` would cause is
 * one somebody debugs on a printer.
 */
export function shapingServiceFactory(): ShapingServiceFactory {
	if (provided === null) {
		throw new Error(
			"the Shaping Lab's chunk has not loaded, so ctx.service(\"shaping\") cannot be built yet. " +
				"Reach it from a body loaded through compose/cards.tsx's lazyShaping, or await that loader first.",
		);
	}
	return provided;
}
