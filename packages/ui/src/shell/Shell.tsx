import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { useApp } from "./context.ts";
import { createRouter, type Route } from "./router.ts";
import {
	BACKENDS, type Backend, rememberBackend,
	currentBackendId, setCurrentBackendId, writesArmed, setWritesArmed,
} from "../dev/backend.ts";
import {
	loadConsoleFloating, saveConsoleFloating,
	loadConsoleGeometry, saveConsoleGeometry,
} from "../om/consoleLog.ts";
import Machine from "../views/Machine.tsx";
import Control from "../views/Control.tsx";
import Jobs from "../views/Jobs.tsx";
import Macros from "../views/Macros.tsx";
import System from "../views/System.tsx";
import Settings from "../views/Settings.tsx";

/**
 * Console floating state. Module-level + localStorage-backed rather than in the
 * config overlay: the overlay needs an explicit Save (and uploads to the SD), so
 * the console would dock itself again on every reload. This sticks immediately.
 */
const [consoleFloating, setConsoleFloatingSignal] = createSignal(loadConsoleFloating());
function setConsoleFloating(floating: boolean): void {
	setConsoleFloatingSignal(floating);
	saveConsoleFloating(floating);
}

const NAV: Array<{ route: Route; label: string }> = [
	{ route: "machine", label: "Machine" },
	{ route: "control", label: "Control" },
	{ route: "jobs", label: "Jobs" },
	{ route: "macros", label: "Macros" },
	{ route: "system", label: "System" },
	{ route: "settings", label: "Settings" },
];

export default function Shell() {
	const app = useApp();
	const route = createRouter();

	const visibleAxes = createMemo(() => app.om.om.move.axes.filter(a => a.visible));
	const unhomedCount = createMemo(() => visibleAxes().filter(a => !a.homed).length);
	const anyHeaterHot = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.current >= 45));
	const anyHeaterFault = createMemo(() =>
		app.om.om.heat.heaters.some(h => h !== null && h.state === "fault"));

	const emergencyStop = (): void => {
		// M112 halts immediately; M999 resets so the board comes back
		void app.connector.sendCode("M112").catch(() => undefined);
		void app.connector.sendCode("M999").catch(() => undefined);
	};

	return (
		<div class="app">
			<aside class="rail">
				<div class="wordmark">dwc<span>·</span>ng</div>
				<nav aria-label="Main">
					<For each={NAV}>
						{item => (
							<a href={`#/${item.route}`} aria-current={route() === item.route ? "page" : undefined}>
								{item.label}
							</a>
						)}
					</For>
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
							title="Keep the camera tile visible on every view"
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

				<Switch>
					<Match when={route() === "machine"}><Machine /></Match>
					<Match when={route() === "control"}><Control /></Match>
					<Match when={route() === "jobs"}><Jobs /></Match>
					<Match when={route() === "macros"}><Macros /></Match>
					<Match when={route() === "system"}><System /></Match>
					<Match when={route() === "settings"}><Settings /></Match>
				</Switch>

				<ConsoleDrawer />
			</div>

			<CameraTile />
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

/**
 * Console. Docks at the bottom by default, or snaps out into a floating tile
 * that survives navigation — Gabe's macros emit M118 messages that are the
 * reason to run them, and a one-line drawer loses them as they stream past.
 * The undocked state persists (config overlay), the log persists (localStorage).
 */
function ConsoleDrawer() {
	const app = useApp();
	const [expanded, setExpanded] = createSignal(false);
	const floating = consoleFloating;

	return (
		<Show when={!floating()} fallback={<ConsoleTile />}>
			<div class="console-drawer" role="region" aria-label="Console">
				<Show when={expanded()}>
					<ConsoleHistory />
				</Show>
				<div class="console-row">
					<Show when={!expanded()}>
						<span class="console-last">
							<Show when={app.om.console.at(-1)} fallback={"Console"}>
								{line => line().text}
							</Show>
						</span>
					</Show>
					<ConsoleForm />
					<button
						class="console-expand"
						title={expanded() ? "Collapse console history" : "Expand console history"}
						aria-expanded={expanded()}
						onClick={() => setExpanded(v => !v)}
					>
						{expanded() ? "▾" : "▴"}
					</button>
					<button
						class="console-expand"
						title="Snap the console out into a floating panel"
						onClick={() => setConsoleFloating(true)}
					>
						⇱
					</button>
				</div>
			</div>
		</Show>
	);
}

/**
 * The snapped-out console: fixed, resizable, above every view, and draggable
 * by its header. Position + size are pixel geometry so they can be dragged
 * anywhere and stick — CSS's default bottom-right corner is only a fallback
 * until the first drag or resize.
 */
function ConsoleTile() {
	const app = useApp();
	let el!: HTMLElement;
	const [geometry, setGeometry] = createSignal(loadConsoleGeometry());

	const startDrag = (event: PointerEvent): void => {
		// Don't hijack clicks on the dock button.
		if (event.target instanceof HTMLElement && event.target.closest("button")) return;
		event.preventDefault();
		const rect = el.getBoundingClientRect();
		const originX = event.clientX;
		const originY = event.clientY;

		const onMove = (moveEvent: PointerEvent): void => {
			const maxLeft = Math.max(0, window.innerWidth - rect.width);
			const maxTop = Math.max(0, window.innerHeight - rect.height);
			setGeometry({
				left: Math.min(Math.max(0, rect.left + (moveEvent.clientX - originX)), maxLeft),
				top: Math.min(Math.max(0, rect.top + (moveEvent.clientY - originY)), maxTop),
				width: rect.width,
				height: rect.height,
			});
		};
		const onUp = (): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			const g = geometry();
			if (g) saveConsoleGeometry(g);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	// The native resize handle (CSS `resize: both`) mutates the element's own
	// inline size directly — watch for that so a manual resize also sticks.
	createEffect(() => {
		const observer = new ResizeObserver(() => {
			const rect = el.getBoundingClientRect();
			const g = geometry();
			setGeometry({ left: g?.left ?? rect.left, top: g?.top ?? rect.top, width: rect.width, height: rect.height });
		});
		observer.observe(el);
		onCleanup(() => observer.disconnect());
	});

	const style = createMemo<Record<string, string> | undefined>(() => {
		const g = geometry();
		if (!g) return undefined;
		return { left: `${g.left}px`, top: `${g.top}px`, right: "auto", bottom: "auto", width: `${g.width}px`, height: `${g.height}px` };
	});

	return (
		<aside class="console-tile" role="region" aria-label="Console" style={style()} ref={el}>
			<div class="console-tile-head" onPointerDown={startDrag}>
				<span class="console-tile-title">Console</span>
				<button
					class="console-expand"
					title="Dock the console back to the bottom"
					onClick={() => setConsoleFloating(false)}
				>
					⇲
				</button>
			</div>
			<ConsoleHistory />
			<ConsoleForm />
		</aside>
	);
}

function ConsoleHistory() {
	const app = useApp();
	let el!: HTMLDivElement;
	// Follow the tail: watching messages arrive is the whole point, and a macro
	// that emits faster than you scroll is useless if it doesn't stick to the end.
	createEffect(() => {
		app.om.console.length; // track
		el.scrollTop = el.scrollHeight;
	});
	return (
		<div class="console-history" ref={el}>
			<Show when={app.om.console.length} fallback={<p class="console-empty">No replies yet.</p>}>
				<For each={app.om.console}>
					{line => (
						<div class="console-line">
							<time>{new Date(line.receivedAt).toLocaleTimeString(undefined, { hour12: false })}</time>
							<span>{line.text}</span>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
}

function ConsoleForm() {
	const app = useApp();
	const [code, setCode] = createSignal("");
	const send = (event: SubmitEvent): void => {
		event.preventDefault();
		const value = code().trim();
		if (value === "") return;
		setCode("");
		void app.connector.sendCode(value).catch(() => undefined);
	};
	return (
		<form class="console-form" onSubmit={send}>
			<input
				type="text"
				placeholder="Send G-code — e.g. M114"
				aria-label="G-code command"
				value={code()}
				onInput={e => setCode(e.currentTarget.value)}
			/>
			<button type="submit">Send</button>
		</form>
	);
}

function CameraTile() {
	const app = useApp();
	return (
		<Show when={app.config.config.camera.pinned}>
			<aside class="cam-tile" aria-label="Camera">
				<div class="cam-head">
					<span class="cam-title">Camera</span>
					<div class="cam-actions">
						<button title="Hide camera" onClick={() => app.config.setCamera({ pinned: false })}>✕</button>
					</div>
				</div>
				<div class="cam-body">
					<Show
						when={app.config.config.camera.streamUrl !== ""}
						fallback={<span>Set a stream URL in <a href="#/settings">Settings</a></span>}
					>
						<img src={app.config.config.camera.streamUrl} alt="Machine camera stream" />
					</Show>
				</div>
			</aside>
		</Show>
	);
}
