import { For, Match, Show, Suspense, Switch, createMemo, createSignal, lazy } from "solid-js";
import { useApp } from "./context.ts";
import { cmd } from "../control/commands.ts";
import { createRouter, LAB_ROUTE } from "./router.ts";
import { navHidden, setNavHidden } from "./navState.ts";
import {
	BACKENDS, type Backend, rememberBackend,
	currentBackend, writesArmed, setWritesArmed,
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
	const labActive = (): boolean => route() === LAB_ROUTE;

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const unhomedCount = createMemo(() => visibleAxes().filter(a => !a.homed).length);
	const anyHeaterHot = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.current >= 45));
	const anyHeaterFault = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.state === "fault"));

	// A STOP that did not reach the board must say so — a silently failed
	// e-stop is the worst possible no-op. Colour only: fixed geometry.
	const [stopFailed, setStopFailed] = createSignal(false);
	let stopFailedTimer: ReturnType<typeof setTimeout> | undefined;
	const emergencyStop = (): void => {
		// ONE payload, not two calls: as two un-awaited requests they'd race
		// (order not guaranteed) and the reset has to reach a board that just
		// halted. The payload comes from cmd.emergencyStop() — the same
		// definition the write guard lets through and the connector's
		// unqueued path recognizes, so the three cannot drift apart.
		void app.connector.sendCode(cmd.emergencyStop())
			.then(() => setStopFailed(false))
			.catch(() => {
				setStopFailed(true);
				clearTimeout(stopFailedTimer);
				stopFailedTimer = setTimeout(() => setStopFailed(false), 5000);
			});
	};

	return (
		<div class="app" classList={{ "nav-hidden": navHidden() }}>
			{/* Outside the view switch on purpose: a blocking prompt that only
			    renders on the view you happen to be on is the same bug as none. */}
			<MessageBoxPrompt />
			<aside class="rail">
				<div class="wordmark">
					dwc<span>·</span>ng
					<button class="nav-hide" title="Hide navigation" aria-label="Hide navigation" onClick={() => setNavHidden(true)}>‹</button>
				</div>
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
					{/* What is actually serving us, from the connector's own
					    declaration — three transports, three distinct truths. */}
					<Switch fallback="RRF">
						<Match when={app.om.connection.transport === "dsf"}>SBC · DSF native</Match>
						<Match when={app.om.connection.transport === "rr-emulated"}>SBC · DSF (rr_)</Match>
						<Match when={app.om.connection.transport === "rr"}>RRF · standalone</Match>
					</Switch>
				</p>
			</aside>

			<div class="main">
				<header class="preflight" aria-label="Machine preflight">
					{/* Reveal control: only present while the nav is hidden, at the
					    left of the strip where the rail's edge used to be — always
					    visible and discoverable, no floating overlay to hunt for. */}
					<Show when={navHidden()}>
						<button class="nav-reveal" title="Show navigation" aria-label="Show navigation" onClick={() => setNavHidden(false)}>☰</button>
					</Show>
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
						<button
							class="estop"
							classList={{ "estop-failed": stopFailed() }}
							title={stopFailed() ? "STOP DID NOT REACH THE BOARD — network failure" : "Emergency stop — sends M112 + M999"}
							onClick={emergencyStop}
						>
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
	const [busy, setBusy] = createSignal(false);

	/**
	 * Switching backends RELOADS rather than re-pointing the live connector:
	 * backends now differ by transport (rr_ vs DSF), which is a different
	 * connector class, so a half-switched session has no representation
	 * (design D9/C14). The reload also guarantees the arm starts false —
	 * writesArmed is in-memory only by design.
	 */
	const switchTo = (b: Backend): void => {
		if (busy() || b.id === currentBackend().id) return;
		setBusy(true);
		setWritesArmed(false);
		rememberBackend(b.id);
		window.location.reload();
	};

	return (
		<>
			<div class="backend-toggle" role="group" aria-label="Backend" title="Dev: which machine, over which transport">
				<For each={BACKENDS}>
					{b => (
						<button
							class="backend-opt"
							classList={{ active: currentBackend().id === b.id, real: b.real }}
							aria-pressed={currentBackend().id === b.id}
							disabled={busy()}
							onClick={() => switchTo(b)}
						>
							{b.label}
						</button>
					)}
				</For>
			</div>
			<Show when={currentBackend().real}>
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
