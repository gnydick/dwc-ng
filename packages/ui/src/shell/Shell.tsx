import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { useApp } from "./context.ts";
import { createRouter, type Route } from "./router.ts";
import { BACKENDS, type Backend, initialBackend, rememberBackend } from "../dev/backend.ts";
import Machine from "../views/Machine.tsx";
import Control from "../views/Control.tsx";
import Jobs from "../views/Jobs.tsx";
import Macros from "../views/Macros.tsx";
import System from "../views/System.tsx";
import Settings from "../views/Settings.tsx";

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

/** Dev-only Mock/Real backend switcher (see src/dev/backend.ts). */
function BackendToggle() {
	const app = useApp();
	const [current, setCurrent] = createSignal<Backend["id"]>(initialBackend().id);
	const [busy, setBusy] = createSignal(false);

	const switchTo = async (b: Backend): Promise<void> => {
		if (busy() || b.id === current() || app.connector.switchEndpoint === undefined) return;
		setBusy(true);
		setCurrent(b.id);
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
		<div class="backend-toggle" role="group" aria-label="Backend" title="Dev: which board the UI talks to">
			<For each={BACKENDS}>
				{b => (
					<button
						class="backend-opt"
						classList={{ active: current() === b.id }}
						aria-pressed={current() === b.id}
						disabled={busy()}
						onClick={() => void switchTo(b)}
					>
						{b.label}
					</button>
				)}
			</For>
		</div>
	);
}

function ConsoleDrawer() {
	const app = useApp();
	const [code, setCode] = createSignal("");
	const [expanded, setExpanded] = createSignal(false);

	const send = (event: SubmitEvent): void => {
		event.preventDefault();
		const value = code().trim();
		if (value === "") return;
		setCode("");
		void app.connector.sendCode(value).catch(() => undefined);
	};

	return (
		<div class="console-drawer" role="region" aria-label="Console">
			<Show when={expanded()}>
				<div class="console-history">
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
			</Show>
			<div class="console-row">
				<Show when={!expanded()}>
					<span class="console-last">
						<Show when={app.om.console.at(-1)} fallback={"Console"}>
							{line => line().text}
						</Show>
					</span>
				</Show>
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
				<button
					class="console-expand"
					title={expanded() ? "Collapse console history" : "Expand console history"}
					aria-expanded={expanded()}
					onClick={() => setExpanded(v => !v)}
				>
					{expanded() ? "▾" : "▴"}
				</button>
			</div>
		</div>
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
