import { createBaseModel, POLLED_KEYS, AMBIENT, type Om } from "./snapshot.ts";
import { VirtualSD } from "./files.ts";
import { executeGCode } from "./gcode.ts";
import type { Scenario, ScenarioEvent } from "./scenarios/types.ts";

/**
 * Simulated machine: object model + seqs counters + a virtual clock.
 *
 * seqs semantics (mirrors RRF): analog values (temperatures, positions, job
 * progress) change every tick WITHOUT bumping a counter — they travel in the
 * live (`f` flag) projection. Only discrete events bump the owning subtree's
 * counter: heater faults, job start/end, tool config, file changes (via
 * volChanges), resets. The reply counter bumps once per completed G-code.
 */
export class Machine {
	om: Om;
	sd = new VirtualSD();
	seqs: Record<string, number> = {};
	volSeqs: number[];
	/** Pristine model restored on reset (base or loaded capture). */
	private readonly pristine: Om;
	replySeq = 0;
	/** Simulated ms since power-up. */
	now = 0;
	/** While now < outageUntil the server drops connections (network loss). */
	outageUntil = 0;
	scenario: Scenario | null = null;

	/** G90/G91 axis positioning mode (false = absolute). Modal — persists
	 * across codes, exactly like RRF. A jog relies on this being honoured. */
	axesRelative = false;
	/** M82/M83 extruder positioning mode (false = absolute). */
	extruderRelative = false;
	/** M120/M121 saved-state stack (mode is the part we simulate). */
	private modeStack: Array<{ axesRelative: boolean; extruderRelative: boolean }> = [];

	pushMode(): void {
		this.modeStack.push({ axesRelative: this.axesRelative, extruderRelative: this.extruderRelative });
	}
	popMode(): void {
		const saved = this.modeStack.pop();
		if (saved !== undefined) {
			this.axesRelative = saved.axesRelative;
			this.extruderRelative = saved.extruderRelative;
		}
	}

	/** Server hooks. */
	onReply: ((text: string) => void) | null = null;
	onReset: (() => void) | null = null;
	onOutage: (() => void) | null = null;

	private pendingEvents: ScenarioEvent[] = [];
	private rngState = 0x2f6e2b1;
	private bootTime = Date.parse("2026-07-12T12:00:00");
	private messageBoxSeq = 0;

	constructor(scenario?: Scenario, baseModel?: Om) {
		this.pristine = baseModel ?? createBaseModel();
		this.om = structuredClone(this.pristine);
		this.volSeqs = (this.om.volumes as Om[]).map(() => 0);
		for (const key of POLLED_KEYS) this.seqs[key] = 1;
		if (scenario !== undefined) {
			this.scenario = scenario;
			this.pendingEvents = [...(scenario.events ?? [])].sort((a, b) => a.at - b.at);
			scenario.init?.(this);
		}
	}

	bump(key: string): void {
		this.seqs[key] = (this.seqs[key] ?? 0) + 1;
	}

	/** Monotonic across the machine's life: a stale M292 must never match a
	 *  later box, so seqs are never reused even after a box is dismissed. */
	nextMessageBoxSeq(): number {
		return this.messageBoxSeq++;
	}

	bumpVolume(index = 0): void {
		this.volSeqs[index] = (this.volSeqs[index] ?? 0) + 1;
	}

	/** Emit a G-code reply / console message: bumps the reply seq. */
	emitReply(text: string): void {
		this.replySeq++;
		this.onReply?.(text);
	}

	/** Execute a G/M/T-code and emit its reply. */
	execute(code: string): void {
		const reply = executeGCode(this, code);
		this.emitReply(reply);
	}

	get outageActive(): boolean {
		return this.now < this.outageUntil;
	}

	requestOutage(durationMs: number): void {
		this.outageUntil = this.now + durationMs;
		this.onOutage?.();
	}

	/** Simulate a firmware reset (M999): uptime restarts, sessions die. */
	reset(): void {
		const sd = this.sd; // SD card contents survive a reboot
		this.om = structuredClone(this.pristine);
		this.sd = sd;
		this.now = 0;
		this.axesRelative = false;
		this.extruderRelative = false;
		this.modeStack = [];
		for (const key of POLLED_KEYS) this.bump(key);
		this.onReset?.();
	}

	/** Small deterministic noise so charts look alive but tests stay stable. */
	private noise(): number {
		this.rngState = (this.rngState * 48271) % 0x7fffffff;
		return (this.rngState / 0x7fffffff - 0.5) * 0.1;
	}

	/** Advance simulated time, integrating temperatures, job progress, clock. */
	advance(ms: number): void {
		this.now += ms;
		const state = this.om.state;
		state.upTime = Math.floor(this.now / 1000);
		state.msUpTime = this.now % 1000;
		state.time = new Date(this.bootTime + this.now).toISOString().slice(0, 19);

		this.advanceHeaters(ms);
		this.advanceFans();
		this.advanceJob(ms);

		// Fire due scenario events (once each)
		while (this.pendingEvents.length > 0 && this.pendingEvents[0]!.at <= this.now) {
			this.pendingEvents.shift()!.run(this);
		}
	}

	private advanceHeaters(ms: number): void {
		const heaters: Om[] = this.om.heat.heaters;
		heaters.forEach((heater, index) => {
			if (heater === null) return;
			const isBed = this.om.heat.bedHeaters.includes(index);
			let target = AMBIENT;
			if (heater.state === "active") target = heater.active;
			else if (heater.state === "standby") target = heater.standby;
			// A faulted heater is powered off: it can only cool
			if (heater.state === "fault") target = AMBIENT;
			// A heater can't cool below ambient (e.g. captured beds sit at
			// state "active" with target 0 — they idle at ambient, not 0°C)
			target = Math.max(target, AMBIENT);
			const heating = target > heater.current;
			const tau = isBed ? (heating ? 60 : 180) : heating ? 20 : 45;
			const k = 1 - Math.exp(-ms / 1000 / tau);
			heater.current += (target - heater.current) * k + this.noise();
			heater.avgPwm = heater.state === "active" || heater.state === "standby"
				? Math.max(0, Math.min(1, (target - AMBIENT) > 0 ? (heating ? 1 : 0.25) : 0))
				: 0;
			const sensor = this.om.sensors.analog[heater.sensor];
			if (sensor) sensor.lastReading = Math.round(heater.current * 10) / 10;
		});
	}

	private advanceFans(): void {
		for (const fan of this.om.fans as Om[]) {
			if (fan === null) continue;
			// Thermostatic fans follow their sensor; others follow the request
			if (fan.thermostatic.sensors.length > 0) {
				const low = fan.thermostatic.lowTemperature ?? 45;
				const hot = (fan.thermostatic.sensors as number[]).some(
					s => (this.om.sensors.analog[s]?.lastReading ?? 0) >= low,
				);
				fan.actualValue = hot ? 1 : 0;
			} else {
				fan.actualValue = fan.requestedValue;
			}
		}
	}

	private advanceJob(ms: number): void {
		const job = this.om.job;
		if (this.om.state.status !== "processing" || job.file === null) return;

		const rate = job.file.size / job.file.printTime; // bytes per second
		job.filePosition = Math.min(job.file.size, (job.filePosition ?? 0) + (rate * ms) / 1000);
		job.duration = (job.duration ?? 0) + ms / 1000;
		const fraction = job.file.size > 0 ? job.filePosition / job.file.size : 0;
		job.layer = Math.max(1, Math.min(job.file.numLayers, Math.ceil(fraction * job.file.numLayers)));
		job.layerTime = (job.layerTime ?? 0) + ms / 1000;

		// Extruded length lags the byte position slightly (flow eases in), so the
		// filament- and file-based estimates diverge the way a real board's do
		// instead of tracking each other exactly.
		const flowFraction = Math.pow(fraction, 1.12);
		job.rawExtrusion = (job.file.filament[0] ?? 0) * flowFraction;

		// Three genuinely independent estimates, mirroring RRF: file from byte
		// position, filament from extruded length, slicer as a fixed budget
		// counting down by wall-clock. They agree at the end, disagree in between.
		job.timesLeft.file = Math.max(0, Math.round(job.file.printTime * (1 - fraction)));
		job.timesLeft.filament = Math.max(0, Math.round(job.file.printTime * (1 - flowFraction)));
		job.timesLeft.slicer = Math.max(0, Math.round(job.file.printTime - job.duration));

		// Nozzle wanders across the bed; Z tracks the layer
		const extruder = this.om.move.extruders[0];
		extruder.rawPosition = job.rawExtrusion;
		extruder.position = job.rawExtrusion;
		const [x, y, z] = this.om.move.axes;
		const t = this.now / 1000;
		x.userPosition = x.machinePosition = Math.round((110 + 80 * Math.sin(t / 3)) * 1000) / 1000;
		y.userPosition = y.machinePosition = Math.round((95 + 70 * Math.cos(t / 4)) * 1000) / 1000;
		z.userPosition = z.machinePosition = Math.round(job.layer * job.file.layerHeight * 1000) / 1000;

		if (job.filePosition >= job.file.size) this.finishJob(false);
	}

	startJob(path: string): boolean {
		const info = this.sd.fileInfo.get(path);
		if (info === undefined) return false;
		const job = this.om.job;
		job.file = structuredClone(info);
		job.filePosition = 0;
		job.duration = 0;
		job.layer = 0;
		job.layerTime = 0;
		job.warmUpDuration = 0;
		job.layers = [];
		job.rawExtrusion = 0;
		this.om.state.status = "processing";
		// A print heats up and homes: reflect that
		this.om.heat.heaters[0].active = 60;
		this.om.heat.heaters[0].state = "active";
		this.om.heat.heaters[1].active = 210;
		this.om.heat.heaters[1].state = "active";
		this.om.state.currentTool = 0;
		this.om.tools[0].state = "active";
		this.om.fans[0].requestedValue = 0.8;
		for (const axis of this.om.move.axes) axis.homed = true;
		this.bump("job");
		this.bump("state");
		this.bump("heat");
		this.bump("tools");
		return true;
	}

	pauseJob(): void {
		if (this.om.state.status !== "processing") return;
		this.om.state.status = "paused";
		this.bump("state");
	}

	resumeJob(): void {
		if (this.om.state.status !== "paused") return;
		this.om.state.status = "processing";
		this.bump("state");
	}

	finishJob(cancelled: boolean): void {
		const job = this.om.job;
		if (job.file === null) return;
		const name: string = job.file.fileName;
		job.lastFileName = name;
		job.lastFileCancelled = cancelled;
		job.lastFileAborted = false;
		job.lastFileSimulated = false;
		job.lastDuration = Math.round(job.duration ?? 0);
		job.file = null;
		job.filePosition = null;
		job.duration = null;
		job.layer = null;
		job.layerTime = null;
		job.timesLeft = { filament: null, file: null, slicer: null };
		this.om.state.status = "idle";
		this.om.heat.heaters[0].active = 0;
		this.om.heat.heaters[0].state = "off";
		this.om.heat.heaters[1].active = 0;
		this.om.heat.heaters[1].state = "off";
		this.om.fans[0].requestedValue = 0;
		this.bump("job");
		this.bump("state");
		if (!cancelled) {
			this.emitReply(`Finished printing file ${name}, print time was ${formatDuration(job.lastDuration)}`);
		}
	}

	/** Put a heater into the fault state (heater fault event). */
	faultHeater(index: number): void {
		const heater = this.om.heat.heaters[index];
		if (!heater) return;
		heater.state = "fault";
		this.bump("heat");
		if (this.om.state.status === "processing") this.pauseJob();
		this.emitReply(
			`Error: Heater ${index} fault: temperature rising much more slowly than the expected 1.8°C/sec`,
		);
	}
}

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `${h}h ${m}m ${s}s`;
}
