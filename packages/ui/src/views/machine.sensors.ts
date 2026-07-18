import type { Axis, Sensors } from "../om/types.ts";

export interface SensorRow {
	label: string;
	/** true = green/nominal, false = yellow/attention. */
	ok: boolean;
	state: string;
}

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
 */
export function sensorRows(sensors: Sensors, axes: Axis[]): SensorRow[] {
	const rows: SensorRow[] = [];

	sensors.endstops.forEach((e, i) => {
		if (e === null) return;
		const label = axes[i] ? `${axes[i]!.letter} endstop` : `Endstop ${i}`;
		rows.push({ label, ok: !e.triggered, state: e.triggered ? "Triggered" : "Clear" });
	});

	sensors.filamentMonitors.forEach((f, i) => {
		if (f === null || f.status === "noMonitor") return;
		rows.push({ label: `Extruder ${i} filament`, ok: f.status === "ok", state: FILAMENT_STATE_LABELS[f.status] ?? f.status });
	});

	sensors.probes.forEach((p, i) => {
		if (p === null || p.type === PROBE_TYPE_NONE) return;
		const reading = p.value[0] ?? 0;
		const triggered = reading >= p.threshold;
		rows.push({ label: `Probe ${i}`, ok: !triggered, state: triggered ? "Triggered" : String(reading) });
	});

	return rows;
}
