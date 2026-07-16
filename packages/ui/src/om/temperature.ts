/**
 * Temperature history for the live chart. The buffer is a pure ring: it holds
 * a bounded window of per-heater samples and emits uPlot-ready aligned data.
 * It is deliberately independent of Solid and the object model so the
 * accumulation/cap logic can be unit-tested; createTemperatureHistory (below)
 * wires it to the OM store.
 */

import { createSignal, onCleanup } from "solid-js";
import type { OmStore } from "./store.ts";

/** uPlot AlignedData: [xValues, ...oneSeriesPerHeater]. */
export type AlignedData = [number[], ...Array<Array<number | null>>];

export class TemperatureBuffer {
	private xs: number[] = [];
	private series: Array<Array<number | null>> = [];
	private readonly maxPoints: number;

	constructor(maxPoints: number) {
		this.maxPoints = maxPoints;
	}

	get length(): number {
		return this.xs.length;
	}

	/**
	 * Append one time-aligned sample: `temps[i]` is heater i's reading (null if
	 * that heater is absent). If the number of heaters changed since the last
	 * push, older history can't be aligned to the new shape, so it restarts.
	 */
	push(time: number, temps: Array<number | null>): void {
		if (temps.length !== this.series.length) {
			this.xs = [];
			this.series = temps.map(() => []);
		}
		this.xs.push(time);
		for (let i = 0; i < temps.length; i++) {
			this.series[i]!.push(temps[i] ?? null);
		}
		if (this.xs.length > this.maxPoints) {
			this.xs.shift();
			for (const s of this.series) s.shift();
		}
	}

	/** uPlot-ready copy of the current window; safe to hand to setData. */
	snapshot(): AlignedData {
		return [this.xs.slice(), ...this.series.map(s => s.slice())];
	}
}

export interface TemperatureHistory {
	/** Reactive uPlot-ready [xs, ...series]; series index == heater index. */
	data: () => AlignedData;
}

/**
 * Sample the object model's heater temperatures into a TemperatureBuffer on a
 * fixed interval (evenly-spaced x even when temps are flat) while connected.
 * App-level so the window persists across view navigation. Must be created
 * under a reactive owner (App setup) — it registers an onCleanup for the timer.
 */
export function createTemperatureHistory(
	om: OmStore,
	options: { maxPoints?: number; intervalMs?: number; now?: () => number } = {},
): TemperatureHistory {
	const maxPoints = options.maxPoints ?? 600; // ~10 min at 1 Hz
	const intervalMs = options.intervalMs ?? 1000;
	const now = options.now ?? (() => Date.now() / 1000);
	const buffer = new TemperatureBuffer(maxPoints);
	const [data, setData] = createSignal<AlignedData>([[]]);

	const sample = (): void => {
		if (om.connection.status !== "connected") return;
		const heaters = om.om.heat.heaters;
		if (heaters.length === 0) return;
		buffer.push(now(), heaters.map(h => (h ? h.current : null)));
		setData(buffer.snapshot());
	};

	const timer = setInterval(sample, intervalMs);
	onCleanup(() => clearInterval(timer));

	return { data };
}
