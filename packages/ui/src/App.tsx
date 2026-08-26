import { createEffect, onCleanup, onMount } from "solid-js";
import { createOmStore } from "./om/store.ts";
import { createConfigStore } from "./config/store.ts";
import { createMachineSession } from "./config/machineSession.ts";
import { DEFAULT_THERMAL_COLORS } from "./config/types.ts";
import { createTemperatureHistory } from "./om/temperature.ts";
import { createConnector } from "@dwc-ng/connector";
import { writesArmed, type Backend } from "./dev/backend.ts";
import { guardWrites } from "./dev/writeGuard.ts";
import { startPinSender } from "./control/pinSender.ts";
import { AppContext } from "./shell/context.ts";
import Shell from "./shell/Shell.tsx";
import "./app.css";

export default function App(props: { backend: Backend }) {
	const om = createOmStore();
	// Identity resolves about one poll after boot (machineSession.ts): `store()`
	// is null until then, and createConfigStore is required to take that
	// accessor rather than default to "no machine" quietly — see its own doc
	// comment for why an optional/defaulted parameter here was the bug.
	const machine = createMachineSession(om.om);
	const config = createConfigStore({ machineStore: machine.store });
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
