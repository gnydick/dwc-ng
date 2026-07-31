import type { JSX } from "solid-js";
import { For, Match, Show, Switch, createSignal } from "solid-js";
import {
	AUDIT_HEADINGS, AXIS_COL_TAUTOLOGY, AXIS_PASS_LABEL, CHILD_COUNT_CHANGED,
	judgeAxis, judgeDrift, judgeFloor,
	type AxisProbe, type AxisVerdict, type DriftSample, type FloorVerdict,
} from "./layoutAudit.ts";
import { contentRowSpan, contentColSpan, headerColSpan, rowUnitPx, COL_UNIT_PX } from "../shell/panelCanvas.ts";

export interface CardReport {
	id: string;
	title: string;
	rowStop: number;
	colStop: number;
	headerWall: number;
	floor: FloorVerdict;
	axisRow: AxisVerdict;
	axisCol: AxisVerdict;
	drift: { stable: boolean; moved: string[] };
}

/**
 * One line of a sweep. A card that could not be measured gets a row of its own
 * rather than being skipped: the old loop did `if (el === null) continue`, so a
 * card that failed to mount left NO trace at all — the only clue was the
 * "N audited" count, and the reader has no way to know which N.
 *
 * A diagnostic that silently omits what it could not measure is the same defect
 * as one that prints "ok" over a card it did not check.
 */
export type SweepRow =
	| { kind: "report"; report: CardReport }
	| { kind: "error"; id: string; title: string; reason: string };

/**
 * Probe sizes, in px. Three points across a realistic range: a card as placed,
 * half that, and near its floor. Two would suffice to detect dependence; three
 * makes a monotonic ratchet visible in the reported column rather than just a
 * pass/fail.
 */
const ROW_PROBES = [720, 400, 200];
const COL_PROBES = [1200, 700, 360];

/**
 * Measure with the card FORCED to a size, then put it back.
 *
 * Forcing is the whole point: Invariant A says the answer must not change, so
 * the only way to test it is to change the thing it must not depend on. The
 * card is restored synchronously in a finally, so a throw mid-probe cannot
 * leave the bench card stuck at 200px.
 */
function probeAt<T>(el: HTMLElement, axis: "row" | "col", px: number, read: () => T): T {
	const prop = axis === "row" ? "height" : "width";
	const previous = el.style.getPropertyValue(prop);
	try {
		el.style.setProperty(prop, `${px}px`);
		// Reading a layout property flushes pending style and layout, so the
		// measurement below sees the forced size. No ResizeObserver involved:
		// observers do not fire in automated or background tabs at all.
		void el.getBoundingClientRect();
		return read();
	} finally {
		if (previous === "") el.style.removeProperty(prop);
		else el.style.setProperty(prop, previous);
	}
}

/**
 * The floor the SAME card would report if its body's content were EMPTY —
 * header, inter-child gaps, body padding, card chrome and gutter, and nothing
 * else. Subtract it from the real floor and what is left is exactly the rows
 * the card's content is worth. (See judgeFloor.)
 *
 * Measured by hiding every non-header child and re-running contentRowSpan,
 * NOT by re-deriving the chrome term here. The difference matters: contentRowSpan
 * decides what counts (out-of-flow children skipped, a flex-grow child's
 * DECLARED min-height substituted for its rendered height, gaps, padding, the
 * card's own chrome, the pitch conversion). A second copy of that arithmetic
 * would be correct on the day it was written and wrong the first time the
 * original changed — and it is the original's grow-child substitution that
 * creates the defect being looked for, so a divergent copy would look clean
 * precisely when it mattered. Running the one function twice makes the two
 * numbers comparable by construction.
 *
 * `.card-head` is the header by the same selector headerColSpan uses, so "the
 * header" means one thing in both directions. Restored in a finally, like
 * probeAt: a throw mid-measure must not leave a card's body invisible.
 */
function chromeRowSpan(cardEl: HTMLElement, gutterPx: number): number {
	const body = cardEl.querySelector<HTMLElement>(".panel-body");
	if (!body) return 1;
	const hidden: Array<[HTMLElement, string]> = [];
	try {
		for (const child of Array.from(body.children)) {
			if (!(child instanceof HTMLElement)) continue;
			if (child.classList.contains("card-head")) continue;
			hidden.push([child, child.style.getPropertyValue("display")]);
			child.style.setProperty("display", "none");
		}
		// Same synchronous flush probeAt relies on — reading geometry settles
		// style and layout, so no frame wait and no observer is involved.
		void cardEl.getBoundingClientRect();
		return contentRowSpan(cardEl, gutterPx);
	} finally {
		for (const [child, previous] of hidden) {
			if (previous === "") child.style.removeProperty("display");
			else child.style.setProperty("display", previous);
		}
		void cardEl.getBoundingClientRect();
	}
}

/** Every in-flow descendant of the body, with its offset from the body's box. */
function sampleChildren(cardEl: HTMLElement, axis: "row" | "col"): DriftSample[] {
	const body = cardEl.querySelector<HTMLElement>(".panel-body");
	if (!body) return [];
	const origin = body.getBoundingClientRect();
	return Array.from(body.querySelectorAll<HTMLElement>("*"))
		.filter(el => {
			const s = getComputedStyle(el);
			return s.position !== "absolute" && s.position !== "fixed" && el.getBoundingClientRect().width > 0;
		})
		.map((el, i) => {
			const r = el.getBoundingClientRect();
			// main = the axis being resized; cross = the one that must not move.
			return axis === "col"
				? { id: `${i}:${el.className || el.tagName}`, main: Math.round(r.x - origin.x), cross: Math.round(r.y - origin.y) }
				: { id: `${i}:${el.className || el.tagName}`, main: Math.round(r.y - origin.y), cross: Math.round(r.x - origin.x) };
		});
}

/** Audit ONE mounted card element. The panel drives this per card. */
export function auditCard(id: string, title: string, cardEl: HTMLElement): CardReport {
	const gutterRow = parseFloat(getComputedStyle(cardEl).marginBottom) || 0;
	const gutterCol = parseFloat(getComputedStyle(cardEl).marginRight) || 0;

	const rowProbes: AxisProbe[] = ROW_PROBES.map(px => ({
		size: px,
		reported: probeAt(cardEl, "row", px, () => contentRowSpan(cardEl, gutterRow)),
	}));
	const colProbes: AxisProbe[] = COL_PROBES.map(px => ({
		size: px,
		reported: probeAt(cardEl, "col", px, () => contentColSpan(cardEl, gutterCol)),
	}));

	// Invariant B: resize along the COLUMN axis, assert nothing moved in the
	// row direction. Two widths is enough — a wrap either happens or it does not.
	const wide = probeAt(cardEl, "col", COL_PROBES[0]!, () => sampleChildren(cardEl, "col"));
	const narrow = probeAt(cardEl, "col", COL_PROBES[1]!, () => sampleChildren(cardEl, "col"));

	const rowStop = contentRowSpan(cardEl, gutterRow);

	return {
		id,
		title,
		rowStop,
		colStop: contentColSpan(cardEl, gutterCol),
		headerWall: headerColSpan(cardEl, gutterCol),
		floor: judgeFloor(rowStop, chromeRowSpan(cardEl, gutterRow)),
		axisRow: judgeAxis("row", rowProbes),
		axisCol: judgeAxis("col", colProbes),
		drift: judgeDrift(
			wide.map(s => ({ ...s, main: 0 })),
			narrow.map(s => ({ ...s, main: 0 })),
		),
	};
}

/**
 * The report, rendered in the vocabulary an operator edits in: which card,
 * which axis, which number. "Extruders — row minimum moved 88 -> 180" is
 * actionable; "the line-box strut inflated the cell" is not.
 */
export function LayoutAuditPanel(props: {
	cardEl: () => HTMLElement | null;
	id: () => string;
	title: () => string;
	/** Suppress this panel's own bar — the caller is putting the button in one
	 *  it already has, so the audit controls end up on a single row. */
	hideBar?: boolean;
	/** Receives the run action, so the caller can drive it from that bar. */
	registerRun?: (run: () => void) => void;
}) {
	const [report, setReport] = createSignal<CardReport | null>(null);
	const run = (): void => {
		const el = props.cardEl();
		if (el === null) return;
		setReport(auditCard(props.id(), props.title(), el));
	};
	// Hand the action to the caller so its BUTTON can live in someone else's
	// bar. Two audit bars stacked one above the other read as two features; the
	// lab puts every audit control on one row and keeps only the results here.
	props.registerRun?.(run);

	return (
		<div class="layout-audit">
			<Show when={props.hideBar !== true}>
				<div class="layout-audit-bar">
					<button class="lab-pill" onClick={run}>Run layout audit</button>
					<span class="lab-note">
						row unit {rowUnitPx()}px · col unit {COL_UNIT_PX}px
					</span>
				</div>
			</Show>
			<Show when={report()}>
				{r => (
					<dl class="layout-audit-grid">
						<dt>Row stop</dt>
						<dd>{r().rowStop} rows</dd>
						<dt>Col stop</dt>
						<dd>{r().colStop} cols (header wall {r().headerWall})</dd>
						{/* FIRST, and the only line here that can fail on a real layout
						    defect rather than on an inconsistency in the measurement. */}
						<dt>{AUDIT_HEADINGS.floor}</dt>
						<dd classList={{ bad: !r().floor.bodyCounted }}>
							<Show
								when={r().floor.bodyCounted}
								fallback={<><b>FLOOR IGNORES BODY</b> — {r().rowStop} rows is header + chrome and nothing else, so this card can be dragged over its own contents</>}
							>
								body is worth {r().floor.bodyStop} of {r().rowStop} rows
							</Show>
						</dd>
						<dt>{AUDIT_HEADINGS.axisRow}</dt>
						<dd classList={{ bad: !r().axisRow.stable }}>
							<Show when={r().axisRow.stable} fallback={<>MOVED {r().axisRow.reported.join(" → ")}</>}>
								{AXIS_PASS_LABEL.row}
							</Show>
							{/* judgeAxis reports "stable" for fewer than two probes too — that
							    is "untested", not "passing". Naming the probe count here means
							    an audit that silently ran short can't read the same as one that
							    ran and found nothing wrong. */}
							<span class="lab-note"> · {r().axisRow.reported.length} probe<Show when={r().axisRow.reported.length !== 1}>s</Show></span>
						</dd>
						<dt>{AUDIT_HEADINGS.axisCol}</dt>
						<dd classList={{ bad: !r().axisCol.stable }}>
							<Show when={r().axisCol.stable} fallback={<>MOVED {r().axisCol.reported.join(" → ")}</>}>
								{AXIS_PASS_LABEL.col}
								<span class="lab-note"> · {AXIS_COL_TAUTOLOGY}</span>
							</Show>
							<span class="lab-note"> · {r().axisCol.reported.length} probe<Show when={r().axisCol.reported.length !== 1}>s</Show></span>
						</dd>
						<dt>{AUDIT_HEADINGS.drift}</dt>
						<dd classList={{ bad: !r().drift.stable }}>
							{/* judgeDrift's child-count-changed case is a sentinel string
							    sitting in the same array real child ids live in — rendering it
							    through the same <For> would show it as though it were one.
							    Switch/Match names the three cases so the sentinel gets its own
							    message instead of masquerading as a moved child. */}
							<Switch fallback={<For each={r().drift.moved}>{m => <span>{m} </span>}</For>}>
								<Match when={r().drift.stable}>no child moved</Match>
								<Match when={r().drift.moved.includes(CHILD_COUNT_CHANGED)}>
									child count changed between probes
								</Match>
							</Switch>
						</dd>
					</dl>
				)}
			</Show>
		</div>
	);
}

/**
 * How long the sweep will wait for a newly featured card to be on screen.
 *
 * MICROTASKS FIRST, and usually the only wait needed: Solid renders
 * synchronously on the signal write, so most cards are mounted before the first
 * check even runs. What is NOT synchronous is a card whose body opens a
 * createResource — Filament, the file browsers, the height map. Those suspend
 * the <Suspense> that wraps the whole Card Lab (Shell.tsx), so for a few
 * microtasks the ENTIRE lab is replaced by its fallback and the bench ref
 * points into a detached subtree. Measured 2026-07-30: eight microtasks was
 * enough for every such card in this worktree.
 *
 * NO requestAnimationFrame anywhere. rAF does not fire in a hidden or automated
 * tab — verified in this worktree, `visibilityState: "hidden"`, callback never
 * ran — which is the exact property that got ResizeObserver banned from this
 * code. The old sweep awaited two frames per card and therefore could not
 * produce its own headline artefact; three quarters of the floor table is
 * missing because of it. Timers are throttled in a background tab but they do
 * fire, so the macrotask tail is a slow path, not a dead one.
 */
const SETTLE_MICROTASKS = 8;
const SETTLE_MACROTASKS = 20;

/** The reason recorded when a card never appeared within the settle budget. */
const SETTLE_FAILED = "never mounted — still suspended or detached after the settle budget";

/**
 * Wait until the featured card is MOUNTED, ATTACHED and LAID OUT, then hand it
 * back. Null means it never got there.
 *
 * `isConnected`, not merely non-null, is the load-bearing part. While a card's
 * resource is in flight the bench ref still resolves to a card element — just
 * one detached from the document, whose every rect is zero. The old sweep's
 * `if (el === null) continue` never fired for that case at all: it measured the
 * detached card and recorded a floor of 1 as though it were a fact.
 *
 * Reading geometry flushes style and layout synchronously, so the rect this
 * checks is the same one the measurement will see — there is nothing left to
 * wait for once it is non-zero.
 */
async function settleBench(read: () => HTMLElement | null): Promise<HTMLElement | null> {
	for (let attempt = 0; ; attempt++) {
		const el = read();
		if (el !== null && el.isConnected && el.getBoundingClientRect().height > 0) return el;
		if (attempt >= SETTLE_MICROTASKS + SETTLE_MACROTASKS) return null;
		await (attempt < SETTLE_MICROTASKS
			? Promise.resolve()
			: new Promise(resolve => { setTimeout(resolve, 0); }));
	}
}

/**
 * The floor table. Sweeps every registry card, audits it, and lists the
 * results worst-first.
 *
 * Produced BEFORE any card is converted, deliberately: it is the empirical
 * record of what each card's floors actually are today, so that a mismatch
 * after conversion is attributable to the conversion rather than to a number
 * nobody ever checked.
 *
 * Cards are audited one at a time against the bench element, because the lab
 * mounts exactly one card. The caller features each id, waits for the mount,
 * then audits whatever is on the bench. Whatever was featured before the sweep
 * started is restored afterward — the sweep is a diagnostic pass over the
 * bench, not a way to leave it parked on the last id in the registry.
 */
export function LayoutAuditAll(props: {
	ids: () => readonly string[];
	titleOf: (id: string) => string;
	feature: (id: string) => void;
	current: () => string;
	benchEl: () => HTMLElement | null;
	/**
	 * Whether the RESULTS are shown. The bar — sweep button and counts — always
	 * renders, whatever this says.
	 *
	 * The sweep button used to live inside the collapsed region, so it appeared
	 * and vanished with the table it fills. A control that is only reachable
	 * once you have opened the thing it populates is a control you have to
	 * discover twice.
	 */
	open: () => boolean;
	/** Rendered at the head of the bar, so the lab's show/hide toggle sits
	 *  BESIDE the sweep rather than on a line of its own above it. */
	toggle?: JSX.Element;
}) {
	const [rows, setRows] = createSignal<SweepRow[]>([]);
	const [busy, setBusy] = createSignal(false);

	const sweep = async (): Promise<void> => {
		// Captured before the loop touches anything, so it can be restored
		// whether the sweep finishes cleanly or throws partway through.
		const before = props.current();
		setBusy(true);
		setRows([]);
		try {
			const out: SweepRow[] = [];
			for (const id of props.ids()) {
				const title = props.titleOf(id);
				try {
					props.feature(id);
					const el = await settleBench(props.benchEl);
					if (el === null) {
						out.push({ kind: "error", id, title, reason: SETTLE_FAILED });
						continue;
					}
					out.push({ kind: "report", report: auditCard(id, title, el) });
				} catch (err) {
					// One card that throws must not end the sweep: the remaining forty
					// are still worth measuring, and the throw is itself a finding.
					out.push({ kind: "error", id, title, reason: err instanceof Error ? err.message : String(err) });
				}
			}
			// Worst first: a violation is what the operator came here to find, and
			// a card that could not be measured at all outranks every verdict —
			// an unknown is worse news than a known violation.
			const rank = (row: SweepRow): number => {
				if (row.kind === "error") return 16;
				const r = row.report;
				return (r.floor.bodyCounted ? 0 : 8)
					+ (r.axisRow.stable ? 0 : 4)
					+ (r.axisCol.stable ? 0 : 2)
					+ (r.drift.stable ? 0 : 1);
			};
			setRows([...out].sort((a, b) => rank(b) - rank(a)));
		} finally {
			// Runs on the happy path AND on a throw: the bench goes back to what
			// the user had featured, and the button never sticks on "Auditing…".
			props.feature(before);
			setBusy(false);
		}
	};

	return (
		<div class="layout-audit">
			<div class="layout-audit-bar">
				{props.toggle}
				<button class="lab-pill" disabled={busy()} onClick={() => void sweep()}>
					<Show when={busy()} fallback="Audit every card">Auditing…</Show>
				</button>
				<span class="lab-note">
					{rows().length} rows
					<Show when={rows().filter(r => r.kind === "error").length}>
						{n => <> · <b>{n()} could not be measured</b></>}
					</Show>
					<Show when={rows().filter(r => r.kind === "report" && !r.report.floor.bodyCounted).length}>
						{n => <> · <b>{n()} floors ignore the body</b></>}
					</Show>
				</span>
			</div>
			<Show when={props.open() && rows().length > 0}>
				<table class="layout-audit-table">
					<thead>
						<tr>
							<th scope="col">Card</th>
							<th scope="col">Rows</th>
							<th scope="col">Cols</th>
							<th scope="col">{AUDIT_HEADINGS.floor}</th>
							<th scope="col">{AUDIT_HEADINGS.axisRow}</th>
							<th scope="col">{AUDIT_HEADINGS.axisCol}</th>
							<th scope="col">{AUDIT_HEADINGS.drift}</th>
						</tr>
					</thead>
					<tbody>
						<For each={rows()}>
							{row => (
								<Switch>
									{/* A card the sweep could not measure gets a LINE, not a gap.
									    It spans the verdict columns because there is no verdict to
									    give — printing anything else there would be inventing one. */}
									<Match when={row.kind === "error" ? row : null}>
										{e => (
											<tr class="bad">
												<td>{e().title}</td>
												<td colSpan={6}>FAILED — {e().reason}</td>
											</tr>
										)}
									</Match>
									<Match when={row.kind === "report" ? row.report : null}>
										{r => (
											<tr>
												<td>{r().title}</td>
												<td>{r().rowStop}</td>
												<td>{r().colStop}</td>
												{/* The column that can actually fail on a layout defect. */}
												<td classList={{ bad: !r().floor.bodyCounted }}>
													<Show
														when={r().floor.bodyCounted}
														fallback={<b>IGNORES BODY</b>}
													>
														{r().floor.bodyStop} rows
													</Show>
												</td>
												<td classList={{ bad: !r().axisRow.stable }}>
													<Show when={r().axisRow.stable} fallback={r().axisRow.reported.join("→")}>
														{AXIS_PASS_LABEL.row}
													</Show>
													{/* judgeAxis reports "stable" for fewer than two probes too —
													    that is "untested", not "passing". Naming the probe count
													    keeps a short-circuited audit visibly distinct from one that
													    ran and found nothing wrong. */}
													<Show when={r().axisRow.reported.length < 2}>
														<span class="lab-note"> · {r().axisRow.reported.length} probe</span>
													</Show>
												</td>
												<td classList={{ bad: !r().axisCol.stable }}>
													<Show when={r().axisCol.stable} fallback={r().axisCol.reported.join("→")}>
														{AXIS_PASS_LABEL.col}
													</Show>
													<Show when={r().axisCol.reported.length < 2}>
														<span class="lab-note"> · {r().axisCol.reported.length} probe</span>
													</Show>
												</td>
												<td classList={{ bad: !r().drift.stable }}>
													{/* judgeDrift's child-count-changed case is a sentinel string
													    sitting in the moved array — it must not be shown as if it
													    were a moved child id. */}
													<Switch fallback={<Show when={r().drift.stable} fallback={`${r().drift.moved.length} moved`}>none</Show>}>
														<Match when={r().drift.moved.includes(CHILD_COUNT_CHANGED)}>
															child count changed
														</Match>
													</Switch>
												</td>
											</tr>
										)}
									</Match>
								</Switch>
							)}
						</For>
					</tbody>
				</table>
				{/* THE SCOPE NOTE. Without it a wall of passing verdicts reads as
				    "this layout is sound", which is a claim none of these checks can
				    make — and on 2026-07-30 that wall was printed over four cards
				    that had been broken by hand the same day. Stated in the UI, not
				    only in the spec, because the UI is what an operator reads. */}
				<p class="lab-note layout-audit-scope">
					What these columns establish — and what they do not.
					{" "}<b>{AUDIT_HEADINGS.floor}</b> is the only one that can fail on a layout defect:
					it subtracts the floor the card reports with its body emptied from the floor it
					reports as it stands, so <b>IGNORES BODY</b> means the card's minimum is its header
					and chrome alone and the card can be dragged over its own contents.
					{" "}<b>{AUDIT_HEADINGS.axisRow}</b> and <b>{AUDIT_HEADINGS.axisCol}</b> only say the
					reported minimum did not CHANGE when the card was forced to three sizes — never that
					the number is right; a floor that is uniformly wrong passes both.
					{" "}{AUDIT_HEADINGS.axisCol} is measured with <code>min-content</code>, which
					{" "}{AXIS_COL_TAUTOLOGY.replace(/^by construction — /, "")}, so it is a tautology
					rather than a check and should never be read as evidence.
					{" "}No declared-vs-measured comparison exists yet.
				</p>
			</Show>
		</div>
	);
}
