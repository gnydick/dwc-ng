import { createEffect, onCleanup, onMount } from "solid-js";
import { createOmStore } from "./om/store.ts";
import { createConfigStore } from "./config/store.ts";
import { createTemperatureHistory } from "./om/temperature.ts";
import { createConnector } from "./connector/index.ts";
import { writesArmed, type Backend } from "./dev/backend.ts";
import { guardWrites } from "./dev/writeGuard.ts";
import { startPinSender } from "./control/pinSender.ts";
import { AppContext } from "./shell/context.ts";
import Shell from "./shell/Shell.tsx";
import "./app.css";

export default function App(props: { backend: Backend }) {
	const om = createOmStore();
	const config = createConfigStore();
	const temps = createTemperatureHistory(om);
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
	// properties rather than any rule. One write per change, no component
	// needs to know a colour is configurable, and dropping the overlay
	// restores index.css's own values because the effect re-runs with
	// DEFAULT_THERMAL_COLORS.
	createEffect(() => {
		const { cold, warm, hot } = config.config.thermalColors;
		const root = document.documentElement.style;
		root.setProperty("--t-cold", cold);
		root.setProperty("--t-warm", warm);
		root.setProperty("--t-hot", hot);
	});

	onMount(() => {
		void connector.connect()
			.then(() => config.loadFromMachine(connector))
			.catch(() => undefined); // status chip + Connect button cover failures
	});
	onCleanup(() => void connector.disconnect());

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
		<AppContext.Provider value={{ om, config, connector, temps, backend: props.backend }}>
			<Shell />
		</AppContext.Provider>
	);
}
