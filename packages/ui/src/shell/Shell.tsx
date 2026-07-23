import { For, Match, Show, Suspense, Switch, createMemo, createSignal, lazy } from "solid-js";
import { useApp } from "./context.ts";
import { createRouter, LAB_ROUTE } from "./router.ts";
import {
	BACKENDS, type Backend, rememberBackend,
	currentBackendId, setCurrentBackendId, writesArmed, setWritesArmed,
} from "../dev/backend.ts";
import { ComposedScreen } from "../compose/ComposedScreen.tsx";
import { resolveScreen, screenList } from "../compose/screens.ts";
import { MessageBoxPrompt } from "../messagebox/MessageBoxPrompt.tsx";

// Dev-only card test harness. lazy() keeps it in its own chunk that a
// production build never fetches (the route and nav entry below are DEV-gated).
const CardLab = lazy(() => import("../dev/CardLab.tsx"));

export default function Shell() {
	const app = useApp();
	const route = createRouter();
	// Nav, router, and renderer all read the ONE screen list (I9). An unknown
	// (or just-hidden/deleted) route falls back to the first listed screen.
	const screens = createMemo(() => screenList(app.config.config));
	const currentScreenId = createMemo(() => resolveScreen(app.config.config, route())?.id ?? screens()[0]!.id);
	const labActive = (): boolean => import.meta.env.DEV && route() === LAB_ROUTE;

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const unhomedCount = createMemo(() => visibleAxes().filter(a => !a.homed).length);
	const anyHeaterHot = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.current >= 45));
	const anyHeaterFault = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.state === "fault"));

	const emergencyStop = (): void => {
		// M112 halts immediately; M999 resets so the board comes back. ONE payload,
		// not two calls: as two un-awaited requests they race (order not guaranteed)
		// and the reset has to reach a board that just halted. Matches DWC —
		// reference/dwc/src/components/buttons/EmergencyBtn.vue:2 sends 'M112\nM999'.
		void app.connector.sendCode("M112\nM999").catch(() => undefined);
	};

	return (
		<div class="app">
			{/* Outside the view switch on purpose: a blocking prompt that only
			    renders on the view you happen to be on is the same bug as none. */}
			<MessageBoxPrompt />
			<aside class="rail">
				<div class="wordmark">dwc<span>·</span>ng</div>
				<nav aria-label="Main">
					<For each={screens()}>
						{entry => (
							<a href={`#/${entry.id}`} aria-current={!labActive() && currentScreenId() === entry.id ? "page" : undefined}>
								{entry.def.name}
							</a>
						)}
					</For>
					<Show when={import.meta.env.DEV}>
						<a href={`#/${LAB_ROUTE}`} aria-current={labActive() ? "page" : undefined}>Card Lab</a>
					</Show>
				</nav>
				<p class="machine-id">
					<Show when={app.om.om.boards[0]}>
						{board => <>{board().name}<br /></>}
					</Show>
					<Switch fallback="RRF">
						<Match when={app.om.connection.emulated === true}>SBC · DSF</Match>
						<Match when={app.om.connection.emulated === false}>RRF · standalone</Match>
					</Switch>
				</p>
			</aside>

			<div class="main">
				<header class="preflight" aria-label="Machine preflight">
					<Switch>
						<Match when={app.om.connection.status === "connected"}>
							<span class="chip" classList={{
								"chip-ok": app.om.om.state.status === "idle",
								"chip-busy": app.om.om.state.status === "processing" || app.om.om.state.status === "busy",
								"chip-warn": app.om.om.state.status === "paused",
								"chip-fault": app.om.om.state.status === "halted",
							}}>
								<span class="dot" />{app.om.om.state.status}
							</span>
						</Match>
						<Match when={app.om.connection.status === "connecting" || app.om.connection.status === "reconnecting"}>
							<span class="chip chip-warn"><span class="dot" />{app.om.connection.status}…</span>
						</Match>
						<Match when={true}>
							<span class="chip chip-fault"><span class="dot" />disconnected</span>
						</Match>
					</Switch>

					<Show when={anyHeaterFault()}>
						<span class="chip chip-fault">heater fault</span>
					</Show>
					<Show when={unhomedCount() > 0}>
						<span class="chip chip-warn">
							unhomed · {unhomedCount() === visibleAxes().length ? "all axes" : `${unhomedCount()} axes`}
						</span>
					</Show>
					<Show when={anyHeaterHot()}>
						<span class="chip chip-hot">hot</span>
					</Show>
					<Show when={app.om.om.state.currentTool >= 0}>
						<span class="chip chip-quiet">T{app.om.om.state.currentTool}</span>
					</Show>

					<div class="preflight-actions">
						<Show when={import.meta.env.DEV}><BackendToggle /></Show>
						<button
							class="ghost-btn"
							aria-pressed={app.config.config.camera.pinned}
							title="Show the camera panel (each view places it independently)"
							onClick={() => app.config.setCamera({ pinned: !app.config.config.camera.pinned })}
						>
							Camera
						</button>
						<Show when={app.om.connection.status === "disconnected"}>
							<button class="ghost-btn" onClick={() => void app.connector.connect().catch(() => undefined)}>
								Connect
							</button>
						</Show>
						<button class="estop" title="Emergency stop — sends M112 + M999" onClick={emergencyStop}>
							STOP<small>M112</small>
						</button>
					</div>
				</header>

				<div class="view-scroll">
					<Switch>
						<Match when={labActive()}>
							<Suspense fallback={<p class="job-empty">Loading Card Lab…</p>}><CardLab /></Suspense>
						</Match>
						<Match when={true}>
							{/* Keyed on the STABLE id (never the entry object): switching
							    screens remounts ComposedScreen — canvas re-reads storage,
							    services die — but a config edit (rename, membership) on the
							    SAME screen updates in place without a remount. */}
							<Show when={currentScreenId()} keyed>
								{id => <ComposedScreen screenId={id} />}
							</Show>
						</Match>
					</Switch>
				</div>
			</div>
		</div>
	);
}

/** Dev-only Mock/Real backend switcher + write arming (see src/dev/writeGuard.ts). */
function BackendToggle() {
	const app = useApp();
	const [busy, setBusy] = createSignal(false);

	const switchTo = async (b: Backend): Promise<void> => {
		if (busy() || b.id === currentBackendId() || app.connector.switchEndpoint === undefined) return;
		setBusy(true);
		setCurrentBackendId(b.id);
		setWritesArmed(false); // an arm never survives a backend switch
		rememberBackend(b.id);
		try {
			await app.connector.switchEndpoint(b.baseUrl, b.password);
			await app.config.loadFromMachine(app.connector);
		} catch {
			// Failure shows in the connection chip (e.g. bad password / offline).
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<div class="backend-toggle" role="group" aria-label="Backend" title="Dev: which board the UI talks to">
				<For each={BACKENDS}>
					{b => (
						<button
							class="backend-opt"
							classList={{ active: currentBackendId() === b.id, real: b.id === "real" }}
							aria-pressed={currentBackendId() === b.id}
							disabled={busy()}
							onClick={() => void switchTo(b)}
						>
							{b.label}
						</button>
					)}
				</For>
			</div>
			<Show when={currentBackendId() === "real"}>
				<button
					class="arm-btn"
					classList={{ armed: writesArmed() }}
					aria-pressed={writesArmed()}
					title={
						writesArmed()
							? "Writes to the REAL board are ARMED — G-code and uploads will reach the machine. Click to disarm."
							: "Writes to the REAL board are blocked. Reads still work. Click to arm deliberately."
					}
					onClick={() => setWritesArmed(v => !v)}
				>
					{writesArmed() ? "⚠ Writes armed" : "Writes locked"}
				</button>
			</Show>
		</>
	);
}
