import type { Fan } from "./types.ts";

/**
 * Thermostatic fans are driven by the firmware from a sensor trigger — not
 * something to hand-set from the UI. One definition, used by BOTH the fans
 * card's visibleWhen (compose/defs.ts) and its body, so "manual fan" cannot
 * mean two different things.
 */
export function isManualFan(fan: Fan | null): fan is Fan {
	return fan !== null && fan.thermostatic.sensors.length === 0;
}
