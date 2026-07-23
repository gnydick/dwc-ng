/**
 * Totality enforcement for closed unions. Call it after a switch that
 * returns in every case: if a new union member is added and a case is
 * missing, the argument no longer narrows to `never` and the call is a
 * COMPILE error at every site that must handle the new member — the
 * compiler generates the TODO list. (Runtime throw is the backstop for
 * values that bypassed the type system entirely.)
 */
export function unreachable(value: never): never {
	throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
