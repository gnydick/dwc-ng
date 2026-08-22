import { For, Match, Show, Suspense, Switch, createMemo, createSignal, lazy, onCleanup, onMount } from "solid-js";
import { useApp } from "./context.ts";
import { cmd } from "../control/commands.ts";
import { createRouter, LAB_ROUTE } from "./router.ts";
import { navHidden, setNavHidden } from "./navState.ts";
import { setRailSlot } from "./railSlot.ts";
import { SCALES, scale, setScale } from "./scale.ts";
import { THEMES, theme, setTheme } from "./theme.ts";
import { BUILD_ID } from "./buildId.ts";
import { installEdgeScroll } from "./edgeScroll.ts";
import {
	BACKENDS, type Backend, rememberBackend,
	writesArmed, setWritesArmed,
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
	// A wheel over the middle of a tall inner scroller (console, editor, file
	// list) scrolls THIS instead of the box, so a big passive readout stops
	// being a hole in the page. Installed once, for every card there will ever
	// be — see edgeScroll.ts.
	let viewScrollEl: HTMLDivElement | undefined;
	onMount(() => onCleanup(installEdgeScroll(() => viewScrollEl ?? null)));
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
					<a href={`#/${LAB_ROUTE}`} aria-current={labActive() ? "page" : undefined}>Card Lab</a>
				</nav>
				{/* The current screen's own controls, portalled in — see railSlot.ts.
				    Always rendered so the mount point exists before any screen looks
				    for it; `:empty` hides it entirely on routes that portal nothing,
				    so a screen without tools costs no gap above the board identity. */}
				<div class="rail-tools" ref={setRailSlot} />
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
					{/* WHICH BUILD you are looking at. The board caches the entry
					    document for an hour, so a tab can quietly keep running an
					    older bundle after a deploy — and then the same code appears
					    to behave differently in two places, which is exactly the
					    hunt this stamp exists to end. Compare it against what the
					    deploy printed before believing any such difference. */}
					<br /><span class="build-id">{BUILD_ID}</span>
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
						<ThemeToggle />
						<ScaleToggle />
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

				{/* The page scroller. Its ref feeds edgeScroll, which is what a
				    wheel over the middle of a big inner scroller drives instead. */}
				<div class="view-scroll" ref={viewScrollEl}>
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

/**
 * How large the UI draws (see shell/scale.ts). A per-device display
 * preference — it changes one custom property on <html> and nothing else, so
 * it sends no code, touches no config overlay, and cannot mark anything
 * unsaved. Card geometry is stored in unit cells, so every card follows the
 * unit and no layout needs re-dragging at any step.
 */
function ScaleToggle() {
	return (
		<div class="scale-toggle" role="group" aria-label="UI scale" title="UI scale — a display preference for this browser">
			<For each={SCALES}>
				{s => (
					<button
						type="button"
						class="scale-opt"
						classList={{ active: scale() === s.id }}
						aria-pressed={scale() === s.id}
						title={`${s.label}%`}
						onClick={() => setScale(s.id)}
					>
						{s.label}
					</button>
				)}
			</For>
		</div>
	);
}

/**
 * Which palette the UI draws in (see shell/theme.ts). Same contract as the
 * scale: one attribute on <html>, a browser preference, never machine config.
 */
function ThemeToggle() {
	return (
		<div class="scale-toggle" role="group" aria-label="UI theme" title="UI theme — a display preference for this browser">
			<For each={THEMES}>
				{t => (
					<button
						type="button"
						class="scale-opt"
						classList={{ active: theme() === t.id }}
						aria-pressed={theme() === t.id}
						title={t.title}
						onClick={() => setTheme(t.id)}
					>
						{t.label}
					</button>
				)}
			</For>
		</div>
	);
}

/** Dev-only Mock/Real backend switcher + write arming (see src/dev/writeGuard.ts). */
function BackendToggle() {
	const app = useApp();
	const [busy, setBusy] = createSignal(false);

	/**
	 * Switching backends RELOADS rather than re-pointing the live connector:
	 * backends now differ by transport (rr_ vs DSF), which is a different
	 * connector class, so a half-switched session has no representation
	 * (design D9/C14). The reload also guarantees the arm starts false —
	 * writesArmed is in-memory only by design.
	 */
	const switchTo = (b: Backend): void => {
		if (busy() || b.id === app.backend.id) return;
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
							classList={{ active: app.backend.id === b.id, real: b.real }}
							aria-pressed={app.backend.id === b.id}
							disabled={busy()}
							onClick={() => switchTo(b)}
						>
							{b.label}
						</button>
					)}
				</For>
			</div>
			<Show when={app.backend.real}>
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
