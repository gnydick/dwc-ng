import { For, Show, createMemo, createSignal } from "solid-js";
import { childKeys, formatLeaf, isExpandable, summarize, valueKind } from "./inspect.ts";

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
					{key => <OmNode name={key} value={props.data[key]} depth={0} />}
				</For>
			</ul>
		</div>
	);
}

function OmNode(props: { name: string; value: unknown; depth: number }) {
	const [open, setOpen] = createSignal(false);
	const kind = createMemo(() => valueKind(props.value));
	const container = createMemo(() => kind() === "object" || kind() === "array");
	const expandable = createMemo(() => isExpandable(props.value));
	// Only walk children while open — the OM is large.
	const keys = createMemo(() => (open() ? childKeys(props.value) : []));

	return (
		<li class="om-node">
			<div class="om-row" style={{ "padding-left": `${props.depth * 14 + 4}px` }}>
				<Show when={expandable()} fallback={<span class="om-leafdot" />}>
					<button class="om-toggle" aria-expanded={open()} onClick={() => setOpen(o => !o)}>
						{open() ? "▾" : "▸"}
					</button>
				</Show>
				<span class="om-key">{props.name}</span>
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
							/>
						)}
					</For>
				</ul>
			</Show>
		</li>
	);
}
