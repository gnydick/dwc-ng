import { onCleanup, onMount } from "solid-js";
import { createOmStore } from "./om/store.ts";
import { createConfigStore } from "./config/store.ts";
import { PollConnector } from "./connector/index.ts";
import { AppContext } from "./shell/context.ts";
import Shell from "./shell/Shell.tsx";
import "./app.css";

export default function App() {
	const om = createOmStore();
	const config = createConfigStore();
	// Password is empty for the mock and for a passwordless board. To develop
	// against a real board that has one, set VITE_DWC_PASSWORD (e.g. reprap).
	// A proper standalone login prompt is a later milestone.
	const connector = new PollConnector({
		baseUrl: "",
		password: import.meta.env.VITE_DWC_PASSWORD ?? "",
		events: om.events,
	});

	onMount(() => {
		void connector.connect()
			.then(() => config.loadFromMachine(connector))
			.catch(() => undefined); // status chip + Connect button cover failures
	});
	onCleanup(() => void connector.disconnect());

	return (
		<AppContext.Provider value={{ om, config, connector }}>
			<Shell />
		</AppContext.Provider>
	);
}
