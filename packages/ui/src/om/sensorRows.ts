import type { Axis, Sensors } from "../om/types.ts";

export interface SensorRow {
	/** Stable id for this sensor slot, independent of its label — Settings'
	 *  naming inputs key off this (config.sensorNames[key]). */
	key: string;
	label: string;
	/** true = green/nominal, false = yellow/attention. */
	ok: boolean;
	state: string;
}

export const endstopKey = (i: number): string => `endstop:${i}`;
export const filamentKey = (i: number): string => `filament:${i}`;
export const probeKey = (i: number): string => `probe:${i}`;

const FILAMENT_STATE_LABELS: Record<string, string> = {
	ok: "OK",
	noDataReceived: "No data",
	noFilament: "No filament",
	tooLittleMovement: "Under-extruding",
	tooMuchMovement: "Over-extruding",
	sensorError: "Sensor error",
};

/** ProbeType.none — reference/objectmodel/src/sensors/Probe.ts:4. */
const PROBE_TYPE_NONE = 0;

/**
 * Flattens endstops/filamentMonitors/probes into one status list for the
 * Machine view's Sensors card. Uniform rule (per Gabe): green (ok: true) =
 * idle/nominal, yellow (ok: false) = currently triggered/active/faulted.
 * Entries with nothing actually configured (a null slot, an unwired probe,
 * a filament monitor reporting "noMonitor") are omitted — a row with no
 * real sensor behind it would just be noise.
 *
 * `names` (Settings' per-sensor custom names, keyed by endstopKey/filamentKey/
 * probeKey) replaces the auto-generated label entirely when set for a slot —
 * called with no `names` (or a key missing from it) falls back to the plain
 * auto label, which is also what Settings shows as each input's identifying
 * tag before a custom name is given.
 */
export function sensorRows(sensors: Sensors, axes: Axis[], names: Record<string, string> = {}): SensorRow[] {
	const rows: SensorRow[] = [];

	sensors.endstops.forEach((e, i) => {
		if (e === null) return;
		const key = endstopKey(i);
		const auto = axes[i] ? `${axes[i]!.letter} endstop` : `Endstop ${i}`;
		rows.push({ key, label: names[key] ?? auto, ok: !e.triggered, state: e.triggered ? "Triggered" : "Clear" });
	});

	sensors.filamentMonitors.forEach((f, i) => {
		if (f === null || f.status === "noMonitor") return;
		const key = filamentKey(i);
		rows.push({
			key,
			label: names[key] ?? `Extruder ${i} filament`,
			ok: f.status === "ok",
			state: FILAMENT_STATE_LABELS[f.status] ?? f.status,
		});
	});

	sensors.probes.forEach((p, i) => {
		if (p === null || p.type === PROBE_TYPE_NONE) return;
		const key = probeKey(i);
		const reading = p.value[0] ?? 0;
		const triggered = reading >= p.threshold;
		rows.push({ key, label: names[key] ?? `Probe ${i}`, ok: !triggered, state: triggered ? "Triggered" : String(reading) });
	});

	return rows;
}
