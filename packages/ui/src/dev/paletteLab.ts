/**
 * Palette lab (dev-only): repaint the running UI from a floating switcher, so
 * a palette can be judged against real machine data instead of a static comp.
 *
 * Reached ONLY by the dynamic import in main.tsx, which is wrapped in
 * `if (import.meta.env.DEV)`. Vite substitutes that to `false` for a board
 * build and Rollup drops the branch, taking this module and its stylesheet
 * with it — so nothing here is in the bundle the printer serves.
 *
 * The mechanism is two attributes on <html>, copied from shell/scale.ts
 * because that module already solved this exact problem for spacing:
 *
 *   data-ground  which chrome tokens the UI is painted with
 *   data-keys    how the heater mode keys spend colour
 *
 * The DEFAULT of each axis is the ABSENCE of its attribute, never a block that
 * restates today's values. index.css stays the single place the shipped palette
 * is written down, so the "Anodize" and "Quiet" buttons here cannot drift from
 * what main renders, and deleting this feature leaves the UI byte-identical.
 *
 * Because ids are parsed tolerantly, promoting a ground migrates itself: a
 * stored "anodize" stopped being a known id the moment anodize became the
 * default, so it falls through to "" — which IS anodize. No migration step.
 *
 * Deliberately NOT wired into the config overlay. That uploads to the SD card
 * and drives the dirty / "Save to machine" cycle, and an experiment is not
 * machine configuration. localStorage, same as scale, navState and
 * speedFlowMode.
 */
import "./paletteLab.css";

interface Option {
	/** The attribute value. Empty string means: remove the attribute. */
	id: string;
	label: string;
	title: string;
}

/**
 * DECLARED, not derived from the stylesheet. paletteLab.css is the authority
 * on what each ground *is*; this list is the authority on which ones exist. An
 * id listed here with no CSS block renders as the baseline — it cannot render
 * as something broken.
 */
const GROUNDS: Option[] = [
	{ id: "", label: "Anodize", title: "What ships today — neutral graphite, accent clear of the warm arc" },
	{ id: "navy", label: "Navy", title: "The previous ground — solder mask & silkscreen" },
	{ id: "green", label: "Green", title: "The other real mask colour; copper accent kept" },
	{ id: "instrument", label: "Instr", title: "No chromatic accent at all — interactive is white at weight" },
	{ id: "vellum", label: "Vellum", title: "Light. Chrome only: the chart palette is not solved for a light ground" },
];

const KEYSETS: Option[] = [
	{ id: "", label: "Quiet", title: "What ships today — rest is neutral; armed is a thicker line" },
	{ id: "hued", label: "Hued", title: "The previous treatment — every key wears its own hue at all times" },
];

const GROUND_KEY = "dwc-ng.lab-ground";
const KEYS_KEY = "dwc-ng.lab-keys";
const MIN_KEY = "dwc-ng.lab-min";

/** Tolerant parse: an id we don't ship yields the default, never a throw. */
function parse(options: Option[], raw: string | null): string {
	return options.some(o => o.id === raw) ? raw! : "";
}

function load(options: Option[], key: string): string {
	if (typeof localStorage === "undefined") return "";
	try {
		return parse(options, localStorage.getItem(key));
	} catch {
		return "";
	}
}

/**
 * A query parameter beats the stored choice, and is then stored itself.
 *
 * `?ground=navy&keys=hued` — so a variant can be sent to someone,
 * bookmarked, or opened on the shop tablet without driving the panel by hand
 * on a touchscreen. Parsed through the same tolerant `parse`, so a typo lands
 * on the default rather than an attribute nothing styles.
 *
 * Read from the search string, NOT the hash: the app's own router owns the
 * hash (shell/router.ts), and putting lab state there would fight it.
 */
function fromQuery(options: Option[], param: string, stored: string): string {
	if (typeof location === "undefined") return stored;
	const raw = new URLSearchParams(location.search).get(param);
	return raw === null ? stored : parse(options, raw);
}

let ground = fromQuery(GROUNDS, "ground", load(GROUNDS, GROUND_KEY));
let keys = fromQuery(KEYSETS, "keys", load(KEYSETS, KEYS_KEY));

/**
 * Write the attribute AND the stored value from one place, so a caller cannot
 * set the preference without the document following it.
 *
 * The default REMOVES the attribute rather than setting it to a default value.
 * That is what keeps "no override" and "the shipped palette" the same state
 * instead of two states that have to be kept equal.
 */
function apply(attr: string, value: string): void {
	if (typeof document === "undefined") return;
	if (value === "") document.documentElement.removeAttribute(attr);
	else document.documentElement.setAttribute(attr, value);
}

function store(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Private mode / quota: the choice just won't survive a reload.
	}
}

export function setGround(id: string): void {
	ground = parse(GROUNDS, id);
	apply("data-ground", ground);
	store(GROUND_KEY, ground);
	sync();
}

export function setKeys(id: string): void {
	keys = parse(KEYSETS, id);
	apply("data-keys", keys);
	store(KEYS_KEY, keys);
	sync();
}

/** Every button in the panel, so pressed-state can be refreshed in one pass. */
const buttons: Array<{ el: HTMLButtonElement; axis: "ground" | "keys"; id: string }> = [];

function sync(): void {
	for (const b of buttons) {
		const on = (b.axis === "ground" ? ground : keys) === b.id;
		b.el.setAttribute("aria-pressed", String(on));
	}
}

/**
 * Plain DOM, not a Solid component, and appended to <body> rather than routed.
 *
 * Two reasons. It has to be reachable from every screen including the Card Lab,
 * so it cannot live inside a view; and keeping it out of the component tree
 * means the experiment touches exactly one line of app code (the guarded import
 * in main.tsx) and can be removed by deleting two files.
 */
function mountPanel(): void {
	if (typeof document === "undefined") return;
	if (document.querySelector(".plab") !== null) return;

	const panel = document.createElement("div");
	panel.className = "plab";
	panel.setAttribute("role", "group");
	panel.setAttribute("aria-label", "Palette lab");

	const row = (label: string, options: Option[], axis: "ground" | "keys"): HTMLDivElement => {
		const wrap = document.createElement("div");
		wrap.className = "plab-row";
		const tag = document.createElement("span");
		tag.className = "plab-lab";
		tag.textContent = label;
		wrap.append(tag);
		for (const o of options) {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = o.label;
			b.title = o.title;
			b.addEventListener("click", () => (axis === "ground" ? setGround(o.id) : setKeys(o.id)));
			buttons.push({ el: b, axis, id: o.id });
			wrap.append(b);
		}
		return wrap;
	};

	panel.append(row("Ground", GROUNDS, "ground"));
	panel.append(row("Keys", KEYSETS, "keys"));

	// Collapse, because this sits on top of the UI it is meant to let you look
	// at. Minimised state persists: a panel you have to re-hide on every reload
	// is one you end up deleting instead.
	const foot = document.createElement("div");
	foot.className = "plab-foot";
	const tag = document.createElement("span");
	tag.textContent = "palette lab · dev";
	const hide = document.createElement("button");
	hide.type = "button";
	hide.textContent = "Hide";
	hide.title = "Collapse to a corner tab";
	foot.append(tag, hide);
	panel.append(foot);

	const open = document.createElement("button");
	open.type = "button";
	open.className = "plab-open";
	open.textContent = "Palette";
	open.title = "Reopen the palette lab";
	panel.append(open);

	const setMin = (min: boolean): void => {
		panel.classList.toggle("is-min", min);
		store(MIN_KEY, min ? "1" : "");
	};
	hide.addEventListener("click", () => setMin(true));
	open.addEventListener("click", () => setMin(false));

	document.body.append(panel);
	let stored = "";
	try {
		stored = localStorage.getItem(MIN_KEY) ?? "";
	} catch {
		stored = "";
	}
	panel.classList.toggle("is-min", stored === "1");
	sync();
}

/**
 * Apply the stored choices, then mount the switcher.
 *
 * main.tsx awaits this BEFORE render for the same reason it calls
 * applyStoredScale() there: these attributes drive CSS custom properties, so
 * applying them after first paint shows one frame of the shipped palette and
 * then repaints the whole page.
 */
export function startPaletteLab(): void {
	apply("data-ground", ground);
	apply("data-keys", keys);
	// Persist whatever a query parameter chose, so the choice survives the next
	// load without the parameter. Harmless when it came from storage already.
	store(GROUND_KEY, ground);
	store(KEYS_KEY, keys);
	mountPanel();
}
