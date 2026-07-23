import { onCleanup, onMount } from "solid-js";
import { createOmStore } from "./om/store.ts";
import { createConfigStore } from "./config/store.ts";
import { createTemperatureHistory } from "./om/temperature.ts";
import { createConnector } from "./connector/index.ts";
import { initialBackend, isRealBackend, writesArmed } from "./dev/backend.ts";
import { guardWrites } from "./dev/writeGuard.ts";
import { AppContext } from "./shell/context.ts";
import Shell from "./shell/Shell.tsx";
import "./app.css";

export default function App() {
	const om = createOmStore();
	const config = createConfigStore();
	const temps = createTemperatureHistory(om);
	// Boot from the persisted dev backend (Mock by default; "Real" targets the
	// board via the dev proxy). In production this is always the same-origin
	// backend ("", empty password) served by the machine itself. The transport
	// comes from the backend record — createConnector is the only construction
	// site, so which class runs is decided in exactly one place (C1).
	const backend = initialBackend();
	const transport = createConnector(backend, om.events);
	// Dev-only: mutations fail closed while a REAL backend is selected unless
	// writes are armed (see writeGuard.ts). Reads are untouched. In production
	// there is one same-origin backend and this whole branch tree-shakes away.
	const connector = import.meta.env.DEV
		? guardWrites(transport, { isReal: isRealBackend, isArmed: () => writesArmed() })
		: transport;

	onMount(() => {
		void connector.connect()
			.then(() => config.loadFromMachine(connector))
			.catch(() => undefined); // status chip + Connect button cover failures
	});
	onCleanup(() => void connector.disconnect());

	return (
		<AppContext.Provider value={{ om, config, connector, temps }}>
			<Shell />
		</AppContext.Provider>
	);
}
