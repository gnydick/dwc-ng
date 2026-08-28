/**
 * @invariant tool-change-disarms (compose/services.ts, beside `setTool`)
 *
 * Gabe, invoking cant-break-by-design: "it shouldn't be possible to mismatch
 * tool identification in the same active code." Round 1/2 of GIT_90 removed
 * the DUPLICATE tool values from Sweep's and Decay's arm payloads and proved
 * (by tracing every `save()`) that the remaining comparison never fires a
 * write for the wrong tool — but the comparison was still there to trace,
 * which is rung 2, not rung 6: the mismatch was representable and merely
 * detected.
 *
 * This test exercises the actual fix through the REAL choke point — the
 * exported `shapingService` factory and its `setTool`, not a reimplementation
 * of either — so a future edit that quietly stops calling `disarmAll()` inside
 * `setTool` fails HERE, not just in a manual re-read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "solid-js";
// The real factory, imported where it now lives (#126): the registry entry
// `SERVICES.shaping` reads a slot the Lab's chunk fills at load time, and a
// test that never loads that chunk has nothing to read. Constructing the
// factory directly is the same object the registry hands a card.
import { shapingService } from "../src/compose/shapingService.ts";
import { createArmed } from "../src/control/armed.ts";
import { stubShapingBase } from "./helpers/shaping.ts";

test("svc.setTool disarms a control armed via createArmed, through the real service", () => {
	createRoot(dispose => {
		const svc = shapingService(stubShapingBase());
		// A card's own arm, minted the only way one can be (test/armed.test.ts
		// already enforces that createArmed is the sole route) — this is NOT
		// the shared tool signal, it is a SEPARATE control that happens to be
		// armed while the tool changes, exactly like Decay's or Sweep's save bar.
		const [armed, setArmed] = createArmed<true>();
		setArmed(true);
		assert.equal(armed(), true, "the fixture itself must arm before the assertion means anything");

		svc.setTool(svc.tool() + 1);

		assert.equal(armed(), null, "svc.setTool must disarm every armed control, not just move the shared tool");
		dispose();
	});
});

test("svc.setTool disarms EVERY armed control, not just the first one registered", () => {
	// The mechanism is a Set, not a single slot — Escape's own guarantee is
	// "every armed control", and this is the same loop (control/armed.ts
	// disarmAll). One control passing is not evidence the loop is a loop.
	createRoot(dispose => {
		const svc = shapingService(stubShapingBase());
		const [a, setA] = createArmed<true>();
		const [b, setB] = createArmed<true>();
		const [c, setC] = createArmed<true>();
		setA(true);
		setB(true);
		setC(true);

		svc.setTool(svc.tool() + 1);

		assert.deepEqual([a(), b(), c()], [null, null, null]);
		dispose();
	});
});

test("a tool switch to the SAME tool still disarms — the guarantee is unconditional, not a change check", () => {
	// Ruling 5's whole point is that there is no second value left to compare
	// against — so setTool must not skip the disarm because `next === tool()`.
	// A conditional disarm is the same rung as the comparison this replaces.
	createRoot(dispose => {
		const svc = shapingService(stubShapingBase());
		const [armed, setArmed] = createArmed<true>();
		setArmed(true);
		const same = svc.tool();

		svc.setTool(same);

		assert.equal(armed(), null, "setTool must disarm even when the tool argument does not change the value");
		dispose();
	});
});
