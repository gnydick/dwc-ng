import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createOmStore } from "./om/store.ts";
import { loadConsole } from "./om/consoleLog.ts";
import { createConfigStore } from "./config/store.ts";
import { createMachineSession } from "./config/machineSession.ts";
import { DEFAULT_THERMAL_COLORS } from "./config/types.ts";
import { createTemperatureHistory } from "./om/temperature.ts";
import { createConnector, releaseSessionWhileHidden } from "@dwc-ng/connector";
import { writesArmed, type Backend } from "./dev/backend.ts";
import { guardWrites } from "./dev/writeGuard.ts";
import { startPinSender } from "./control/pinSender.ts";
import { AppContext } from "./shell/context.ts";
import Shell from "./shell/Shell.tsx";
import "./app.css";

export default function App(props: { backend: Backend }) {
	// `machine` is read (via machineStore()) eagerly at persistSoon's SCHEDULE
	// time, and later only through the value it captured then (scheduledFor) —
	// never synchronously during createOmStore's own construction, and never
	// again by name once captured. See om/store.ts's own doc comments (Ruling
	// 23) for why eager-not-lazy. Either way, `machine` is only ever read from
	// code that runs after a connector event fires (a reply arriving), which
	// cannot happen before this function's synchronous body — including the
	// assignment below — has finished running. That ordering is what makes
	// this declare-then-assign safe.
	let machine!: ReturnType<typeof createMachineSession>;
	const om = createOmStore({ machineStore: () => machine.store() });
	// Identity resolves about one poll after boot (machineSession.ts): `store()`
	// is null until then, and createConfigStore is required to take that
	// accessor rather than default to "no machine" quietly — see its own doc
	// comment for why an optional/defaulted parameter here was the bug.
	machine = createMachineSession(om.om);
	const config = createConfigStore({ machineStore: machine.store });
	const temps = createTemperatureHistory(om);

	// The console's own boot-time load (om/store.ts used to do this eagerly,
	// unconditionally, from an origin-global key). It now waits for identity —
	// and re-fires on a machine SWAP, which folds that (different) machine's
	// own saved history in too rather than leaving the previous machine's
	// bytes on screen forever. hydrateConsole never discards what's already
	// live, marks a swap with a boundary line (Ruling 22), and (Ruling 23)
	// flushes and rebinds ongoing persistence to `store` itself -- passed
	// whole, not just its id, since that is what future writes bind to.
	createEffect(() => {
		const store = machine.store();
		if (store === null) return;
		om.hydrateConsole(loadConsole(store), store);
	});
	// Boot from the persisted dev backend (Mock by default; "Real" targets the
	// board via the dev proxy). In production this is always the same-origin
	// backend ("", empty password) served by the machine itself. The transport
	// comes from the backend record — createConnector is the only construction
	// site, so which class runs is decided in exactly one place (C1).
	//
	// This reads the SAME currentBackend() the write guard reads (isRealBackend
	// below), not a second initialBackend() call: the guard's central question
	// — is this the real board? — must have ONE source of truth, or a boot that
	// built the connector from one derivation and guarded it by another could
	// disagree (skill §2.8; and the 2026-07-16 real-hardware incident is why
	// this is the wrong place for a duplicated derivation).
	const transport = createConnector(props.backend, om.events);
	// Dev-only: mutations fail closed while a REAL backend is selected unless
	// writes are armed (see writeGuard.ts). Reads are untouched. In production
	// there is one same-origin backend and this whole branch tree-shakes away.
	const connector = import.meta.env.DEV
		? guardWrites(transport, { isReal: () => props.backend.real, isArmed: () => writesArmed() })
		: transport;

	// The thermal ramp is spent by ~30 CSS rules (.t-cold/.t-warm/.t-hot and
	// everything keyed off them), so the overlay drives the three custom
	// properties rather than any rule. One write per change, and no component
	// needs to know a colour is configurable.
	//
	// A channel still at its shipped value is REMOVED rather than written, so
	// the stylesheet supplies it. An inline style beats every rule, so writing
	// all three unconditionally made index.css's declarations dead: a ground
	// that wanted its own ramp — the light one in the dev palette lab, where the
	// dark-ground amber measures 2.0:1 on a white card — could declare it and
	// silently lose. The default now lives in exactly one place, which is the
	// same rule data-scale and data-ground already follow: the default is the
	// ABSENCE of an override, never a copy of it.
	//
	// Compared against DEFAULT_THERMAL_COLORS rather than against the overlay,
	// which is module-private to the config store. The one case the two disagree
	// is an operator who explicitly picks a colour identical to the shipped one:
	// that reads as "not overridden" and they get the ground's ramp. On the
	// shipped ground those are the same colour, so it is invisible there.
	createEffect(() => {
		const colors = config.config.thermalColors;
		const root = document.documentElement.style;
		for (const channel of ["cold", "warm", "hot"] as const) {
			const property = `--t-${channel}`;
			const value = colors[channel];
			if (value === DEFAULT_THERMAL_COLORS[channel]) root.removeProperty(property);
			else root.setProperty(property, value);
		}
	});

	// GIT_86 Critical 2: a consumer that binds to real machine-scoped storage
	// (the canvas, ComposedScreen.tsx) the instant identity resolves — rather
	// than once this settles — can construct against a config store whose
	// machine half is still `{}`, seed itself from that emptiness, and
	// persist the coded defaults before `loadFromMachine` below ever gets to
	// fill it in. `configLoaded` names the FULL pre-load window (identity
	// unresolved OR resolved-but-still-downloading) as one boolean, so such a
	// consumer can gate on "has the first load attempt settled" directly
	// instead of approximating it from identity alone. `.finally`, not
	// `.then`/`.catch` separately: it must flip on EVERY outcome — a real
	// file, no file at all (FileNotFoundError, caught inside loadFromMachine
	// itself), a claim, or a connect/download failure (caught by the
	// `.catch` below, which already covers that case for the status chip).
	const [configLoaded, setConfigLoaded] = createSignal(false);
	onMount(() => {
		void connector.connect()
			.then(() => config.loadFromMachine(connector))
			.catch(() => undefined) // status chip + Connect button cover failures
			.finally(() => setConfigLoaded(true));
	});
	onCleanup(() => void connector.disconnect());
	// GIT_110: hand the board's session back while the page is not on screen.
	// A closed tab, a refresh, or a phone switched away from used to keep a
	// slot until the board idled it out, and the board has four of them or
	// fewer. Which events fire, and why `beforeunload` is not among them, is
	// argued in connector/src/pageSession.ts; the resume is part of the same
	// handler, so returning to the tab does not leave the operator staring at
	// a Connect button.
	onCleanup(releaseSessionWhileHidden(connector));

	// The pinned-command re-assert loop. Reads config.config.pins fresh each
	// tick and sends through the guarded connector, so it respects the dev
	// write guard exactly like every other control.
	const stopPins = startPinSender({
		pins: () => config.config.pins,
		canSend: () => om.connection.status === "connected",
		sendCode: code => connector.sendCode(code),
	});
	onCleanup(stopPins);

	return (
		<AppContext.Provider value={{ om, config, connector, temps, backend: props.backend, machineId: machine.id, configLoaded }}>
			<Shell />
		</AppContext.Provider>
	);
}
