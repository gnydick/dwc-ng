import { For, Match, Show, Switch, createSignal } from "solid-js";
import {
	judgeAxis, judgeDrift, type AxisProbe, type AxisVerdict, type DriftSample,
} from "./layoutAudit.ts";
import { contentRowSpan, contentColSpan, headerColSpan, rowUnitPx, COL_UNIT_PX } from "../shell/panelCanvas.ts";

export interface CardReport {
	id: string;
	title: string;
	rowStop: number;
	colStop: number;
	headerWall: number;
	axisRow: AxisVerdict;
	axisCol: AxisVerdict;
	drift: { stable: boolean; moved: string[] };
}

/**
 * Probe sizes, in px. Three points across a realistic range: a card as placed,
 * half that, and near its floor. Two would suffice to detect dependence; three
 * makes a monotonic ratchet visible in the reported column rather than just a
 * pass/fail.
 */
const ROW_PROBES = [720, 400, 200];
const COL_PROBES = [1200, 700, 360];

/**
 * The exact sentinel judgeDrift (layoutAudit.ts) returns in `moved` when the
 * child count itself differs between probes — a structural violation, not a
 * moved child id. CardReport carries no separate flag for this case, so it can
 * only be told apart from a real id by value; must stay byte-for-byte equal to
 * the literal judgeDrift returns.
 */
const CHILD_COUNT_CHANGED = "<child count changed>";

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

	return {
		id,
		title,
		rowStop: contentRowSpan(cardEl, gutterRow),
		colStop: contentColSpan(cardEl, gutterCol),
		headerWall: headerColSpan(cardEl, gutterCol),
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
export function LayoutAuditPanel(props: { cardEl: () => HTMLElement | null; id: () => string; title: () => string }) {
	const [report, setReport] = createSignal<CardReport | null>(null);
	const run = (): void => {
		const el = props.cardEl();
		if (el === null) return;
		setReport(auditCard(props.id(), props.title(), el));
	};
	return (
		<div class="layout-audit">
			<div class="layout-audit-bar">
				<button class="lab-pill" onClick={run}>Run layout audit</button>
				<span class="lab-note">
					row unit {rowUnitPx()}px · col unit {COL_UNIT_PX}px
				</span>
			</div>
			<Show when={report()}>
				{r => (
					<dl class="layout-audit-grid">
						<dt>Row stop</dt>
						<dd>{r().rowStop} rows</dd>
						<dt>Col stop</dt>
						<dd>{r().colStop} cols (header wall {r().headerWall})</dd>
						<dt>Invariant A · row</dt>
						<dd classList={{ bad: !r().axisRow.stable }}>
							{r().axisRow.stable ? "stable" : `MOVED ${r().axisRow.reported.join(" → ")}`}
							{/* judgeAxis reports "stable" for fewer than two probes too — that
							    is "untested", not "passing". Naming the probe count here means
							    an audit that silently ran short can't read the same as one that
							    ran and found nothing wrong. */}
							<span class="lab-note"> · {r().axisRow.reported.length} probe{r().axisRow.reported.length === 1 ? "" : "s"}</span>
						</dd>
						<dt>Invariant A · col</dt>
						<dd classList={{ bad: !r().axisCol.stable }}>
							{r().axisCol.stable ? "stable" : `MOVED ${r().axisCol.reported.join(" → ")}`}
							<span class="lab-note"> · {r().axisCol.reported.length} probe{r().axisCol.reported.length === 1 ? "" : "s"}</span>
						</dd>
						<dt>Invariant B · drift</dt>
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
