/**
 * Totality enforcement for closed unions. Call it after a switch that
 * returns in every case: if a new union member is added and a case is
 * missing, the argument no longer narrows to `never` and the call is a
 * COMPILE error at every site that must handle the new member — the
 * compiler generates the TODO list. (Runtime throw is the backstop for
 * values that bypassed the type system entirely.)
 *
 * @invariant closed-unions-stay-total
 * @rung 7  the SIGNATURE is the mechanism — the parameter is `never`, so a
 *          switch that stops covering its union no longer narrows and the call
 *          fails to compile. Not a convention about writing default arms: the
 *          type does the work, at all seven call sites and any future one
 * @why a silent default arm is how a new union member ships as "nothing
 *      happened". These unions are transports, render modes and control kinds —
 *      adding one and having the old code quietly ignore it means a machine
 *      that never connects, or a control that renders and sends nothing.
 *      The runtime throw is the backstop for values that bypassed the type
 *      system entirely (parsed JSON cast into a union), and is deliberately
 *      loud rather than a silent fallback
 */
export function unreachable(value: never): never {
	throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
