/**
 * The control renderer — the sole route from a compiled control spec to the
 * screen (rung 7). Every button it produces is a GcodeButton, so every
 * data-defined control wears its LIVE-resolved G-code (I15) and sends only
 * through the guarded connector in ctx (I16). Motion primitives (jog-pad,
 * axis-jog) do not take templates: they emit through control/commands.ts —
 * cmd.jog stays the single authority for jog G-code, data only picks axes
 * and binds the step/feed inputs.
 */
import { For, Show, createMemo, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { GcodeButton } from "../../control/GcodeButton.tsx";
import { cmd } from "../../control/commands.ts";
import { readOmList } from "./omSelector.ts";
import { resolveTemplate, type TemplateScope } from "./template.ts";
import type { CompiledControlSpec, CompiledNode, CompiledRowItem, EnrichmentId } from "./spec.ts";
import type { CardCtx } from "../ctx.ts";
import { unreachable } from "../../util/unreachable.ts";

/** Closed enrichment registry (data names one; code defines it — rung 8). */
const ENRICHMENTS: Record<EnrichmentId, (item: Record<string, unknown>, ctx: CardCtx) => Record<string, unknown>> = {
	/** move.axes items gain `label`: the letter plus the user's role name. */
	axisLabel: (item, ctx) => {
		const letter = String(item.letter ?? "");
		const role = ctx.config.config.axisRoles[letter];
		return { ...item, label: role ? `${letter} · ${role}` : letter };
	},
};

export function ControlList(props: { spec: CompiledControlSpec; ctx: CardCtx }) {
	// Shared live inputs (step sizes, feeds) — card-local state, seeded from
	// the spec's defaults, consumed by templates and the motion primitives.
	const [inputs, setInputs] = createStore<Record<string, number>>(
		Object.fromEntries(Object.entries(props.spec.inputs).map(([name, def]) => [name, def.default])),
	);

	const scopeWith = (vars: Record<string, unknown>): TemplateScope => ({
		input: name => inputs[name],
		om: props.ctx.om.om,
		vars,
	});

	const InputControl = (p: { name: string }): JSX.Element => {
		const def = props.spec.inputs[p.name]!;
		return (
			<Show
				when={def.kind === "chips"}
				fallback={
					<label class="feed-field">
						{def.label}
						<input
							type="number"
							value={inputs[p.name]}
							onInput={e => setInputs(p.name, Number(e.currentTarget.value))}
						/>
					</label>
				}
			>
				<For each={def.options ?? []}>
					{opt => (
						<button
							class="chip-btn"
							classList={{ active: inputs[p.name] === opt }}
							onClick={() => setInputs(p.name, opt)}
						>
							{opt}{def.unit ? ` ${def.unit}` : ""}
						</button>
					)}
				</For>
			</Show>
		);
	};

	const RenderNode = (p: { node: CompiledNode; vars: Record<string, unknown> }): JSX.Element => {
		const node = p.node;
		switch (node.type) {
			case "gcode-button":
				return (
					<GcodeButton
						label={resolveTemplate(node.label, scopeWith(p.vars))}
						command={resolveTemplate(node.template, scopeWith(p.vars))}
						variant={node.variant}
						stamp={node.stamp}
						class={node.class}
					/>
				);
			case "jog-pad": {
				const has = (letter: string): boolean =>
					props.ctx.om.om.move.axes.some(a => a.visible && a.letter === letter);
				const step = (): number => inputs[node.step] ?? 0;
				const feed = (): number => inputs[node.feed] ?? 0;
				return (
					<div class="jog-pad">
						<Show when={has("X") && has("Y")}>
							<div class="jog-xy" role="group" aria-label="X/Y jog">
								<GcodeButton class="jog-key pos-yp" label="+Y" command={cmd.jog("Y", step(), feed())} stamp={false} />
								<GcodeButton class="jog-key pos-xn" label="−X" command={cmd.jog("X", -step(), feed())} stamp={false} />
								<span class="jog-center">{step()}<small>mm</small></span>
								<GcodeButton class="jog-key pos-xp" label="+X" command={cmd.jog("X", step(), feed())} stamp={false} />
								<GcodeButton class="jog-key pos-yn" label="−Y" command={cmd.jog("Y", -step(), feed())} stamp={false} />
							</div>
						</Show>
						<Show when={has("Z")}>
							<div class="jog-z" role="group" aria-label="Z jog">
								<GcodeButton class="jog-key" label="+Z" command={cmd.jog("Z", step(), feed())} stamp={false} />
								<span class="jog-zlabel">Z</span>
								<GcodeButton class="jog-key" label="−Z" command={cmd.jog("Z", -step(), feed())} stamp={false} />
							</div>
						</Show>
					</div>
				);
			}
			case "axis-jog": {
				const item = createMemo(() => {
					const value = p.vars[node.axisVar];
					return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
				});
				const letter = (): string => String(item().letter ?? "");
				const role = (): string | undefined => props.ctx.config.config.axisRoles[letter()];
				const step = (): number => inputs[node.step] ?? 0;
				const feed = (): number => inputs[node.feed] ?? 0;
				return (
					<div class="jog-row">
						<span class="ctl-name">{letter()}<Show when={role()}>{r => <small>{r()}</small>}</Show></span>
						<GcodeButton label={`− ${step()}`} command={cmd.jog(letter(), -step(), feed())} stamp={false} />
						<GcodeButton label={`+ ${step()}`} command={cmd.jog(letter(), step(), feed())} stamp={false} />
					</div>
				);
			}
			case "row":
				return (
					<div class={node.class ?? "ctl-wrap"}>
						<Show when={node.label}>
							<span class="ctl-name">{node.label}<Show when={node.sub}>{s => <small>{s()}</small>}</Show></span>
						</Show>
						<For each={node.items}>
							{item => <RenderRowItem item={item} vars={p.vars} />}
						</For>
					</div>
				);
			case "grid":
				return (
					<div class="ctl-grid">
						<For each={node.items}>
							{child => <RenderNode node={child} vars={p.vars} />}
						</For>
					</div>
				);
			case "forEach": {
				const items = createMemo(() => {
					let list = readOmList(props.ctx.om.om, node.from) as Array<Record<string, unknown>>;
					if (node.except !== undefined) {
						const { prop, values } = node.except;
						list = list.filter(item => !values.includes(String(item?.[prop])));
					}
					if (node.enrich !== undefined) {
						const enrich = ENRICHMENTS[node.enrich];
						list = list.map(item => enrich(item, props.ctx));
					}
					return list;
				});
				return (
					<For each={items()}>
						{item => <RenderNode node={node.node} vars={{ ...p.vars, [node.as]: item }} />}
					</For>
				);
			}
		}
		// Totality weld: JSX.Element admits undefined, so without this a new
		// CompiledNode variant would render as NOTHING and compile fine. This
		// makes the missing case a compile error instead.
		unreachable(node);
	};

	const RenderRowItem = (p: { item: CompiledRowItem; vars: Record<string, unknown> }): JSX.Element => (
		<Show when={"input" in p.item ? p.item : null} fallback={<RenderNode node={p.item as CompiledNode} vars={p.vars} />}>
			{ref => <InputControl name={ref().input} />}
		</Show>
	);

	return (
		<For each={props.spec.nodes}>
			{node => <RenderNode node={node} vars={{}} />}
		</For>
	);
}
