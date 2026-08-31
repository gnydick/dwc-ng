import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { childKeys, formatLeaf, isExpandable, selectorForPath, summarize, valueKind, type PathStep } from "./inspect.ts";
import type { OmSelector } from "../compose/controls/omSelector.ts";
import { copyText } from "../shell/copyText.ts";
import "./omPicker.css";

/**
 * Live object-model browser — first-class in System (see the IA: the OM is the
 * machine's truth, so being able to read it directly is a feature, not a debug
 * afterthought). Children render only while expanded, so the full tree is never
 * walked; values track the store, so an open node updates in place.
 */
export function OmInspector(props: { data: Record<string, unknown> }) {
	const [filter, setFilter] = createSignal("");

	const roots = createMemo(() => {
		const query = filter().trim().toLowerCase();
		const keys = childKeys(props.data);
		return query === "" ? keys : keys.filter(k => k.toLowerCase().includes(query));
	});

	return (
		<div class="om-inspector">
			<div class="om-bar">
				<input
					class="om-filter"
					type="text"
					placeholder="Filter top-level keys — e.g. heat"
					aria-label="Filter object model keys"
					value={filter()}
					onInput={e => setFilter(e.currentTarget.value)}
				/>
				<span class="om-count">{roots().length} keys</span>
			</div>
			<ul class="om-tree">
				<For each={roots()} fallback={<li class="job-empty">No matching keys.</li>}>
					{key => <OmNode name={key} value={props.data[key]} depth={0} path={[{ kind: "key", key }]} />}
				</For>
			</ul>
		</div>
	);
}

function OmNode(props: { name: string; value: unknown; depth: number; path: readonly PathStep[] }) {
	const [open, setOpen] = createSignal(false);
	const kind = createMemo(() => valueKind(props.value));
	const container = createMemo(() => kind() === "object" || kind() === "array");
	const expandable = createMemo(() => isExpandable(props.value));
	// Only walk children while open — the OM is large.
	const keys = createMemo(() => (open() ? childKeys(props.value) : []));
	// pickable-implies-parseable: the copy affordance's payload is the branded
	// OmSelector (sole constructor parseOmSelector, via selectorForPath), or
	// null — a node whose path cannot round-trip through the parser (e.g. a
	// non-identifier key) gets NO affordance rather than a broken string.
	const selector = createMemo(() => selectorForPath(props.path));
	// The parent mints the child's step, because only it knows whether its
	// children are array elements or object keys.
	const childStep = (k: string): PathStep =>
		kind() === "array" ? { kind: "index", index: Number(k) } : { kind: "key", key: k };

	return (
		<li class="om-node">
			{/* calc(n * var(--u)), not a raw px template literal — an inline style
			    is exactly the "bitmap sized by script" case the scale sweep exists
			    to catch (Card Lab, 2026-08-21): a per-depth offset computed in raw
			    pixels does not track --u, so nesting the SAME tree deeper reads a
			    different indent-to-content ratio at every UI scale. 3.5u/1u match
			    the previous 14px/4px exactly at the default scale (u=4px). */}
			<div class="om-row" style={{ "padding-left": `calc(${props.depth * 3.5 + 1} * var(--u))` }}>
				<Show when={expandable()} fallback={<span class="om-leafdot" />}>
					<button class="om-toggle" aria-expanded={open()} onClick={() => setOpen(o => !o)}>
						{open() ? "▾" : "▸"}
					</button>
				</Show>
				<span class="om-key">{props.name}</span>
				{/* Fixed-width slot in EVERY row, before the live value: geometry is
				    identical whether the affordance exists or not, and a value
				    changing width at poll rate never slides the button. */}
				<span class="om-copy-slot">
					<Show when={selector()}>{sel => <OmCopy selector={sel()} />}</Show>
				</span>
				<Show
					when={container()}
					fallback={<span class={`om-val k-${kind()}`}>{formatLeaf(props.value)}</span>}
				>
					<span class="om-sum">{summarize(props.value)}</span>
				</Show>
			</div>
			<Show when={open()}>
				<ul class="om-children">
					<For each={keys()}>
						{k => (
							<OmNode
								name={k}
								value={(props.value as Record<string, unknown>)[k]}
								depth={props.depth + 1}
								path={[...props.path, childStep(k)]}
							/>
						)}
					</For>
				</ul>
			</Show>
		</li>
	);
}

/* Same rhythm as shell/CardTip.tsx (the loved copy-anchors): failure lingers
   longer than success, because "Copied!" only confirms what you expected while
   "the browser refused" is news. Constants restated rather than imported —
   CardTip does not export them, and CardTip stays untouched by design. */
const COPY_RESET_MS = { copied: 1200, failed: 2400 } as const;

type CopyState = "idle" | "copied" | "failed";

/**
 * The copy-as-selector affordance. Its payload is the branded OmSelector —
 * there is no prop by which this button could be handed a raw string, so
 * offering an unparseable selector is unrepresentable, not merely avoided.
 *
 * Unlike CardTip this never swaps its text: in a dense tree a width change
 * under the cursor is exactly the jitter the positional-stability rule
 * forbids. The glyph is constant; copied/failed speak through color, an inset
 * hairline (zero-layout decoration) and the title/aria-label.
 */
function OmCopy(props: { selector: OmSelector }) {
	const [state, setState] = createSignal<CopyState>("idle");
	let resetTimer = 0;

	const copy = async (): Promise<void> => {
		// shell/copyText.ts is the house choke-point: clipboard API when the
		// origin allows it, selection fallback on the SD-card's plain-HTTP
		// origin — and a false return is a REFUSED copy, shown as such.
		const ok = await copyText(props.selector.text);
		setState(ok ? "copied" : "failed");
		window.clearTimeout(resetTimer);
		resetTimer = window.setTimeout(() => setState("idle"), ok ? COPY_RESET_MS.copied : COPY_RESET_MS.failed);
	};
	onCleanup(() => window.clearTimeout(resetTimer));

	const title = (): string => {
		if (state() === "copied") return "Copied!";
		if (state() === "failed") return "The browser refused the copy";
		return `Copy selector: ${props.selector.text}`;
	};

	return (
		<button
			type="button"
			class="om-copy"
			classList={{ copied: state() === "copied", failed: state() === "failed" }}
			title={title()}
			aria-label={title()}
			onClick={() => void copy()}
		>
			⧉
		</button>
	);
}
